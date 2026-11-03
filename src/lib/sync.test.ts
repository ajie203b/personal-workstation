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

describe('WebDAV 同步：手写计算笔记', () => {
  const page = {
    id: 'n1', title: '第 1 页', createdAt: 1000, updatedAt: 2000,
    strokes: [{ id: 's1', width: 3, points: [{ x: 10.2, y: 20.4, p: 0.5, t: 1730000000000 }, { x: 12.6, y: 21, p: 0.6, t: 1730000000016 }] }],
    results: [{ key: 's1', recognized: '1+1=', result: { kind: 'inline' as const, latex: '2', text: '2' } }],
  }

  it('推到云端后另一台设备能拿回完整笔迹；删除用墓碑同步，不会复活', async () => {
    const dav = fakeDav()
    vi.stubGlobal('fetch', dav.fetchImpl)
    await db.mathNotes.put(page)
    await syncNow()
    const cloud = JSON.parse(dav.files.get(SYNC_URL)!)
    expect(cloud.mathNotes).toHaveLength(1)
    expect(cloud.mathNotes[0].enc).toBe(1)

    // 模拟新设备：本地没有这页笔记
    await db.mathNotes.clear()
    await syncNow()
    const back = await db.mathNotes.get('n1')
    expect(back?.results).toEqual(page.results)
    expect(back?.strokes[0].points).toEqual(page.strokes[0].points)

    // 删掉这一页（带墓碑）→ 同步后云端也没有了
    const { deletePage } = await import('@/modules/tools/mathnotes/store')
    await deletePage('n1')
    await syncNow()
    expect(JSON.parse(dav.files.get(SYNC_URL)!).mathNotes).toEqual([])
    expect(await db.mathNotes.get('n1')).toBeUndefined()
  })
})
