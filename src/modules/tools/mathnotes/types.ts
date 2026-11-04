/**
 * 手写计算（数学笔记）的数据结构。
 *
 * 坐标一律是「画布世界坐标」（CSS 像素，原点在画布左上角，不随缩放变化），
 * 这样存盘、聚类、渲染识别图都用同一套数。
 */

/** 笔迹采样点：x/y 世界坐标，p 压感 0~1（鼠标/不支持压感时给 0.5），t 毫秒时间戳 */
export interface InkPoint {
  x: number
  y: number
  p: number
  t: number
}

export interface Stroke {
  id: string
  points: InkPoint[]
  /** 笔宽基准（CSS 像素），压感在此基础上缩放 */
  width: number
}

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 一个独立算式块：按包围盒把笔画聚出来的一组 */
export interface InkBlock {
  /** 由组内笔画 id 排序拼出，笔画不变则 key 不变（用来复用识别结果） */
  key: string
  strokeIds: string[]
  box: Box
}

/** 识别 + 计算结果 */
export type ComputeKind =
  /** 写了「=」：答案直接写在等号后面 */
  | 'inline'
  /** 没写等号的方程 / 方程组：解显示在下方 */
  | 'solutions'
  /** 矩阵 / 向量结果：显示在下方 */
  | 'matrix'
  /** 没写等号的普通表达式：结果小字显示在下方 */
  | 'below'
  /** 识别或计算失败 */
  | 'error'
  /** 只是文字/算式，没东西可算（例如纯数字） */
  | 'none'

export interface ComputeResult {
  kind: ComputeKind
  /** 结果的 LaTeX（KaTeX 渲染用） */
  latex: string
  /** 结果的纯文本（简单数字时用手写字体直接画；为空表示必须走 KaTeX） */
  text: string
  /** 另一种写法：精确值是分数/根式/π 时补一个近似小数（≈ 后面显示） */
  alt?: string
  /** 失败原因（kind=error 时） */
  message?: string
}

/** 一个块的识别状态（存盘时一起存，下次打开不必重跑模型） */
export interface BlockResult {
  key: string
  /** 模型识别出的 LaTeX */
  recognized: string
  /** 用户在 MathLive 里改过的 LaTeX；有则优先 */
  edited?: string
  result: ComputeResult
}

/** 插入笔记的图像；位置是画布世界坐标，随页面备份和同步。 */
export interface NoteGraph {
  id: string
  expression: string
  sourceKey?: string
  x: number
  y: number
  width: number
  height: number
  range: number
  centerX?: number
  centerY?: number
  hiddenCurves?: number[]
  tMin: number
  tMax: number
}

/** 一页笔记 */
export interface MathNotePage {
  id: string
  title: string
  strokes: Stroke[]
  results: BlockResult[]
  graphs?: NoteGraph[]
  createdAt: number
  updatedAt: number
}
