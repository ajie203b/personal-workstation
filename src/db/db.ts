import Dexie, { type Table } from 'dexie'

export const TIERS = ['today', 'upcoming', 'anytime', 'someday'] as const
export type Tier = (typeof TIERS)[number]

export const TIER_LABEL: Record<Tier, string> = {
  today: '今日',
  upcoming: '近期',
  anytime: '随时',
  someday: '将来',
}

export type Priority = 0 | 1 | 2 | 3

export const PRIORITY_LABEL: Record<Priority, string> = {
  0: 'P0 紧急',
  1: 'P1 重要',
  2: 'P2 常规',
  3: 'P3 低',
}

export const PRIORITY_VAR: Record<Priority, string> = {
  0: 'var(--p0)',
  1: 'var(--p1)',
  2: 'var(--p2)',
  3: 'var(--p3)',
}

export type TaskStatus = 'todo' | 'doing' | 'done'
export type RepeatKind = 'daily' | 'weekly' | 'weekdays'

/** 子任务/清单项（v1.3） */
export interface SubTask {
  id: string
  title: string
  done: boolean
}

export interface DocRef {
  docId: string
  /** 页码/块锚点定位串，如 `p3` / `b7`，可带 `#annId` 后缀闪烁批注 */
  anchor?: string
  label?: string
}

/** 任务 = 方案 3.3 数据模型（docRef / aiRef 即三模块互跳外键） */
export interface Task {
  id: string
  title: string
  notes?: string
  tier: Tier
  priority: Priority
  status: TaskStatus
  due?: string // YYYY-MM-DD
  dueTime?: string // HH:mm
  tags: string[]
  repeat?: RepeatKind
  docRef?: DocRef
  aiRef?: string
  subtasks?: SubTask[] // v1.3 子任务清单
  pinned?: boolean // v1.3 置顶（列表视图内沉顶）
  createdAt: number
  updatedAt: number
  doneAt?: number // 完成即入 Logbook
}

export interface SettingKV {
  key: string
  value: unknown
}

/* ============ 文档工作站（M2） ============ */

export type DocKind = 'pdf' | 'md' | 'epub' | 'docx' | 'pptx' | 'txt'

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  pdf: 'PDF',
  md: 'Markdown',
  epub: 'EPUB',
  docx: 'Word',
  pptx: 'PPT',
  txt: 'TXT',
}

/** 文档元信息；文件本体按 hash 存 blobs 表（重命名不丢进度） */
export interface Doc {
  id: string
  hash: string
  title: string
  kind: DocKind
  size: number
  pages?: number // PDF 页数（首次打开时回填）
  addedAt: number
  lastOpenedAt?: number
}

/** 沉浸排版设置（按文档记忆，方案 2.2） */
export interface DocSettings {
  theme: 'day' | 'night' | 'sepia' | 'dusk'
  fontSize: number // px
  leading: number // 行高倍数
  widthPct: number // 正文栏宽占比 60~100
}

/**
 * 双坐标阅读位置（Readwise Reader 模式，方案 2.2）：
 * - lastScroll 瞬时滚动位置（防快速翻页污染，刷新级恢复）
 * - progress 深度阅读进度（关掉重开恢复的就是它）
 */
export interface ReadingPosition {
  hash: string
  lastScroll?: { top: number; at: number }
  progress?:
    | { kind: 'pdf'; page: number; offsetRatio: number }
    | { kind: 'md'; blockIdx: number; ratio: number }
    | { kind: 'flow'; segIdx: number; ratio: number } // epub/docx/pptx/txt
  /** 0~1 总进度，用于列表展示 */
  progressPct?: number
  settings?: DocSettings
  updatedAt: number
}

/** 批注：文字高亮（≤4 色）或区域截图（M2.5），结构化存储可供 AI/任务消费 */
export interface Annotation {
  id: string
  docHash: string
  /** text=划词高亮（默认）；shot=区域截图（含 img 缩略图） */
  kind?: 'text' | 'shot'
  /** 截图缩略图（JPEG dataURL，最长边 ~480px，仅存本地） */
  img?: string
  /** PDF 归一化矩形（相对页宽高），MD 为 undefined */
  rects?: { x: number; y: number; w: number; h: number }[]
  page?: number // PDF 页码（1 起）
  blockIdx?: number // MD 块序号
  text: string // 摘录（截图批注为备注文字）
  color: 'yellow' | 'green' | 'blue' | 'red'
  comment?: string
  createdAt: number
}

export interface Bookmark {
  id: string
  docHash: string
  label: string
  /** 与 Annotation 定位同构：pdf=p 页码；md=b 块号 */
  anchor: string
  createdAt: number
}

/* ============ v1.3 大更新 ============ */

/** 全文索引（导入时抽取，支持标题/内容搜索与命中定位） */
export interface DocText {
  hash: string
  kind: DocKind
  /** 全文纯文本（搜索用） */
  text: string
  /** PDF/EPUB/PPTX：按页/章/片的分段文本，命中时可定位 */
  segments?: string[]
  segmentUnit?: 'page' | 'chapter' | 'slide'
  indexedAt: number
}

/** 专注会话（番茄钟落库，可绑定任务 → 每任务耗时统计） */
export interface FocusSession {
  id: string
  day: string // YYYY-MM-DD
  ts: number // 完成时刻
  minutes: number
  taskId?: string
}

/* ============ AI 助手面板（M3） ============ */

export type MessageState = 'queued' | 'streaming' | 'done' | 'cancelled' | 'failed'

/**
 * AI 资产（方案 2.3 改）：会员订阅 或 API 套餐，一张卡管理一个资产
 */
export type AiAssetKind = 'subscription' | 'api'

export interface AiProvider {
  id: string
  kind: AiAssetKind
  name: string
  /** 会员订阅：套餐名（如 ChatGPT Plus）；API：可留空 */
  planName?: string
  /** 会员订阅：到期日 YYYY-MM-DD */
  expiresAt?: string
  /** 会员订阅：续费周期 */
  cycle?: 'monthly' | 'yearly' | 'once'
  /** 账号 / 邮箱备注 */
  account?: string
  /** 官网 / 管理页链接 */
  manageUrl?: string
  /** API：OpenAI 兼容根地址 */
  baseUrl?: string
  /** API：Key 本地存储，永不明文回显 */
  apiKey?: string
  /** API：可用模型列表（可手填，也可从 /models 拉取） */
  models: string[]
  /** API：每百万 token 价格（可选，用于费用统计） */
  pricePrompt?: number
  priceCompletion?: number
  /** 额度展示（可选）：总额度与重置日 */
  quotaTotal?: number
  quotaUsed?: number
  quotaResetDay?: string // YYYY-MM-DD
  createdAt: number
}

export interface AiSession {
  id: string
  title: string
  providerId: string
  model: string
  sourceModule?: 'task' | 'doc'
  sourceId?: string
  sourceLabel?: string
  createdAt: number
  updatedAt: number
}

export interface AiMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  state: MessageState
  model?: string
  tokensIn?: number
  tokensOut?: number
  latencyMs?: number
  /** failed 态的失败原因（保留已生成内容） */
  error?: string
  createdAt: number
}

export interface AiUsageRow {
  id: string
  ts: number
  provider: string
  model: string
  tokensIn: number
  tokensOut: number
  cost: number
  latencyMs: number
  module: 'chat' | 'task' | 'doc' // 发起来源模块（时间×模型×模块下钻）
  ok: boolean
}

class WorkstationDB extends Dexie {
  tasks!: Table<Task, string>
  settings!: Table<SettingKV, string>
  docs!: Table<Doc, string>
  blobs!: Table<{ hash: string; blob: Blob }, string>
  positions!: Table<ReadingPosition, string>
  annotations!: Table<Annotation, string>
  bookmarks!: Table<Bookmark, string>
  aiProviders!: Table<AiProvider, string>
  aiSessions!: Table<AiSession, string>
  aiMessages!: Table<AiMessage, string>
  aiUsage!: Table<AiUsageRow, string>
  docText!: Table<DocText, string>
  focusSessions!: Table<FocusSession, string>

  constructor() {
    super('workstation')
    this.version(1).stores({
      tasks: 'id, tier, status, priority, due, doneAt, updatedAt',
      settings: 'key',
    })
    // v2（M2）：新增文档相关表，纯增表无需数据迁移
    this.version(2).stores({
      docs: 'id, hash, kind, lastOpenedAt',
      blobs: 'hash',
      positions: 'hash',
      annotations: 'id, docHash, page, blockIdx, createdAt',
      bookmarks: 'id, docHash',
    })
    // v3（M3）：AI 面板
    this.version(3).stores({
      aiProviders: 'id, name, createdAt',
      aiSessions: 'id, updatedAt, sourceModule',
      aiMessages: 'id, sessionId, createdAt',
      aiUsage: 'id, ts, provider, model, module',
    })
    // v4（v1.3）：全文索引 + 专注会话（纯增表）
    this.version(4).stores({
      docText: 'hash',
      focusSessions: 'id, day, taskId, ts',
    })
  }
}

export const db = new WorkstationDB()
