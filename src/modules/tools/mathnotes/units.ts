import { normalizeLatex } from './latexNormalize'
import type { ComputeResult } from './types'

interface LinearUnit {
  kind: 'linear'
  group: string
  factor: number
  display: string
  strictCase?: boolean
}

interface TempUnit {
  kind: 'temp'
  group: 'temp'
  scale: 'C' | 'F' | 'K'
  display: string
  strictCase?: boolean
}

type UnitDef = LinearUnit | TempUnit

const lin = (group: string, factor: number, display: string, strictCase = false): LinearUnit => ({
  kind: 'linear',
  group,
  factor,
  display,
  strictCase,
})

const UNITS: Record<string, UnitDef> = {
  // 长度
  km: lin('length', 1000, 'km'), 千米: lin('length', 1000, '千米'), 公里: lin('length', 1000, '公里'),
  m: lin('length', 1, 'm'), 米: lin('length', 1, '米'),
  dm: lin('length', 0.1, 'dm'), 分米: lin('length', 0.1, '分米'),
  cm: lin('length', 0.01, 'cm'), 厘米: lin('length', 0.01, '厘米'),
  mm: lin('length', 0.001, 'mm'), 毫米: lin('length', 0.001, '毫米'),
  um: lin('length', 1e-6, 'μm'), μm: lin('length', 1e-6, 'μm'), 微米: lin('length', 1e-6, '微米'),
  nm: lin('length', 1e-9, 'nm'), 纳米: lin('length', 1e-9, '纳米'),
  in: lin('length', 0.0254, 'in'), 英寸: lin('length', 0.0254, '英寸'),
  ft: lin('length', 0.3048, 'ft'), 英尺: lin('length', 0.3048, '英尺'),
  yd: lin('length', 0.9144, 'yd'), 码: lin('length', 0.9144, '码'),
  mi: lin('length', 1609.344, 'mi'), 英里: lin('length', 1609.344, '英里'),
  // 质量
  ton: lin('mass', 1e6, 'ton'), 吨: lin('mass', 1e6, '吨'),
  kg: lin('mass', 1000, 'kg'), 千克: lin('mass', 1000, '千克'), 公斤: lin('mass', 1000, '公斤'),
  斤: lin('mass', 500, '斤'),
  两: lin('mass', 50, '两'),
  g: lin('mass', 1, 'g'), 克: lin('mass', 1, '克'),
  mg: lin('mass', 0.001, 'mg'), 毫克: lin('mass', 0.001, '毫克'),
  lb: lin('mass', 453.59237, 'lb'), 磅: lin('mass', 453.59237, '磅'),
  oz: lin('mass', 28.349523125, 'oz'), 盎司: lin('mass', 28.349523125, '盎司'),
  // 时间
  周: lin('time', 604800, '周'), 星期: lin('time', 604800, '星期'),
  天: lin('time', 86400, '天'),
  h: lin('time', 3600, 'h'), hr: lin('time', 3600, 'h'), 小时: lin('time', 3600, '小时'), 时: lin('time', 3600, '时'),
  min: lin('time', 60, 'min'), 分钟: lin('time', 60, '分钟'), 分: lin('time', 60, '分钟'),
  s: lin('time', 1, 's'), sec: lin('time', 1, 's'), 秒: lin('time', 1, '秒'),
  ms: lin('time', 0.001, 'ms'), 毫秒: lin('time', 0.001, '毫秒'),
  // 面积
  'km²': lin('area', 1e6, 'km²'), 平方千米: lin('area', 1e6, '平方千米'), 平方公里: lin('area', 1e6, '平方公里'),
  ha: lin('area', 1e4, 'ha'), 公顷: lin('area', 1e4, '公顷'),
  亩: lin('area', 2000 / 3, '亩'),
  'm²': lin('area', 1, 'm²'), 平方米: lin('area', 1, '平方米'), 平米: lin('area', 1, '平米'),
  'dm²': lin('area', 0.01, 'dm²'), 平方分米: lin('area', 0.01, '平方分米'),
  'cm²': lin('area', 1e-4, 'cm²'), 平方厘米: lin('area', 1e-4, '平方厘米'),
  'mm²': lin('area', 1e-6, 'mm²'), 平方毫米: lin('area', 1e-6, '平方毫米'),
  'ft²': lin('area', 0.09290304, 'ft²'), 平方英尺: lin('area', 0.09290304, '平方英尺'),
  'in²': lin('area', 0.00064516, 'in²'), 平方英寸: lin('area', 0.00064516, '平方英寸'),
  // 体积
  'm³': lin('volume', 1000, 'm³'), 立方米: lin('volume', 1000, '立方米'),
  'dm³': lin('volume', 1, 'dm³'), 立方分米: lin('volume', 1, '立方分米'),
  'cm³': lin('volume', 0.001, 'cm³'), cc: lin('volume', 0.001, 'cm³'), 立方厘米: lin('volume', 0.001, '立方厘米'),
  'mm³': lin('volume', 1e-6, 'mm³'), 立方毫米: lin('volume', 1e-6, '立方毫米'),
  l: lin('volume', 1, 'L', true), 升: lin('volume', 1, '升'),
  ml: lin('volume', 0.001, 'mL'), 毫升: lin('volume', 0.001, '毫升'),
  gal: lin('volume', 3.785411784, 'gal'), 加仑: lin('volume', 3.785411784, '加仑'),
  // 数据存储（二进制 1024 进制）
  pb: lin('storage', 1024 ** 5, 'PB'),
  tb: lin('storage', 1024 ** 4, 'TB'), tib: lin('storage', 1024 ** 4, 'TiB'),
  gb: lin('storage', 1024 ** 3, 'GB'), gib: lin('storage', 1024 ** 3, 'GiB'),
  mb: lin('storage', 1024 ** 2, 'MB'), mib: lin('storage', 1024 ** 2, 'MiB'), 兆字节: lin('storage', 1024 ** 2, '兆字节'),
  kb: lin('storage', 1024, 'KB'), kib: lin('storage', 1024, 'KiB'), 千字节: lin('storage', 1024, '千字节'),
  b: lin('storage', 1, 'B', true), byte: lin('storage', 1, 'B'), bytes: lin('storage', 1, 'B'), 字节: lin('storage', 1, '字节'),
  // 速度
  'km/h': lin('speed', 1000 / 3600, 'km/h'), kph: lin('speed', 1000 / 3600, 'km/h'), 'km/hr': lin('speed', 1000 / 3600, 'km/h'),
  '千米/时': lin('speed', 1000 / 3600, '千米/时'), '公里/小时': lin('speed', 1000 / 3600, '公里/小时'),
  'm/s': lin('speed', 1, 'm/s'), '米/秒': lin('speed', 1, '米/秒'),
  'km/s': lin('speed', 1000, 'km/s'), '千米/秒': lin('speed', 1000, '千米/秒'),
  'm/min': lin('speed', 1 / 60, 'm/min'),
  mph: lin('speed', 1609.344 / 3600, 'mph'), 'mi/h': lin('speed', 1609.344 / 3600, 'mi/h'), '英里/小时': lin('speed', 1609.344 / 3600, '英里/小时'),
  knot: lin('speed', 1852 / 3600, 'kn'), kn: lin('speed', 1852 / 3600, 'kn'), 节: lin('speed', 1852 / 3600, '节'),
  // 温度
  '°c': { kind: 'temp', group: 'temp', scale: 'C', display: '°C' },
  摄氏度: { kind: 'temp', group: 'temp', scale: 'C', display: '摄氏度' },
  c: { kind: 'temp', group: 'temp', scale: 'C', display: '°C', strictCase: true },
  '°f': { kind: 'temp', group: 'temp', scale: 'F', display: '°F' },
  华氏度: { kind: 'temp', group: 'temp', scale: 'F', display: '华氏度' },
  f: { kind: 'temp', group: 'temp', scale: 'F', display: '°F', strictCase: true },
  '°k': { kind: 'temp', group: 'temp', scale: 'K', display: 'K' },
  k: { kind: 'temp', group: 'temp', scale: 'K', display: 'K', strictCase: true },
  开尔文: { kind: 'temp', group: 'temp', scale: 'K', display: '开尔文' },
  // 压强
  mpa: lin('pressure', 1e6, 'MPa'),
  kpa: lin('pressure', 1000, 'kPa'),
  pa: lin('pressure', 1, 'Pa'),
  bar: lin('pressure', 1e5, 'bar'),
  atm: lin('pressure', 101325, 'atm'),
  // 能量
  kwh: lin('energy', 3.6e6, 'kWh'),
  kj: lin('energy', 1000, 'kJ'),
  j: lin('energy', 1, 'J', true),
  kcal: lin('energy', 4184, 'kcal'),
  cal: lin('energy', 4.184, 'cal'),
  // 功率
  mw: lin('power', 1e6, 'MW', true),
  kw: lin('power', 1000, 'kW'),
  w: lin('power', 1, 'W', true),
  // 频率
  ghz: lin('freq', 1e9, 'GHz'),
  mhz: lin('freq', 1e6, 'MHz'),
  khz: lin('freq', 1000, 'kHz'),
  hz: lin('freq', 1, 'Hz'),
}

const UNIT_KEYS = Object.keys(UNITS).sort((a, b) => b.length - a.length)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const UNIT_RE = new RegExp(`(${UNIT_KEYS.map(escapeRe).join('|')})`, 'iy')
const NUM_RE = /(?:\d+(?:\.\d*)?|\.\d+)/y

const err = (message: string): ComputeResult => ({ kind: 'error', text: '', latex: '', message })

function toKelvin(value: number, scale: 'C' | 'F' | 'K'): number {
  if (scale === 'C') return value + 273.15
  if (scale === 'F') return (value - 32) * 5 / 9 + 273.15
  return value
}

function fromKelvin(kelvin: number, scale: 'C' | 'F' | 'K'): number {
  if (scale === 'C') return kelvin - 273.15
  if (scale === 'F') return (kelvin - 273.15) * 9 / 5 + 32
  return kelvin
}

/** 预处理 LaTeX / 全角符号，让 \mathrm、\text、\,、\to、°C、m^2 统一进入单位求值。 */
function preprocessUnitText(raw: string): string {
  // 先把 \to / \rightarrow 转成 →，避免 \to\mathrm{m} 去包裹后粘连成 \tom
  let s = raw.replace(/\\(?:to|rightarrow|longrightarrow|implies)(?![a-zA-Z])/g, '→')
  s = normalizeLatex(s)
  s = s.replace(/\\times(?![a-zA-Z])|\\cdot(?![a-zA-Z])|[×·]/g, '*')
  s = s.replace(/\\div(?![a-zA-Z])|[÷／]/g, '/')
  s = s.replace(/\^\s*\{?\s*\\circ\s*\}?|\\degree(?![a-zA-Z])|º/g, '°')
  s = s.replace(/℃/g, '°C').replace(/℉/g, '°F')
  s = s.replace(/(km|dm|cm|mm|ft|in|m)\s*\^\s*\{?\s*2\s*\}?/gi, '$1²')
  s = s.replace(/(dm|cm|mm|m)\s*\^\s*\{?\s*3\s*\}?/gi, '$1³')
  s = s.replace(/\\left\s*\(/g, '(').replace(/\\right\s*\)/g, ')')
  for (let i = 0; i < 2; i++) {
    s = s.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '(($1)/($2))')
  }
  return s.replace(/\s+/g, '').replace(/[−﹣]/g, '-').replace(/＝/g, '=')
}

interface Qty {
  /** 线性单位换算为基准单位的值；温度时直接存原温标数值 */
  value: number
  unit: UnitDef | null
  /** 首个出现的单位，用于确定同组相加减后的输出单位 */
  displayUnit: UnitDef | null
  unitCount: number
  unitTokens: string[]
  mulDivCount: number
  error?: string
}

class UnitParser {
  pos = 0
  constructor(
    private readonly s: string,
    private readonly conversion: boolean,
  ) {}

  private peek(): string {
    return this.s[this.pos] ?? ''
  }

  private matchUnit(): { raw: string; def: UnitDef } | null {
    UNIT_RE.lastIndex = this.pos
    const m = UNIT_RE.exec(this.s)
    if (!m) return null
    const raw = m[1]
    const nextChar = this.s[UNIT_RE.lastIndex] ?? ''
    // 若紧跟字母，说明是一个更长的普通标识符（如 m 后面跟着 ax），不拆成单位
    if (/[a-zA-Z]/.test(nextChar)) return null
    const def = UNITS[raw.toLowerCase()]
    if (!def) return null
    // 单字母区分大小写的单位（L/B/K 等）默认需大写；若在换算场景或同表达式存在同组明确单位（如 2l+500ml=）则放宽
    if (def.strictCase && !this.conversion && raw.length === 1 && raw !== raw.toUpperCase()) {
      const siblingPattern: Record<string, RegExp> = {
        volume: /(?:ml|m³|dm³|cm³|mm³|gal|升|毫升|立方)/i,
        storage: /(?:kb|mb|gb|tb|pb|kib|mib|gib|tib|字节)/i,
        temp: /(?:°c|°f|℃|℉|摄氏度|华氏度|开尔文)/i,
        energy: /(?:kj|kwh|kcal|cal)/i,
        power: /(?:kw|mw)/i,
      }
      if (!siblingPattern[def.group]?.test(this.s)) return null
    }
    this.pos = UNIT_RE.lastIndex
    return { raw, def }
  }

  parseExpr(): Qty | null {
    const first = this.parseTerm()
    if (!first) return null
    let acc = first
    while (this.peek() === '+' || this.peek() === '-') {
      const op = this.s[this.pos++]
      const rhs = this.parseTerm()
      if (!rhs) return null
      if (acc.error) return acc
      if (rhs.error) return rhs
      if (!acc.unit && !rhs.unit) {
        acc = {
          value: op === '+' ? acc.value + rhs.value : acc.value - rhs.value,
          unit: null,
          displayUnit: null,
          unitCount: 0,
          unitTokens: [],
          mulDivCount: acc.mulDivCount + rhs.mulDivCount,
        }
        continue
      }
      if (!acc.unit || !rhs.unit) {
        return { ...acc, error: '__scalar_unit_mix__' }
      }
      if (acc.unit.group !== rhs.unit.group) {
        return { ...acc, error: '单位类型不一致，无法计算' }
      }
      if (acc.unit.kind === 'temp' && rhs.unit.kind === 'temp') {
        if (acc.unit.scale !== rhs.unit.scale) {
          return { ...acc, error: '不同温度单位请先换算为同一单位后再加减' }
        }
        acc = {
          value: op === '+' ? acc.value + rhs.value : acc.value - rhs.value,
          unit: acc.unit,
          displayUnit: acc.displayUnit,
          unitCount: acc.unitCount + rhs.unitCount,
          unitTokens: [...acc.unitTokens, ...rhs.unitTokens],
          mulDivCount: acc.mulDivCount + rhs.mulDivCount,
        }
        continue
      }
      acc = {
        value: op === '+' ? acc.value + rhs.value : acc.value - rhs.value,
        unit: acc.unit,
        displayUnit: acc.displayUnit,
        unitCount: acc.unitCount + rhs.unitCount,
        unitTokens: [...acc.unitTokens, ...rhs.unitTokens],
        mulDivCount: acc.mulDivCount + rhs.mulDivCount,
      }
    }
    return acc
  }

  private parseTerm(): Qty | null {
    const first = this.parseFactor()
    if (!first) return null
    let acc = first
    while (this.peek() === '*' || this.peek() === '/') {
      const op = this.s[this.pos++]
      const rhs = this.parseFactor()
      if (!rhs) return null
      if (acc.error) return acc
      if (rhs.error) return rhs
      if (op === '*') {
        if (acc.unit && rhs.unit) return { ...acc, error: '暂不支持两个单位直接相乘' }
        const unit = acc.unit ?? rhs.unit
        const displayUnit = acc.displayUnit ?? rhs.displayUnit
        acc = {
          value: acc.value * rhs.value,
          unit,
          displayUnit,
          unitCount: acc.unitCount + rhs.unitCount,
          unitTokens: [...acc.unitTokens, ...rhs.unitTokens],
          mulDivCount: acc.mulDivCount + rhs.mulDivCount + (unit ? 1 : 0),
        }
      } else {
        if (rhs.value === 0) return { ...acc, error: '除数不能为 0' }
        if (!acc.unit && rhs.unit) return { ...acc, error: '暂不支持标量除以单位' }
        if (acc.unit && rhs.unit) {
          if (acc.unit.group !== rhs.unit.group) return { ...acc, error: '单位类型不一致，无法计算' }
          if (acc.unit.kind === 'temp') return { ...acc, error: '温度不支持直接相除' }
          // 同量纲比值得到无量纲标量
          acc = {
            value: acc.value / rhs.value,
            unit: null,
            displayUnit: null,
            unitCount: acc.unitCount + rhs.unitCount,
            unitTokens: [...acc.unitTokens, ...rhs.unitTokens],
            mulDivCount: acc.mulDivCount + rhs.mulDivCount + 1,
          }
        } else {
          acc = {
            value: acc.value / rhs.value,
            unit: acc.unit,
            displayUnit: acc.displayUnit,
            unitCount: acc.unitCount + rhs.unitCount,
            unitTokens: [...acc.unitTokens, ...rhs.unitTokens],
            mulDivCount: acc.mulDivCount + rhs.mulDivCount + (acc.unit ? 1 : 0),
          }
        }
      }
    }
    return acc
  }

  private parseFactor(): Qty | null {
    let sign = 1
    while (this.peek() === '+' || this.peek() === '-') {
      if (this.s[this.pos++] === '-') sign = -sign
    }
    let q: Qty
    if (this.peek() === '(') {
      this.pos++
      const inner = this.parseExpr()
      if (!inner || this.peek() !== ')') return null
      this.pos++
      q = { ...inner, value: sign * inner.value }
    } else {
      NUM_RE.lastIndex = this.pos
      const nm = NUM_RE.exec(this.s)
      if (!nm) return null
      this.pos = NUM_RE.lastIndex
      const num = sign * Number(nm[0])
      const u = this.matchUnit()
      q = u
        ? {
            value: u.def.kind === 'linear' ? num * u.def.factor : num,
            unit: u.def,
            displayUnit: u.def,
            unitCount: 1,
            unitTokens: [u.raw],
            mulDivCount: 0,
          }
        : { value: num, unit: null, displayUnit: null, unitCount: 0, unitTokens: [], mulDivCount: 0 }
    }
    // 支持括号外直接附带单位，如 (1/2)m
    if (!q.unit) {
      const u = this.matchUnit()
      if (u) {
        q = {
          value: u.def.kind === 'linear' ? q.value * u.def.factor : q.value,
          unit: u.def,
          displayUnit: u.def,
          unitCount: 1,
          unitTokens: [u.raw],
          mulDivCount: q.mulDivCount,
        }
      }
    }
    // 支持复合单位连写累加（如 2小时30分钟、1m50cm）
    while (q.unit?.kind === 'linear') {
      const savedPos = this.pos
      NUM_RE.lastIndex = this.pos
      const nextNum = NUM_RE.exec(this.s)
      if (!nextNum) break
      this.pos = NUM_RE.lastIndex
      const nextUnit = this.matchUnit()
      if (!nextUnit || nextUnit.def.kind !== 'linear' || nextUnit.def.group !== q.unit.group) {
        this.pos = savedPos
        break
      }
      const addVal = (q.value < 0 ? -1 : 1) * Number(nextNum[0]) * nextUnit.def.factor
      q = {
        ...q,
        value: q.value + addVal,
        unitCount: q.unitCount + 1,
        unitTokens: [...q.unitTokens, nextUnit.raw],
      }
    }
    return q
  }
}

export interface UnitOptions {
  /** 已定义的页面变量集合：用于避免把 `m=5` 后的 `2m*3=` 抢先当作长度单位 */
  definedVars?: Set<string>
}

/** 只接管明确包含多单位、单位换算或带单位标量乘除的算式，避免把 2m+1 中的 m 猜成米。 */
export function computeUnits(raw: string, opts?: UnitOptions): ComputeResult | null {
  const text = preprocessUnitText(raw)
  let split = text.split(/→|->|换算成/)
  if (split.length > 2) return err('单位换算格式不正确')
  let conversion = split.length === 2
  // 支持 `5km=m` / `100°C=°F` / `5km=?m` 这种等号目标单位写法
  if (!conversion) {
    const eqTarget = text.match(/^(.+?)=\??([a-zA-Z°\u4e00-\u9fa5²³/]+)=?$/)
    if (eqTarget && eqTarget[2] && UNITS[eqTarget[2].toLowerCase()]) {
      split = [eqTarget[1], eqTarget[2]]
      conversion = true
    }
  }
  if (!conversion && !text.endsWith('=')) return null
  const body = split[0].replace(/=$/, '')
  if (!body) return conversion ? err('请输入完整的单位数值') : null

  const parser = new UnitParser(body, conversion)
  const parsed = parser.parseExpr()
  if (!parsed || parser.pos !== body.length) {
    return conversion ? err('请输入完整的单位数值') : null
  }
  if (parsed.error === '__scalar_unit_mix__') return null
  if (!parsed.unit || parsed.unitCount === 0) {
    if (conversion) return err('请输入带单位的数值')
    if (!parsed.error && parsed.unitCount >= 2) {
      if (!Number.isFinite(parsed.value)) return err('换算结果超出范围')
      const rounded = Number(parsed.value.toPrecision(12))
      const number = (Object.is(rounded, -0) ? 0 : rounded).toString()
      return { kind: 'inline', text: number, latex: number }
    }
    return null
  }
  if (parsed.error) return err(parsed.error)
  if (!conversion && parsed.unitCount < 2 && parsed.mulDivCount === 0) {
    return null
  }
  if (
    !conversion &&
    parsed.unitTokens.length === 1 &&
    parsed.unitTokens[0].length === 1 &&
    opts?.definedVars?.has(parsed.unitTokens[0])
  ) {
    return null
  }

  let target: UnitDef
  if (conversion) {
    const targetRaw = split[1].replace(/=$/, '')
    const lookup = UNITS[targetRaw.toLowerCase()]
    if (!lookup) return err('不支持该目标单位')
    target = lookup
  } else {
    target = parsed.displayUnit ?? parsed.unit
  }

  if (parsed.unit.group !== target.group) return err('单位类型不一致，无法计算')

  let value: number
  if (parsed.unit.kind === 'temp' && target.kind === 'temp') {
    value = parsed.unit.scale === target.scale ? parsed.value : fromKelvin(toKelvin(parsed.value, parsed.unit.scale), target.scale)
  } else if (parsed.unit.kind === 'linear' && target.kind === 'linear') {
    value = parsed.value / target.factor
  } else {
    return err('单位类型不一致，无法计算')
  }

  if (!Number.isFinite(value)) return err('换算结果超出范围')
  const rounded = Number(value.toPrecision(12))
  const number = (Object.is(rounded, -0) ? 0 : rounded).toString()
  const textResult = `${number} ${target.display}`
  return { kind: 'inline', text: textResult, latex: textResult }
}
