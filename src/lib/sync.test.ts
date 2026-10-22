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
