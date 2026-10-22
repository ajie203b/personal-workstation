/**
 * 证件照规格（v3.3）：类型、内置预设、JSON 校验、用户自定义规格的 localStorage 存取。
 *
 * 规格不写死在界面里：内置预设只是默认值，用户可以直接编辑 JSON（宽高 px、DPI、
 * KB 上下限、格式、头高占比、头顶留白、排版张数），并「保存为我的规格」持久化。
 * 存储键 `idphoto.specs`（localStorage，不进 Dexie 备份——它是本机偏好不是用户数据）。
 */

/** 输出图片格式：证件照走 JPEG（带 DPI），需要透明底预览时用 PNG */
export type PhotoFormat = 'jpeg' | 'png'

export interface PhotoSpec {
  /** 标识；自定义规格保存时自动生成 */
  id: string
  /** 显示名，如「一寸」 */
  name: string
  /** 输出宽（px） */
  width: number
  /** 输出高（px） */
  height: number
  /** 输出 DPI（写进 JFIF APP0） */
  dpi: number
  /** 文件体积下限（KB） */
  minKb: number
  /** 文件体积上限（KB） */
  maxKb: number
  format: PhotoFormat
  /** 头顶到下巴占照片高的比例（证件照约 0.6~0.75） */
  headRatio: number
  /** 头顶以上留白占照片高的比例（约 0.06~0.12） */
  headroom: number
  /** 6 寸排版纸上放几张 */
  sheetCount: number
}

/** 公共默认值：每张规格只需要覆盖差异字段 */
type SpecSeed = Partial<PhotoSpec> & Pick<PhotoSpec, 'id' | 'name' | 'width' | 'height'>

/** 300dpi 下毫米 → 像素：px = mm / 25.4 * 300 */
const px = (mm: number) => Math.round((mm / 25.4) * 300)

const DEFAULTS = {
  dpi: 300,
  minKb: 5,
  maxKb: 20,
  format: 'jpeg' as PhotoFormat,
  headRatio: 0.7,
  headroom: 0.1,
  sheetCount: 4,
}

function seed(s: SpecSeed): PhotoSpec {
  return { ...DEFAULTS, ...s }
}

/**
 * 内置预设（尺寸都是 300dpi 换算的像素）：
 * 一寸 25×35mm、二寸 35×49mm、小一寸 22×32mm、小二寸 35×45mm、
 * 大一寸 33×48mm、大二寸 35×53mm、身份证 26×32mm、美国签证 51×51mm。
 */
export const BUILTIN_SPECS: PhotoSpec[] = [
  seed({ id: 'yicun', name: '一寸', width: 295, height: 413, minKb: 5, maxKb: 20, sheetCount: 8 }),
  seed({ id: 'ercun', name: '二寸', width: 413, height: 579, minKb: 10, maxKb: 30, sheetCount: 4 }),
  seed({ id: 'xiaoyicun', name: '小一寸', width: 260, height: 378, minKb: 5, maxKb: 15, sheetCount: 10 }),
  seed({ id: 'xiaoercun', name: '小二寸', width: 413, height: 531, minKb: 10, maxKb: 30, sheetCount: 4 }),
  seed({ id: 'dayicun', name: '大一寸', width: 390, height: 567, minKb: 10, maxKb: 30, sheetCount: 4 }),
  seed({ id: 'daercun', name: '大二寸', width: px(35), height: px(53), minKb: 10, maxKb: 30, sheetCount: 4 }),
  seed({ id: 'shenfenzheng', name: '身份证', width: px(26), height: px(32), minKb: 5, maxKb: 15, sheetCount: 8 }),
  seed({ id: 'meiqian', name: '美国签证', width: px(51), height: px(51), minKb: 10, maxKb: 40, sheetCount: 2 }),
]

/** 校验边界（写死上限是为了 JSON 手改出格时有明确报错而不是画出离谱的图） */
export const SPEC_LIMITS = {
  side: { min: 16, max: 4000 },
  dpi: { min: 72, max: 1200 },
  kb: { min: 1, max: 10240 },
  headRatio: { min: 0.3, max: 0.95 },
  headroom: { min: 0, max: 0.35 },
  sheetCount: { min: 1, max: 32 },
} as const

export type SpecValidation = { ok: true; spec: PhotoSpec } | { ok: false; error: string }

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * 校验并补全一条规格。id 缺失时补 'custom'，name 空/超长、数值出界都返回错误信息
 * （带字段名，方便用户对着 JSON 改）。
 */
export function validateSpec(input: unknown): SpecValidation {
  if (typeof input !== 'object' || input === null) return { ok: false, error: '规格必须是对象' }
  const raw = input as Record<string, unknown>

  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) return { ok: false, error: 'name 不能为空' }
  if (name.length > 32) return { ok: false, error: 'name 太长（最多 32 字）' }

  const width = num(raw.width)
  const height = num(raw.height)
  if (width === null || height === null) return { ok: false, error: 'width / height 必须是数字' }
  if (!Number.isInteger(width) || !Number.isInteger(height)) return { ok: false, error: 'width / height 必须是整数像素' }
  if (width < SPEC_LIMITS.side.min || width > SPEC_LIMITS.side.max) {
    return { ok: false, error: `width 超出 ${SPEC_LIMITS.side.min}~${SPEC_LIMITS.side.max}` }
  }
  if (height < SPEC_LIMITS.side.min || height > SPEC_LIMITS.side.max) {
    return { ok: false, error: `height 超出 ${SPEC_LIMITS.side.min}~${SPEC_LIMITS.side.max}` }
  }

  const dpi = num(raw.dpi) ?? DEFAULTS.dpi
  if (dpi < SPEC_LIMITS.dpi.min || dpi > SPEC_LIMITS.dpi.max) {
    return { ok: false, error: `dpi 超出 ${SPEC_LIMITS.dpi.min}~${SPEC_LIMITS.dpi.max}` }
  }

  const minKb = num(raw.minKb) ?? DEFAULTS.minKb
  const maxKb = num(raw.maxKb) ?? DEFAULTS.maxKb
  if (minKb < SPEC_LIMITS.kb.min || maxKb > SPEC_LIMITS.kb.max) {
    return { ok: false, error: `minKb / maxKb 超出 ${SPEC_LIMITS.kb.min}~${SPEC_LIMITS.kb.max}` }
  }
  if (minKb > maxKb) return { ok: false, error: 'minKb 不能大于 maxKb' }

  const format = raw.format ?? DEFAULTS.format
  if (format !== 'jpeg' && format !== 'png') return { ok: false, error: 'format 只能是 jpeg / png' }

  const headRatio = num(raw.headRatio) ?? DEFAULTS.headRatio
  if (headRatio < SPEC_LIMITS.headRatio.min || headRatio > SPEC_LIMITS.headRatio.max) {
    return { ok: false, error: `headRatio 超出 ${SPEC_LIMITS.headRatio.min}~${SPEC_LIMITS.headRatio.max}` }
  }
  const headroom = num(raw.headroom) ?? DEFAULTS.headroom
  if (headroom < SPEC_LIMITS.headroom.min || headroom > SPEC_LIMITS.headroom.max) {
    return { ok: false, error: `headroom 超出 ${SPEC_LIMITS.headroom.min}~${SPEC_LIMITS.headroom.max}` }
  }

  const sheetCount = num(raw.sheetCount) ?? DEFAULTS.sheetCount
  if (!Number.isInteger(sheetCount) || sheetCount < SPEC_LIMITS.sheetCount.min || sheetCount > SPEC_LIMITS.sheetCount.max) {
    return { ok: false, error: `sheetCount 超出 ${SPEC_LIMITS.sheetCount.min}~${SPEC_LIMITS.sheetCount.max}` }
  }

  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `custom-${name}`
  return {
    ok: true,
    spec: { id, name, width, height, dpi, minKb, maxKb, format, headRatio, headroom, sheetCount },
  }
}

export type SpecsValidation = { ok: true; specs: PhotoSpec[] } | { ok: false; error: string }

/**
 * 解析规格 JSON。接受数组或 { "specs": [...] } 两种写法；
 * 逐条校验，任何一条不合法都报错（带上第几条），避免"半对"的规格悄悄生效。
 */
export function parseSpecsJson(text: string): SpecsValidation {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'JSON 格式错误' }
  }
  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { specs?: unknown }).specs)
      ? (parsed as { specs: unknown[] }).specs
      : null
  if (!list) return { ok: false, error: '顶层需要是数组，或含 specs 数组的对象' }
  if (!list.length) return { ok: false, error: '至少要有一条规格' }

  const specs: PhotoSpec[] = []
  for (let i = 0; i < list.length; i++) {
    const res = validateSpec(list[i])
    if (!res.ok) return { ok: false, error: `第 ${i + 1} 条：${res.error}` }
    specs.push(res.spec)
  }
  return { ok: true, specs }
}

export function serializeSpecs(specs: PhotoSpec[]): string {
  return JSON.stringify(specs, null, 2)
}

/** localStorage 键：用户自定义规格 */
export const SPECS_STORAGE_KEY = 'idphoto.specs'

/** 读自定义规格；坏数据（手改 localStorage / 半截 JSON）静默丢弃，不让页面崩 */
export function loadCustomSpecs(): PhotoSpec[] {
  try {
    const text = localStorage.getItem(SPECS_STORAGE_KEY)
    if (!text) return []
    const res = parseSpecsJson(text)
    return res.ok ? res.specs : []
  } catch {
    return []
  }
}

/** 存自定义规格：先整体校验再写，失败不落盘 */
export function saveCustomSpecs(specs: PhotoSpec[]): SpecsValidation {
  const checks = specs.map((s) => validateSpec(s))
  const bad = checks.find((c) => !c.ok)
  if (bad && !bad.ok) return { ok: false, error: bad.error }
  const clean = checks.flatMap((c) => (c.ok ? [c.spec] : []))
  try {
    localStorage.setItem(SPECS_STORAGE_KEY, serializeSpecs(clean))
    return { ok: true, specs: clean }
  } catch {
    return { ok: false, error: '写入本地存储失败' }
  }
}
