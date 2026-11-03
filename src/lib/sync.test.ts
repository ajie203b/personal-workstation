import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@/db/db'

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({ request: vi.fn() }),
}))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    cancel: async () => undefined,
    schedule: async () => undefined,
    checkPermissions: async () => ({ display: 'granted' }),
    requestPermissions: async () => ({ display: 'granted' }),
  },
}))

const { db } = await import('@/db/db')
const { getLastSyncAt, getLastSyncError, setWebdavConfig, syncNow } = await import('./sync')

const BASE = 'https://dav.test/ws'
const SYNC_URL = `${BASE}/sync.json`

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id, title: `任务 ${id}`, tier: 'today', priority: 2, status: 'todo', tags: [],
  createdAt: 1000, updatedAt: 1000, ...patch,
})

/** 极简内存版 WebDAV：够跑通 MKCOL / GET / PUT，并能在 GET 上挂一个闸门 */
function fakeDav(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial))
  const puts: { url: string; body: string }[] = []
  let started: () => void = () => undefined
  const startedPromise = new Promise<void>((r) => { started = r })
  let release: () => void = () => undefined
  const gate = new Promise<void>((r) => { release = r })
  let gateArmed = false

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'MKCOL') return new Response('', { status: 201 })
    if (method === 'PUT') {
      const body = String(init?.body ?? '')
      files.set(url, body)
      puts.push({ url, body })
      return new Response('', { status: 201 })
    }
    if (method === 'GET') {
      if (gateArmed && url === SYNC_URL) {
        gateArmed = false
        started()
        await gate
      }
      const text = files.get(url)
      return text == null ? new Response('', { status: 404 }) : new Response(text, { status: 200 })
    }
    return new Response('', { status: 200 })
  }

  return {
    files,
    puts,
    fetchImpl,
    started: startedPromise,
    release,
    /** 下一张同步请求先在 GET 上停住，测试据此模拟「请求期间用户还在操作」 */
    armGate: () => { gateArmed = true },
    lastSyncJson: () => {
      const body = [...puts].reverse().find((p) => p.url === SYNC_URL)?.body
      return body ? JSON.parse(body) as { tasks: Task[] } : null
    },
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await setWebdavConfig({ url: BASE, username: 'u', password: 'p', auto: false })
})

it('WebDAV 合并额度记录并把结果写回本机及云端', async () => {
  const legacy = { id: 'legacy', name: '旧记录' }
  const local = { id: 'local', name: '本机', updatedAt: 3 }
  const remote = { id: 'remote', name: '云端', updatedAt: 4 }
  const gone = { id: 'gone', deleted: true, updatedAt: 5 }
  await db.settings.put({ key: 'aiQuotaEntries', value: [legacy, local, gone] })
  const dav = fakeDav({ [SYNC_URL]: JSON.stringify({ app: 'personal-workstation', version: 4, tasks: [], settings: [{ key: 'aiQuotaEntries', value: [remote, { id: 'gone', name: '已删除' }] }], docs: [], positions: [], annotations: [], bookmarks: [], focusSessions: [], folders: [], tombstones: [], blobMeta: [] }) })
  vi.stubGlobal('fetch', dav.fetchImpl)
  await syncNow()
  const actual = (await db.settings.get('aiQuotaEntries'))?.value
  expect(actual).toEqual([gone, legacy, local, remote])
  const cloud = JSON.parse(dav.files.get(SYNC_URL)!)
  expect(cloud.settings.find((s: { key: string }) => s.key === 'aiQuotaEntries').value).toEqual(actual)
})

it('两台设备顺序新增、修改和删除额度时不会丢失或复活', async () => {
  const dav = fakeDav()
  vi.stubGlobal('fetch', dav.fetchImpl)
  const write = async (value: unknown[]) => db.settings.put({ key: 'aiQuotaEntries', value })
  const read = async () => (await db.settings.get('aiQuotaEntries'))?.value as Array<Record<string, unknown>>
  await write([{ id: 'a', name: '初始', updatedAt: 1 }])
  await syncNow()
  await db.settings.delete('aiQuotaEntries') // 模拟第二台新设备
  await syncNow()
  expect(await read()).toEqual([{ id: 'a', name: '初始', updatedAt: 1 }])
  await write([{ id: 'a', name: '修改', updatedAt: 2 }, { id: 'b', name: '新建', updatedAt: 3 }])
  await syncNow()
  await write([{ id: 'a', name: '初始', updatedAt: 1 }]) // 第一台设备旧快照
  await syncNow()
  expect(await read()).toEqual([{ id: 'a', name: '修改', updatedAt: 2 }, { id: 'b', name: '新建', updatedAt: 3 }])
  await write([{ id: 'a', deleted: true, updatedAt: 4 }, { id: 'b', name: '新建', updatedAt: 3 }])
  await syncNow()
  await write([{ id: 'a', name: '初始', updatedAt: 1 }, { id: 'b', name: '新建', updatedAt: 3 }])
  await syncNow()
  expect(await read()).toEqual([{ id: 'a', deleted: true, updatedAt: 4 }, { id: 'b', name: '新建', updatedAt: 3 }])
})

it('额度卡片顺序和余额字段随 WebDAV 同步到另一台设备', async () => {
  const dav = fakeDav()
  vi.stubGlobal('fetch', dav.fetchImpl)
  const records = [
    { id: 'a', name: '会员', sortOrder: 1, updatedAt: 5 },
    { id: 'b', name: '余额', sortOrder: 0, displayMode: 'balance', balance: 28, balanceUnit: '元', updatedAt: 5 },
  ]
  await db.settings.put({ key: 'aiQuotaEntries', value: records })
  await syncNow()
  await db.settings.delete('aiQuotaEntries')
  await syncNow()
  expect((await db.settings.get('aiQuotaEntries'))?.value).toEqual(records)
})

describe('WebDAV 同步：请求期间的本地改动', () => {
  it('请求期间新建的任务不会被旧快照删掉，并会推送上去', async () => {
    const dav = fakeDav({ [SYNC_URL]: JSON.stringify({ app: 'personal-workstation', version: 4, tasks: [], settings: [], docs: [], positions: [], annotations: [], bookmarks: [], focusSessions: [], folders: [], tombstones: [], blobMeta: [] }) })
    vi.stubGlobal('fetch', dav.fetchImpl)
    dav.armGate()

    const running = syncNow()
    await dav.started
    // 用户在这一刻新建了一条任务（请求还在飞）
    await db.tasks.put(task('during', { createdAt: 5000, updatedAt: 5000 }))
    dav.release()

    const report = await running
    expect(await db.tasks.get('during')).toBeTruthy()
    expect(dav.lastSyncJson()?.tasks.map((t) => t.id)).toContain('during')
    expect(report.tasks).toBeGreaterThanOrEqual(1)
    expect(await getLastSyncAt()).toBe(report.at)
    expect(await getLastSyncError()).toBeNull()
  })

  it('请求期间修改的任务以本地版本为准（不被远端旧快照覆盖）', async () => {
    await db.tasks.put(task('a', { title: '本地旧', updatedAt: 1000 }))
    const dav = fakeDav({
      [SYNC_URL]: JSON.stringify({
        app: 'personal-workstation', version: 4,
        tasks: [task('a', { title: '远端版本', updatedAt: 2000 })],
        settings: [], docs: [], positions: [], annotations: [], bookmarks: [],
        focusSessions: [], folders: [], tombstones: [], blobMeta: [],
      }),
    })
    vi.stubGlobal('fetch', dav.fetchImpl)
    dav.armGate()

    const running = syncNow()
    await dav.started
    await db.tasks.update('a', { title: '同步中改的', updatedAt: 9000 })
    dav.release()
    await running

    expect((await db.tasks.get('a'))?.title).toBe('同步中改的')
    expect(dav.lastSyncJson()?.tasks.find((t) => t.id === 'a')?.title).toBe('同步中改的')
  })

  it('并发调用会排队：两次同步都成功，数据不互相覆盖', async () => {
    const dav = fakeDav()
    vi.stubGlobal('fetch', dav.fetchImpl)
    await db.tasks.put(task('x'))

    const [a, b] = await Promise.all([syncNow(), syncNow()])
    expect(a.at).toBeGreaterThan(0)
    expect(b.at).toBeGreaterThan(0)
    expect(dav.lastSyncJson()?.tasks.map((t) => t.id)).toContain('x')
  })

  it('失败会留痕（设置页要能显示原因）', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 500 }))
    await expect(syncNow()).rejects.toThrow()
    const err = await getLastSyncError()
    expect(err?.message).toContain('HTTP 500')
  })
})

describe('WebDAV 同步：手写计算笔记（独立文件 mathnotes-sync.json）', () => {
  const MATH_URL = `${BASE}/mathnotes-sync.json`
  const page = {
    id: 'n1', title: '第 1 页', createdAt: 1000, updatedAt: 2000,
    strokes: [{ id: 's1', width: 3, points: [{ x: 10.2, y: 20.4, p: 0.5, t: 1730000000000 }, { x: 12.6, y: 21, p: 0.6, t: 1730000000016 }] }],
    results: [{ key: 's1', recognized: '1+1=', result: { kind: 'inline' as const, latex: '2', text: '2' } }],
  }
  const mathFile = (dav: ReturnType<typeof fakeDav>) => JSON.parse(dav.files.get(MATH_URL)!) as { notes: { id: string; updatedAt: number; title: string; strokes: unknown[] }[]; tombstones: { id: string }[]; epoch: number }

  it('笔记只写独立文件、不进 sync.json；另一台设备能拿回完整笔迹；删除用墓碑同步，不会复活', async () => {
    const dav = fakeDav()
    vi.stubGlobal('fetch', dav.fetchImpl)
    await db.mathNotes.put(page)
    const r = await syncNow()
    expect(r.mathNotes).toEqual({ ok: true, pages: 1 })
    expect(JSON.parse(dav.files.get(SYNC_URL)!).mathNotes).toBeUndefined()
    expect(mathFile(dav).notes).toHaveLength(1)

    // 模拟新设备：本地没有这页笔记
    await db.mathNotes.clear()
    await db.settings.delete('mathNotesSyncEpoch')
    await syncNow()
    const back = await db.mathNotes.get('n1')
    expect(back?.results).toEqual(page.results)
    expect(back?.strokes[0].points).toEqual(page.strokes[0].points)

    // 删掉这一页（带墓碑）→ 同步后云端也没有了，墓碑留在笔记文件里
    const { deletePage } = await import('@/modules/tools/mathnotes/store')
    await deletePage('n1')
    await syncNow()
    expect(mathFile(dav).notes).toEqual([])
    expect(mathFile(dav).tombstones.map((t) => t.id)).toEqual(['n1'])
    // 另一台设备还留着旧副本：同步时被文件里的墓碑删掉
    await db.mathNotes.put(page)
    await db.tombstones.clear()
    await syncNow()
    expect(await db.mathNotes.get('n1')).toBeUndefined()
  })

  it('旧版客户端（v3.6.6 的合并 / 序列化逻辑）重写 sync.json 之后，新客户端的笔记仍完好', async () => {
    const legacy = await import('./__legacy__/v3.6.6/syncMerge')
    const dav = fakeDav()
    vi.stubGlobal('fetch', dav.fetchImpl)
    await db.mathNotes.put(page)
    await db.tasks.put(task('t1'))
    await syncNow()

    // 旧客户端：读 sync.json → 用 v3.6.6 的 mergePayloads 合并自己的数据 → 整份写回
    const remote = JSON.parse(dav.files.get(SYNC_URL)!)
    const oldLocal = { ...remote, tasks: [...remote.tasks, task('old-device', { createdAt: 3000, updatedAt: 3000 })], tombstones: [], blobMeta: [] }
    const merged = legacy.mergePayloads(oldLocal, remote)
    dav.files.set(SYNC_URL, JSON.stringify(merged.payload))
    // 旧客户端不认识、也不碰 mathnotes-sync.json
    const before = dav.files.get(MATH_URL)

    // 新设备 B（空库）同步：笔记来自独立文件，完好
    await db.delete()
    await db.open()
    await setWebdavConfig({ url: BASE, username: 'u', password: 'p', auto: false })
    const r = await syncNow()
    expect(r.mathNotes.ok).toBe(true)
    const back = await db.mathNotes.get('n1')
    expect(back?.strokes[0].points).toEqual(page.strokes[0].points)
    expect(back?.results).toEqual(page.results)
    expect((await db.tasks.get('old-device'))?.title).toBe('任务 old-device')
    expect(mathFile(dav).notes.map((n) => n.id)).toEqual(['n1'])
    expect(JSON.parse(before!).notes).toEqual(mathFile(dav).notes)
  })

  it('迁移：测试期写进 sync.json 的 mathNotes 并进本机与独立文件，之后不再写回 sync.json', async () => {
    const { packMathNote } = await import('@/modules/tools/mathnotes/backupCodec')
    const legacyNote = packMathNote(page)
    const dav = fakeDav({
      [SYNC_URL]: JSON.stringify({ app: 'personal-workstation', version: 4, tasks: [], settings: [], docs: [], positions: [], annotations: [], bookmarks: [], focusSessions: [], folders: [], tombstones: [], blobMeta: [], mathNotes: [legacyNote] }),
    })
    vi.stubGlobal('fetch', dav.fetchImpl)
    await syncNow()
    expect((await db.mathNotes.get('n1'))?.strokes[0].points).toEqual(page.strokes[0].points)
    expect(JSON.parse(dav.files.get(SYNC_URL)!).mathNotes).toBeUndefined()
    expect(mathFile(dav).notes.map((n) => n.id)).toEqual(['n1'])

    // 本机更新过的同一页：旧格式里的旧版本不会把它盖回去
    await db.mathNotes.put({ ...page, title: '本机新', updatedAt: 9000 })
    dav.files.set(SYNC_URL, JSON.stringify({ ...JSON.parse(dav.files.get(SYNC_URL)!), mathNotes: [legacyNote] }))
    await syncNow()
    expect((await db.mathNotes.get('n1'))?.title).toBe('本机新')
    // 删过的页（有墓碑）也不会被迁移复活
    const { deletePage } = await import('@/modules/tools/mathnotes/store')
    await deletePage('n1')
    dav.files.set(SYNC_URL, JSON.stringify({ ...JSON.parse(dav.files.get(SYNC_URL)!), mathNotes: [legacyNote] }))
    await syncNow()
    expect(await db.mathNotes.get('n1')).toBeUndefined()
  })

  it('笔记文件读写失败不影响主同步', async () => {
    const dav = fakeDav()
    const inner = dav.fetchImpl
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === MATH_URL) return new Response('', { status: 500 })
      return inner(input, init)
    })
    await db.mathNotes.put(page)
    await db.tasks.put(task('t1'))
    const r = await syncNow()
    expect(r.mathNotes.ok).toBe(false)
    expect(JSON.parse(dav.files.get(SYNC_URL)!).tasks.map((t: Task) => t.id)).toEqual(['t1'])
    expect(await getLastSyncError()).toBeNull()
  })

  it('打开 → 另一台设备的更新同步进来 → 未编辑离开：不覆盖，下一轮同步推上去的仍是对方的版本', async () => {
    const { NoteSession } = await import('@/modules/tools/mathnotes/noteSession')
    const dav = fakeDav()
    vi.stubGlobal('fetch', dav.fetchImpl)
    await db.mathNotes.put(page)
    await syncNow()

    // 本机打开这一页
    const opened = (await db.mathNotes.get('n1'))!
    const session = new NoteSession(opened, () => ({ strokes: opened.strokes, results: opened.results }), {
      onReplaced: () => undefined, onConflict: () => undefined, onDeleted: () => undefined,
    })
    // 另一台设备改了这一页并推到云端
    const file = mathFile(dav)
    file.notes[0] = { ...file.notes[0], title: '另一台设备改过', updatedAt: 5000 }
    dav.files.set(MATH_URL, JSON.stringify(file))
    await syncNow()
    expect((await db.mathNotes.get('n1'))?.title).toBe('另一台设备改过')

    // 没编辑就离开
    expect(await session.close()).toBeNull()
    expect((await db.mathNotes.get('n1'))?.title).toBe('另一台设备改过')
    await syncNow()
    expect(mathFile(dav).notes[0].title).toBe('另一台设备改过')
    expect(mathFile(dav).notes[0].updatedAt).toBe(5000)
  })

  it('双方都编辑同一页：两边内容都保留（原页是对方的，本机的成为冲突副本并同步上去）', async () => {
    const { NoteSession } = await import('@/modules/tools/mathnotes/noteSession')
    const dav = fakeDav()
    vi.stubGlobal('fetch', dav.fetchImpl)
    await db.mathNotes.put(page)
    await syncNow()

    const opened = (await db.mathNotes.get('n1'))!
    const localStrokes = [...opened.strokes, { id: 'local', width: 3, points: [{ x: 50, y: 50, p: 0.5, t: 1730000001000 }] }]
    const session = new NoteSession(opened, () => ({ strokes: localStrokes, results: [] }), {
      onReplaced: () => undefined, onConflict: () => undefined, onDeleted: () => undefined,
    })
    session.markEdited('user')
    const file = mathFile(dav)
    file.notes[0] = { ...file.notes[0], title: '另一台设备改过', updatedAt: Date.now() + 60_000 }
    dav.files.set(MATH_URL, JSON.stringify(file))
    await syncNow()

    expect((await session.close())?.kind).toBe('conflict')
    await syncNow()
    const notes = mathFile(dav).notes
    expect(notes).toHaveLength(2)
    expect(notes.find((n) => n.id === 'n1')?.title).toBe('另一台设备改过')
    const copy = notes.find((n) => n.id !== 'n1')!
    expect(copy.title).toContain('冲突副本')
    expect(copy.strokes).toHaveLength(2)
  })

  it('另一台（新版）设备清空数据：笔记按笔记纪元一并清掉，不会被本机合并回来', async () => {
    const dav = fakeDav()
    vi.stubGlobal('fetch', dav.fetchImpl)
    await db.mathNotes.put(page)
    await syncNow()
    // 设备 B：清空数据后同步（纪元更大）
    const file = mathFile(dav)
    dav.files.set(MATH_URL, JSON.stringify({ ...file, notes: [], tombstones: [], epoch: Date.now() + 1000 }))
    await syncNow()
    expect(await db.mathNotes.count()).toBe(0)
    expect(mathFile(dav).notes).toEqual([])
  })
})
