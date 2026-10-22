/**
 * 快照 / 备份文件的结构校验（纯函数，便于单测）。
 *
 * 旧实现只检查「有没有 tasks 数组」，于是错误的应用标识、未知版本、把标题写成数字的
 * 任务都能直接 bulkPut 进库——脏数据一旦落库，要再排查就只能靠肉眼翻 IndexedDB。
 * 现在写库前统一过一遍这里：字段类型、枚举值、版本、以及表之间的引用关系。
 *
 * 校验分两级：
 * - 错误（抛异常，整份拒绝写入）：应用标识、版本、必填字段类型、枚举行值
 * - 警告（照写，但返回给调用方提示）：批注/书签指向了不存在的文档、文档缺少本体
 */

const APP_ID = 'personal-workstation'
/** 当前支持的快照版本上限（与 db/tasks.ts 的 exportPayload.version 同步维护） */
export const MAX_SNAPSHOT_VERSION = 4

const TIERS = new Set(['today', 'upcoming', 'anytime', 'someday'])
const STATUSES = new Set(['todo', 'doing', 'done'])
const PRIORITIES = new Set([0, 1, 2, 3])
const COLORS = new Set(['yellow', 'green', 'blue', 'red'])
const DOC_KINDS = new Set(['pdf', 'md', 'epub', 'docx', 'pptx', 'txt'])
const REPEATS = new Set(['daily', 'weekly', 'weekdays', 'monthly'])
const ROLES = new Set(['user', 'assistant', 'system'])

export interface ValidatedSnapshot {
  data: Record<string, unknown>
  version: number
  /** 不阻断写入的问题，例如批注指向了快照里不存在的文档 */
  warnings: string[]
}

class Problems {
  readonly items: string[] = []
  add(path: string, message: string): void {
    if (this.items.length < 12) this.items.push(`${path} ${message}`)
  }
  throwIfAny(): void {
    if (!this.items.length) return
    const more = this.items.length >= 12 ? ' 等' : ''
    throw new Error(`备份文件校验失败：${this.items.join('；')}${more}`)
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isArr = (v: unknown): v is unknown[] => Array.isArray(v)

/** 必填字符串 */
function str(p: Problems, row: Record<string, unknown>, field: string, path: string, allowEmpty = false): void {
  const v = row[field]
  if (!isStr(v)) p.add(`${path}.${field}`, '应为字符串')
  else if (!allowEmpty && !v.trim()) p.add(`${path}.${field}`, '不能为空')
}

/** 必填数字 */
function num(p: Problems, row: Record<string, unknown>, field: string, path: string): void {
  if (!isNum(row[field])) p.add(`${path}.${field}`, '应为数字')
}

/** 可选字符串 */
function optStr(p: Problems, row: Record<string, unknown>, field: string, path: string): void {
  const v = row[field]
  if (v !== undefined && v !== null && !isStr(v)) p.add(`${path}.${field}`, '应为字符串')
}

/** 可选数字 */
function optNum(p: Problems, row: Record<string, unknown>, field: string, path: string): void {
  const v = row[field]
  if (v !== undefined && v !== null && !isNum(v)) p.add(`${path}.${field}`, '应为数字')
}

/** 枚举行（缺失按缺省处理，就不算错；写了非法值才算） */
function oneOf(p: Problems, row: Record<string, unknown>, field: string, allowed: Set<unknown>, path: string): void {
  const v = row[field]
  if (v === undefined || v === null) return
  if (!allowed.has(v)) p.add(`${path}.${field}`, `应为 ${[...allowed].join('/')} 之一`)
}

function strArray(p: Problems, row: Record<string, unknown>, field: string, path: string): void {
  const v = row[field]
  if (v === undefined) return
  if (!isArr(v) || v.some((x) => !isStr(x))) p.add(`${path}.${field}`, '应为字符串数组')
}

/** 逐行校验一张表：要求数组，且每条都是对象，再交给 rowCheck */
function checkRows(
  p: Problems,
  data: Record<string, unknown>,
  key: string,
  rowCheck: (row: Record<string, unknown>, path: string) => void,
): void {
  const rows = data[key]
  if (rows === undefined) return
  if (!isArr(rows)) {
    p.add(key, '应为数组')
    return
  }
  rows.forEach((row, i) => {
    const path = `${key}[${i}]`
    if (!isObj(row)) {
      p.add(path, '应为对象')
      return
    }
    rowCheck(row, path)
  })
}

/** 取某一列里有值的字符串（用于后期的引用关系检查） */
function column(data: Record<string, unknown>, key: string, field: string): string[] {
  const rows = data[key]
  if (!isArr(rows)) return []
  return rows.filter(isObj).map((r) => r[field]).filter(isStr)
}

/**
 * 校验一份快照对象；通过则返回可写入的数据（原对象）与不阻断写入的警告。
 * 抛出的 Error.message 直接面向用户，说明具体哪一行的哪个字段不对。
 */
export function validateSnapshot(raw: unknown): ValidatedSnapshot {
  if (!isObj(raw)) throw new Error('备份文件校验失败：内容不是 JSON 对象')
  if (raw.app !== APP_ID) throw new Error('备份文件校验失败：不是本应用导出的文件（应用标识不符）')
  if (!isNum(raw.version)) throw new Error('备份文件校验失败：缺少版本号')
  if (raw.version < 1 || raw.version > MAX_SNAPSHOT_VERSION || !Number.isInteger(raw.version)) {
    throw new Error(`备份文件校验失败：不支持的版本 ${raw.version}（本应用最高支持 ${MAX_SNAPSHOT_VERSION}）`)
  }
  if (!isArr(raw.tasks)) throw new Error('文件格式不正确：缺少 tasks 数组')

  const p = new Problems()

  checkRows(p, raw, 'tasks', (r, path) => {
    str(p, r, 'id', path)
    str(p, r, 'title', path)
    str(p, r, 'tier', path)
    str(p, r, 'status', path)
    oneOf(p, r, 'tier', TIERS, path)
    oneOf(p, r, 'status', STATUSES, path)
    oneOf(p, r, 'priority', PRIORITIES, path)
    oneOf(p, r, 'repeat', REPEATS, path)
    num(p, r, 'createdAt', path)
    optNum(p, r, 'updatedAt', path)
    optNum(p, r, 'doneAt', path)
    optNum(p, r, 'startAt', path)
    optStr(p, r, 'due', path)
    optStr(p, r, 'dueTime', path)
    optStr(p, r, 'notes', path)
    optStr(p, r, 'folderId', path)
    strArray(p, r, 'tags', path)
    // v3.1 打卡：次数、多个时间点、预计用时、当前周期进度
    optNum(p, r, 'repeatCount', path)
    optNum(p, r, 'estimateMinutes', path)
    strArray(p, r, 'repeatTimes', path)
    if (r.checkin !== undefined && r.checkin !== null) {
      if (!isObj(r.checkin)) p.add(`${path}.checkin`, '应为对象')
      else optNum(p, r.checkin, 'count', `${path}.checkin`)
    }
  })

  checkRows(p, raw, 'docs', (r, path) => {
    str(p, r, 'id', path)
    str(p, r, 'hash', path)
    str(p, r, 'title', path)
    str(p, r, 'kind', path)
    oneOf(p, r, 'kind', DOC_KINDS, path)
    num(p, r, 'size', path)
    num(p, r, 'addedAt', path)
    optNum(p, r, 'updatedAt', path)
    optNum(p, r, 'lastOpenedAt', path)
  })

  checkRows(p, raw, 'annotations', (r, path) => {
    str(p, r, 'id', path)
    str(p, r, 'docHash', path)
    str(p, r, 'text', path, true)
    str(p, r, 'color', path)
    oneOf(p, r, 'color', COLORS, path)
    num(p, r, 'createdAt', path)
    optNum(p, r, 'updatedAt', path)
    optNum(p, r, 'page', path)
    optNum(p, r, 'blockIdx', path)
    if (r.textAnchors != null) {
      if (!isArr(r.textAnchors)) p.add(`${path}.textAnchors`, '应为数组')
      else r.textAnchors.forEach((anchor, index) => {
        const at = `${path}.textAnchors[${index}]`
        if (!isObj(anchor)) { p.add(at, '应为对象'); return }
        str(p, anchor, 'text', at)
        for (const field of ['blockIdx', 'start', 'end']) {
          const value = anchor[field]
          if (!isNum(value) || !Number.isInteger(value) || value < 0) p.add(`${at}.${field}`, '应为非负整数')
        }
        if (isNum(anchor.start) && isNum(anchor.end) && (anchor.end <= anchor.start || (isStr(anchor.text) && anchor.end - anchor.start !== anchor.text.length))) {
          p.add(at, '文本与选区偏移不一致')
        }
      })
    }
  })

  checkRows(p, raw, 'bookmarks', (r, path) => {
    str(p, r, 'id', path)
    str(p, r, 'docHash', path)
    str(p, r, 'label', path)
    str(p, r, 'anchor', path)
    num(p, r, 'createdAt', path)
  })

  checkRows(p, raw, 'positions', (r, path) => {
    str(p, r, 'hash', path)
    num(p, r, 'updatedAt', path)
  })

  checkRows(p, raw, 'focusSessions', (r, path) => {
    str(p, r, 'id', path)
    str(p, r, 'day', path)
    num(p, r, 'ts', path)
    num(p, r, 'minutes', path)
  })

  checkRows(p, raw, 'folders', (r, path) => {
    str(p, r, 'id', path)
    str(p, r, 'name', path)
    num(p, r, 'createdAt', path)
    num(p, r, 'updatedAt', path)
  })

  checkRows(p, raw, 'tombstones', (r, path) => {
    str(p, r, 'id', path)
    num(p, r, 'ts', path)
  })

  checkRows(p, raw, 'settings', (r, path) => {
    str(p, r, 'key', path)
    if (r.value === undefined) p.add(`${path}.value`, '缺失')
  })

  checkRows(p, raw, 'docText', (r, path) => {
    str(p, r, 'hash', path)
    str(p, r, 'kind', path)
    str(p, r, 'text', path, true)
    num(p, r, 'indexedAt', path)
  })

  checkRows(p, raw, 'aiSessions', (r, path) => {
    str(p, r, 'id', path)
    str(p, r, 'title', path, true)
    num(p, r, 'createdAt', path)
  })

  checkRows(p, raw, 'aiMessages', (r, path) => {
    str(p, r, 'id', path)
    str(p, r, 'sessionId', path)
    str(p, r, 'content', path, true)
    oneOf(p, r, 'role', ROLES, path)
    num(p, r, 'createdAt', path)
  })

  checkRows(p, raw, 'aiUsage', (r, path) => {
    str(p, r, 'id', path)
    num(p, r, 'ts', path)
  })

  checkRows(p, raw, 'blobRows', (r, path) => {
    str(p, r, 'hash', path)
    const isBlob = typeof Blob !== 'undefined' && r.blob instanceof Blob
    if (!isBlob && !isStr(r.data)) p.add(`${path}.data`, '应为 base64 字符串')
  })

  p.throwIfAny()

  // ---- 引用关系（只警告，不阻断：老备份里本来就可能带孤儿数据）----
  const warnings: string[] = []
  const docHashes = new Set(column(raw, 'docs', 'hash'))
  const orphanAnns = column(raw, 'annotations', 'docHash').filter((h) => !docHashes.has(h)).length
  if (orphanAnns) warnings.push(`${orphanAnns} 条批注指向的文档不在备份里`)
  const orphanMarks = column(raw, 'bookmarks', 'docHash').filter((h) => !docHashes.has(h)).length
  if (orphanMarks) warnings.push(`${orphanMarks} 条书签指向的文档不在备份里`)
  const orphanPos = column(raw, 'positions', 'hash').filter((h) => !docHashes.has(h)).length
  if (orphanPos) warnings.push(`${orphanPos} 条阅读位置指向的文档不在备份里`)

  // 文档本体缺失：恢复后这些文档点开会是空白，提前告诉用户
  const providedBlobs = new Set([...column(raw, 'blobRows', 'hash'), ...column(raw, 'blobMeta', 'hash')])
  if (isArr(raw.blobRows)) {
    const missing = [...docHashes].filter((h) => !providedBlobs.has(h)).length
    if (missing) warnings.push(`${missing} 篇文档缺少本体文件，恢复后可能无法打开`)
  }

  return { data: raw, version: raw.version, warnings }
}
