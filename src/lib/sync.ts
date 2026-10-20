import { CapacitorHttp } from '@capacitor/core'
import { db, type Annotation, type Bookmark, type Doc, type FocusSession, type Folder, type ReadingPosition, type Task, type Tombstone } from '@/db/db'
import { exportSnapshotParts } from '@/db/tasks'
import { isNative } from './native'
import { mergePayloads, type SyncPayload } from './syncMerge'

/**
 * 可选 WebDAV 同步（v2.0）：本地优先不变，只是把同一份数据放到自己的 WebDAV 上。
 *
 * 远端布局（相对配置里的目录）：
 *   sync.json          全部结构化数据（任务/文档元信息/批注/书签/位置/专注/墓碑）
 *   blobs/<hash>.b64   文档本体（base64 存文本，避免 WebView 里传二进制要过 CORS / 原生插件）
 *
 * 合并规则在 syncMerge.ts（纯函数、有单测）。文档本体按 hash 寻址：只传缺的那几份。
 * 网页版受浏览器跨域限制，需要 WebDAV 服务端给 CORS；安卓壳内走 CapacitorHttp，
 * 由原生发请求，不吃 CORS。
 */

export interface WebdavConfig {
  url: string
  username: string
  password: string
  auto: boolean
}

const CFG_KEY = 'webdav'
const LAST_KEY = 'lastSyncAt'
const SYNC_FILE = 'sync.json'
const AUTO_MIN_INTERVAL = 10 * 60 * 1000

export async function getWebdavConfig(): Promise<WebdavConfig | null> {
  const row = await db.settings.get(CFG_KEY)
  return (row?.value as WebdavConfig | undefined) ?? null
}

export async function setWebdavConfig(cfg: WebdavConfig | null): Promise<void> {
  if (cfg) await db.settings.put({ key: CFG_KEY, value: cfg })
  else await db.settings.delete(CFG_KEY)
}

export async function getLastSyncAt(): Promise<number | null> {
  const row = await db.settings.get(LAST_KEY)
  return typeof row?.value === 'number' ? row.value : null
}

/* ---------------- 传输层 ---------------- */

function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function authHeader(cfg: WebdavConfig): string {
  return `Basic ${base64Utf8(`${cfg.username}:${cfg.password}`)}`
}

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function join(base: string, path: string): string {
  return `${base}/${path}`
}

interface DavResponse {
  status: number
  text: string
  etag?: string
}

function headerOf(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const hit = Object.keys(headers).find((k) => k.toLowerCase() === name)
  return hit ? headers[hit] : undefined
}

async function dav(
  cfg: WebdavConfig,
  method: string,
  url: string,
  body?: string,
  extra?: Record<string, string>,
): Promise<DavResponse> {
  const headers: Record<string, string> = { Authorization: authHeader(cfg), ...extra }
  if (body != null) headers['Content-Type'] = 'application/json; charset=utf-8'

  if (isNative()) {
    const res = await CapacitorHttp.request({
      url,
      method,
      headers,
      data: body,
      responseType: 'text',
      connectTimeout: 15000,
      readTimeout: 60000,
    })
    return {
      status: res.status,
      text: typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? ''),
      etag: headerOf(res.headers as Record<string, string>, 'etag'),
    }
  }

  let res: Response
  try {
    res = await fetch(url, { method, headers, body })
  } catch {
    throw new Error('请求被浏览器拦截：网页版 WebDAV 需要服务端允许跨域（安卓 App 内由原生发请求，不受影响）')
  }
  return { status: res.status, text: await res.text(), etag: res.headers.get('etag') ?? undefined }
}

async function getText(cfg: WebdavConfig, url: string): Promise<DavResponse | null> {
  const res = await dav(cfg, 'GET', url)
  if (res.status === 404) return null
  if (res.status === 401 || res.status === 403) throw new Error('WebDAV 认证失败：请检查用户名与应用密码')
  if (res.status >= 400) throw new Error(`WebDAV 读取失败（HTTP ${res.status}）`)
  return res
}

async function putText(cfg: WebdavConfig, url: string, text: string, etag?: string): Promise<DavResponse> {
  const res = await dav(cfg, 'PUT', url, text, etag ? { 'If-Match': etag } : undefined)
  if (res.status === 412) throw new Error('CONFLICT')
  if (res.status >= 400) throw new Error(`WebDAV 写入失败（HTTP ${res.status}）`)
  return res
}

const ensuredDirs = new Set<string>()

async function ensureDirs(cfg: WebdavConfig, base: string): Promise<void> {
  const key = `${cfg.username}@${base}`
  if (ensuredDirs.has(key)) return
  for (const url of [base, join(base, 'blobs')]) {
    const res = await dav(cfg, 'MKCOL', url)
    // 201 新建、405 已存在；部分服务对已存在目录回 301/409
    if (res.status >= 400 && res.status !== 405 && res.status !== 409 && res.status !== 301) {
      if (res.status === 401 || res.status === 403) throw new Error('WebDAV 认证失败：请检查用户名与应用密码')
      throw new Error(`WebDAV 目录不可用（HTTP ${res.status}）：请确认地址指向一个可写的目录`)
    }
  }
  ensuredDirs.add(key)
}

/* ---------------- 文档本体 ---------------- */

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK))
  return btoa(bin)
}

function base64ToBlob(text: string, type: string): Blob {
  const bin = atob(text.trim())
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: type || 'application/octet-stream' })
}

/* ---------------- 本地写入 ---------------- */

// 注意不含 db.blobs：文档本体不在 JSON 里，清掉就找不回来了
const SYNCED_TABLES = [db.tasks, db.docs, db.positions, db.annotations, db.bookmarks, db.focusSessions, db.folders, db.tombstones]

async function applyLocally(merged: { payload: SyncPayload; replaceAll: boolean }): Promise<void> {
  const p = merged.payload
  if (merged.replaceAll) {
    // 另一方清空过：本地先整份清掉再写入，避免「清空过的旧数据」被合并回来
    await db.transaction('rw', [...SYNCED_TABLES, db.docText], async () => {
      await db.tasks.clear()
      await db.docs.clear()
      await db.positions.clear()
      await db.annotations.clear()
      await db.bookmarks.clear()
      await db.focusSessions.clear()
      await db.folders.clear()
      await db.tombstones.clear()
      await db.docText.clear()
      await db.tasks.bulkPut(p.tasks)
      await db.docs.bulkPut(p.docs)
      await db.positions.bulkPut(p.positions)
      await db.annotations.bulkPut(p.annotations)
      await db.bookmarks.bulkPut(p.bookmarks)
      await db.focusSessions.bulkPut(p.focusSessions)
      await db.folders.bulkPut(p.folders ?? [])
      await db.tombstones.bulkPut(p.tombstones)
    })
    await db.settings.put({ key: 'syncEpoch', value: p.epoch ?? Date.now() })
    return
  }

  await db.transaction('rw', SYNCED_TABLES, async () => {
    await db.tasks.bulkPut(p.tasks)
    await db.docs.bulkPut(p.docs)
    await db.positions.bulkPut(p.positions)
    await db.annotations.bulkPut(p.annotations)
    await db.bookmarks.bulkPut(p.bookmarks)
    await db.focusSessions.bulkPut(p.focusSessions)
    await db.folders.bulkPut(p.folders ?? [])
    await db.tombstones.bulkPut(p.tombstones)
    // 合并结果里没有的本地记录 = 远端墓碑赢或另一端删过，本地也要删
    const prune = async (table: { toCollection: () => { primaryKeys: () => Promise<unknown[]> }; bulkDelete: (ids: string[]) => Promise<void> }, keep: Set<string>) => {
      const ids = (await table.toCollection().primaryKeys()) as string[]
      const extras = ids.filter((id) => !keep.has(id))
      if (extras.length) await table.bulkDelete(extras)
    }
    await prune(db.tasks, new Set(p.tasks.map((t: Task) => t.id)))
    await prune(db.docs, new Set(p.docs.map((d: Doc) => d.id)))
    await prune(db.positions, new Set(p.positions.map((x: ReadingPosition) => x.hash)))
    await prune(db.annotations, new Set(p.annotations.map((a: Annotation) => a.id)))
    await prune(db.bookmarks, new Set(p.bookmarks.map((b: Bookmark) => b.id)))
    await prune(db.focusSessions, new Set(p.focusSessions.map((f: FocusSession) => f.id)))
    await prune(db.folders, new Set((p.folders ?? []).map((f: Folder) => f.id)))
    await prune(db.tombstones, new Set(p.tombstones.map((t: Tombstone) => t.id)))
  })
  if (p.epoch) {
    const cur = (await db.settings.get('syncEpoch'))?.value as number | undefined
    if (!cur || p.epoch > cur) await db.settings.put({ key: 'syncEpoch', value: p.epoch })
  }
}

/* ---------------- 主流程 ---------------- */

/** 整份替换后 docText 被清空过：按本地已有的文档本体把全文索引重建回来（不阻塞同步） */
async function reindexMissingDocs(): Promise<void> {
  try {
    const docs = await db.docs.toArray()
    const { indexDoc } = await import('@/lib/docTextIndex')
    for (const d of docs) {
      if (await db.docText.get(d.hash)) continue
      const blob = (await db.blobs.get(d.hash))?.blob
      if (blob) await indexDoc(d, blob)
    }
  } catch { /* 索引失败不影响阅读 */ }
}

export interface SyncReport {
  tasks: number
  docs: number
  blobsUp: number
  blobsDown: number
  at: number
}

async function performSync(): Promise<SyncReport> {
  const cfg = await getWebdavConfig()
  if (!cfg?.url) throw new Error('还没有填写 WebDAV 地址')
  const base = normalizeBase(cfg.url)
  await ensureDirs(cfg, base)

  const localParts = await exportSnapshotParts()
  const local = JSON.parse(localParts.json) as SyncPayload & { docText?: unknown }
  local.tombstones = await db.tombstones.toArray()
  local.epoch = (await db.settings.get('syncEpoch'))?.value as number | undefined
  delete local.docText // 全文索引是派生数据，同步里不带，下载文档后在本机重建

  const syncUrl = join(base, SYNC_FILE)
  const got = await getText(cfg, syncUrl)
  let remote: SyncPayload | null = null
  if (got?.text) {
    try {
      remote = JSON.parse(got.text) as SyncPayload
    } catch {
      throw new Error('远端 sync.json 不是合法 JSON（可能被别的程序占用）')
    }
  }

  const merged = mergePayloads(local, remote)
  const remoteHashes = new Set((remote?.blobMeta ?? []).map((m) => m.hash))

  await applyLocally(merged)
  if (merged.replaceAll) void reindexMissingDocs()

  const localHashes = new Set((await db.blobs.toCollection().primaryKeys()) as string[])
  merged.payload.blobMeta = (merged.payload.blobMeta ?? []).filter((m) => localHashes.has(m.hash) || remoteHashes.has(m.hash))

  // 1) 补下载：远端有、本地没有的文档本体
  let blobsDown = 0
  for (const meta of merged.payload.blobMeta) {
    if (localHashes.has(meta.hash) || !remoteHashes.has(meta.hash)) continue
    const res = await getText(cfg, join(base, `blobs/${meta.hash}.b64`))
    if (!res?.text) continue
    const blob = base64ToBlob(res.text, meta.type)
    await db.blobs.put({ hash: meta.hash, blob })
    localHashes.add(meta.hash)
    blobsDown++
    // 全文索引按需重建（不阻塞同步）
    void import('@/lib/docTextIndex').then(async ({ indexDoc }) => {
      const docs = await db.docs.where('hash').equals(meta.hash).toArray()
      for (const d of docs) if (!(await db.docText.get(meta.hash))) await indexDoc(d, blob)
    })
  }

  // 2) 补上传：本地有、远端还没有的文档本体
  let blobsUp = 0
  for (const meta of merged.payload.blobMeta) {
    if (!localHashes.has(meta.hash) || remoteHashes.has(meta.hash)) continue
    const row = await db.blobs.get(meta.hash)
    if (!row) continue
    await putText(cfg, join(base, `blobs/${meta.hash}.b64`), await blobToBase64(row.blob))
    blobsUp++
  }

  // 3) 推合并结果（带上 ETag 防覆盖别人的并发写入）
  await putText(cfg, syncUrl, JSON.stringify(merged.payload), got?.etag)

  const at = Date.now()
  await db.settings.put({ key: LAST_KEY, value: at })
  return { tasks: merged.payload.tasks.length, docs: merged.payload.docs.length, blobsUp, blobsDown, at }
}

/** 立即同步；并发冲突（412）时重跑一次 */
export async function syncNow(): Promise<SyncReport> {
  try {
    return await performSync()
  } catch (e) {
    if (e instanceof Error && e.message === 'CONFLICT') return await performSync()
    throw e
  }
}

/** 连接测试：建目录 + 读一次 sync.json（404 也算通） */
export async function testWebdav(cfg: WebdavConfig): Promise<{ ok: boolean; message: string }> {
  try {
    if (!cfg.url.trim()) return { ok: false, message: '请填写 WebDAV 地址' }
    const base = normalizeBase(cfg.url)
    await ensureDirs(cfg, base)
    await getText(cfg, join(base, SYNC_FILE))
    return { ok: true, message: '连接正常，目录可写' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '连接失败' }
  }
}

/** 启动钩子：开启自动同步且距上次超过 10 分钟时静默跑一次 */
export async function maybeAutoSync(): Promise<void> {
  try {
    const cfg = await getWebdavConfig()
    if (!cfg?.auto || !cfg.url) return
    const last = await getLastSyncAt()
    if (last && Date.now() - last < AUTO_MIN_INTERVAL) return
    await syncNow()
  } catch { /* 静默失败：离线/口令变更时不打扰 */ }
}
