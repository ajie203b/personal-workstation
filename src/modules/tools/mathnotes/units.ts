import type { ComputeResult } from './types'
interface Unit { group: string; factor: number }
const units: Record<string, Unit> = {
  km:{group:'length',factor:1000}, 千米:{group:'length',factor:1000}, 公里:{group:'length',factor:1000},
  m:{group:'length',factor:1}, 米:{group:'length',factor:1}, cm:{group:'length',factor:.01}, 厘米:{group:'length',factor:.01},
  mm:{group:'length',factor:.001}, 毫米:{group:'length',factor:.001}, in:{group:'length',factor:.0254}, 英寸:{group:'length',factor:.0254},
  ft:{group:'length',factor:.3048}, 英尺:{group:'length',factor:.3048}, mi:{group:'length',factor:1609.344}, 英里:{group:'length',factor:1609.344},
  kg:{group:'mass',factor:1000}, 千克:{group:'mass',factor:1000}, 公斤:{group:'mass',factor:1000}, g:{group:'mass',factor:1}, 克:{group:'mass',factor:1},
  mg:{group:'mass',factor:.001}, 毫克:{group:'mass',factor:.001}, lb:{group:'mass',factor:453.59237}, 磅:{group:'mass',factor:453.59237},
  h:{group:'time',factor:3600}, 小时:{group:'time',factor:3600}, 时:{group:'time',factor:3600}, min:{group:'time',factor:60}, 分钟:{group:'time',factor:60},
  s:{group:'time',factor:1}, 秒:{group:'time',factor:1}, ms:{group:'time',factor:.001}, 毫秒:{group:'time',factor:.001}, 天:{group:'time',factor:86400},
}
const names = Object.keys(units).sort((a, b) => b.length - a.length).join('|')
const term = new RegExp(`([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))(${names})`, 'gy')
const err = (message: string): ComputeResult => ({ kind:'error', text:'', latex:'', message })

/** 只接管明确包含多个单位或目标单位的算式，避免把 2m+1 中的 m 猜成米。 */
export function computeUnits(raw: string): ComputeResult | null {
  const text = raw.trim().replace(/\s+/g, '').replace(/[−﹣]/g, '-').replace(/＝/g, '=')
  const split = text.split(/→|->|换算成/)
  if (split.length > 2) return err('单位换算格式不正确')
  const conversion = split.length === 2
  if (!conversion && !text.endsWith('=')) return null
  const body = split[0].replace(/=$/, '')
  const targetName = conversion ? split[1].replace(/=$/, '').toLowerCase() : ''
  const terms: { value: number; name: string; unit: Unit }[] = []
  term.lastIndex = 0
  let position = 0
  while (position < body.length) {
    term.lastIndex = position
    const match = term.exec(body)
    if (!match || (position > 0 && !/^[+-]/.test(match[1]))) break
    const name = match[2].toLowerCase()
    terms.push({ value: Number(match[1]), name: match[2], unit: units[name] })
    position = term.lastIndex
  }
  if (!terms.length || (!conversion && terms.length < 2)) return null
  if (position !== body.length) return conversion ? err('请输入完整的单位数值') : null
  const target = conversion ? units[targetName] : terms[0].unit
  if (!target) return err('不支持该目标单位')
  if (terms.some(t => t.unit.group !== target.group)) return err('单位类型不一致，无法计算')
  const value = terms.reduce((sum, t) => sum + t.value * t.unit.factor, 0) / target.factor
  if (!Number.isFinite(value)) return err('换算结果超出范围')
  const number = Number(value.toPrecision(12)).toString()
  const outputUnit = conversion ? split[1].replace(/=$/, '') : terms[0].name
  const textResult = `${number} ${outputUnit}`
  return { kind: 'inline', text: textResult, latex: textResult }
}
