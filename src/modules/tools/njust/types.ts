/** NJUST 报告排版：输入解析后的中间文档模型。 */

export type Inline =
  | { type: 'text'; text: string; bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean }
  | { type: 'math'; latex: string }
  | { type: 'break' }

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; inlines: Inline[]; quote?: boolean }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'code'; text: string; lang?: string }
  | { type: 'image'; src: string; alt: string; caption?: string }
  | { type: 'table'; headers: string[]; rows: string[][]; caption?: string }
  | { type: 'math'; latex: string }

export interface SourceStats {
  headings: number
  paragraphs: number
  lists: number
  tables: number
  images: number
  formulas: number
  words: number
}

export interface ParsedSource {
  blocks: Block[]
  /** 首个一级标题自动作为报告题目（已从 blocks 移除） */
  title?: string
  warnings: string[]
  stats: SourceStats
}

export interface ReportMeta {
  course: string
  reportType: string
  title: string
  name: string
  studentId: string
  college: string
  major: string
  teacher: string
  date: string
  score: string
}

export interface ReportOptions {
  cover: boolean
  reviewBox: boolean
  headerFooter: boolean
  autoNumberHeadings: boolean
}

export interface BinaryImage {
  data: Uint8Array
  type: 'png' | 'jpg' | 'gif' | 'bmp'
  width: number
  height: number
}

export interface ReportLogos {
  cover: BinaryImage
  header: BinaryImage
}
