/**
 * 编辑器保存的乐观并发（P1：同步进来的新笔记被旧编辑器内容覆盖）。
 * 真实 Dexie（fake-indexeddb）+ NoteSession；「远端更新同步进来」用直接写库模拟，
 * 端到端走 WebDAV 的版本见 lib/sync.test.ts。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MathNotePage, Stroke } from './types'

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({ request: vi.fn() }),
}))

const { db } = await import('@/db/db')
const { NoteSession } = await import('./noteSession')
const { CONFLICT_SUFFIX, deletePage } = await import('./store')

const stroke = (id: string, x = 10): Stroke => ({ id, width: 2.6, points: [{ x, y: 20, p: 0.5, t: 1 }, { x: x + 5, y: 25, p: 0.5, t: 2 }] })
const page = (patch: Partial<MathNotePage> = {}): MathNotePage => ({
  id: 'p1', title: '第 1 页', strokes: [stroke('a')], results: [], createdAt: 100, updatedAt: 1000, ...patch,
})

/** 一个最小的「编辑器」：内容在内存里，NoteSession 负责落库 */
function editor(initial: MathNotePage, clock = { now: 5000 }) {
  const state = { strokes: initial.strokes.map((s) => ({ ...s })), results: [...initial.results] }
  const events: string[] = []
  const replaced: MathNotePage[] = []
  const conflicts: MathNotePage[] = []
  const session = new NoteSession(
    initial,
    () => ({ strokes: state.strokes, results: state.results }),
    {
      onReplaced: (p) => { events.push('replaced'); replaced.push(p); state.strokes = p.strokes; state.results = p.results },
      onConflict: (copy) => { events.push('conflict'); conflicts.push(copy) },
      onDeleted: () => { events.push('deleted') },
    },
    () => clock.now,
  )
  return { session, state, events, replaced, conflicts, clock }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('NoteSession：只在真正编辑后保存', () => {
  it('打开 → 远端更新同步进来 → 未编辑离开：不写库，远端版本原样保留', async () => {
    const opened = page()
    await db.mathNotes.put(opened)
    const ed = editor(opened)
    // 同步把另一台设备的新版本写进库
    const remote = page({ strokes: [stroke('a'), stroke('remote', 80)], updatedAt: 2000, title: '远端改过' })
    await db.mathNotes.put(remote)
    const spy = vi.spyOn(db.mathNotes, 'put')
    expect(await ed.session.close()).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
    expect(await db.mathNotes.get('p1')).toEqual(remote)
  })

  it('未编辑时库里这页变了：编辑器自动换成新版本', async () => {
    const opened = page()
    await db.mathNotes.put(opened)
    const ed = editor(opened)
    const remote = page({ strokes: [stroke('remote', 80)], updatedAt: 2000 })
    await db.mathNotes.put(remote)
    await ed.session.onExternal(await db.mathNotes.get('p1'))
    expect(ed.events).toEqual(['replaced'])
    expect(ed.state.strokes.map((s) => s.id)).toEqual(['remote'])
    expect(ed.session.baseline).toBe(2000)
    // 再离开：仍然不写库
    expect(await ed.session.close()).toBeNull()
    expect(await db.mathNotes.get('p1')).toEqual(remote)
  })

  it('自己写入触发的回声（updatedAt 相同）不算外部变更', async () => {
    const opened = page()
    await db.mathNotes.put(opened)
    const ed = editor(opened)
    ed.state.strokes = [...ed.state.strokes, stroke('b', 40)]
    ed.session.markEdited('user')
    await ed.session.save()
    await ed.session.onExternal(await db.mathNotes.get('p1'))
    expect(ed.events).toEqual([])
  })

  it('updatedAt 取最后一次编辑的时间，不是保存时间', async () => {
    const opened = page()
    await db.mathNotes.put(opened)
    const ed = editor(opened)
    ed.clock.now = 7000
    ed.state.strokes = [...ed.state.strokes, stroke('b', 40)]
    ed.session.markEdited('user')
    ed.clock.now = 9999 // 过了很久才保存
    const out = await ed.session.save()
    expect(out?.kind).toBe('saved')
    expect((await db.mathNotes.get('p1'))?.updatedAt).toBe(7000)
    // 保存完不再 dirty：再离开不写
    expect(await ed.session.close()).toBeNull()
  })

  it('本机时钟比对方慢：编辑时间仍至少比 baseline 大 1，同步合并时算更新', async () => {
    const opened = page({ updatedAt: 10_000 })
    await db.mathNotes.put(opened)
    const ed = editor(opened, { now: 3000 })
    ed.session.markEdited('user')
    await ed.session.save()
    expect((await db.mathNotes.get('p1'))?.updatedAt).toBe(10_001)
  })
})

describe('NoteSession：双方都编辑不丢任何一方', () => {
  it('本地编辑 + 远端更新同步进来：远端留在原页，本地另存冲突副本', async () => {
    const opened = page()
    await db.mathNotes.put(opened)
    const ed = editor(opened)
    ed.state.strokes = [...ed.state.strokes, stroke('local', 40)]
    ed.session.markEdited('user')
    const remote = page({ strokes: [stroke('a'), stroke('remote', 80)], updatedAt: 2000 })
    await db.mathNotes.put(remote)

    const out = await ed.session.close()
    expect(out?.kind).toBe('conflict')
    expect(await db.mathNotes.get('p1')).toEqual(remote)
    const all = await db.mathNotes.toArray()
    expect(all).toHaveLength(2)
    const copy = all.find((n) => n.id !== 'p1')!
    expect(copy.title).toBe(`第 1 页${CONFLICT_SUFFIX}`)
    expect(copy.strokes.map((s) => s.id)).toEqual(['a', 'local'])
    expect(ed.events).toEqual(['conflict']) // 离开时落成的副本也会提示用户
  })

  it('页面还开着时远端更新到达且本地已编辑：立刻落成冲突副本，编辑器切到副本继续写', async () => {
    const opened = page()
    await db.mathNotes.put(opened)
    const ed = editor(opened)
    ed.state.strokes = [...ed.state.strokes, stroke('local', 40)]
    ed.session.markEdited('user')
    const remote = page({ strokes: [stroke('remote', 80)], updatedAt: 2000 })
    await db.mathNotes.put(remote)
    await ed.session.onExternal(remote)
    expect(ed.events).toEqual(['conflict'])
    const copy = ed.conflicts[0]
    expect(ed.session.id).toBe(copy.id)
    expect(await db.mathNotes.get('p1')).toEqual(remote)

    // 继续在副本上写：保存到副本，不碰原页
    ed.clock.now = 8000
    ed.state.strokes = [...ed.state.strokes, stroke('more', 60)]
    ed.session.markEdited('user')
    expect((await ed.session.save())?.kind).toBe('saved')
    expect((await db.mathNotes.get(copy.id))?.strokes.map((s) => s.id)).toEqual(['a', 'local', 'more'])
    expect(await db.mathNotes.get('p1')).toEqual(remote)
  })

  it('本地编辑过、这一页却被另一台设备删除：不复活原页，本地内容另存为副本', async () => {
    const opened = page()
    await db.mathNotes.put(opened)
    const ed = editor(opened)
    ed.session.markEdited('user')
    await deletePage('p1')
    const out = await ed.session.save()
    expect(out?.kind).toBe('conflict')
    expect(await db.mathNotes.get('p1')).toBeUndefined()
    expect(await db.mathNotes.count()).toBe(1)
  })

  it('只有自动识别结果（派生改动）+ 远端更新：丢弃本地派生结果，用远端，不生成副本', async () => {
    const opened = page()
    await db.mathNotes.put(opened)
    const ed = editor(opened)
    ed.state.results = [{ key: 'a', recognized: '1+1=', result: { kind: 'inline', latex: '2', text: '2' } }]
    ed.session.markEdited('derived')
    const remote = page({ strokes: [stroke('remote', 80)], updatedAt: 2000 })
    await db.mathNotes.put(remote)
    const out = await ed.session.save()
    expect(out?.kind).toBe('stale')
    expect(ed.events).toEqual(['replaced'])
    expect(await db.mathNotes.count()).toBe(1)
    expect(await db.mathNotes.get('p1')).toEqual(remote)
  })

  it('未编辑时页面被另一台设备删除：通知编辑器换页，不写库', async () => {
    const opened = page()
    await db.mathNotes.put(opened)
    const ed = editor(opened)
    await deletePage('p1')
    await ed.session.onExternal(undefined)
    expect(ed.events).toEqual(['deleted'])
    expect(await db.mathNotes.count()).toBe(0)
  })
})
