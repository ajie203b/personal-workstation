export interface AxisTick {
  value: number
  /** SVG 坐标（0..400） */
  pos: number
  label: string
  isZero: boolean
}

/** 选取 1 / 2 / 5 × 10^k 的人类友好刻度步长 */
export function computeNiceStep(span: number, targetTicks = 6): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1
  const raw = span / Math.max(2, targetTicks)
  const exp = Math.floor(Math.log10(raw))
  const mag = 10 ** exp
  const norm = raw / mag
  const step = norm <= 1.2 ? 1 : norm <= 2.4 ? 2 : norm <= 5.5 ? 5 : 10
  return step * mag
}

export function formatTickLabel(value: number, step: number): string {
  if (Math.abs(value) < step * 1e-6) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e5 || abs < 1e-3) return Number(value.toPrecision(3)).toExponential()
  const decimals = step < 1 ? Math.min(6, Math.max(0, Math.ceil(-Math.log10(step)) + 1)) : 0
  const rounded = Number(value.toFixed(decimals))
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

/** 计算二维坐标系在 [center - range, center + range] 内的自适应主刻度 */
export function computeAxisTicks(
  center: number,
  range: number,
  axis: 'x' | 'y',
  targetTicks = 6,
): AxisTick[] {
  if (!(range > 0) || !Number.isFinite(range) || !Number.isFinite(center)) return []
  const min = center - range
  const max = center + range
  const step = computeNiceStep(range * 2, targetTicks)
  const startIdx = Math.ceil(min / step - 1e-9)
  const endIdx = Math.floor(max / step + 1e-9)
  const ticks: AxisTick[] = []
  const limit = Math.min(endIdx, startIdx + 40)
  for (let i = startIdx; i <= limit; i++) {
    const rawVal = i * step
    const isZero = Math.abs(rawVal) < step * 1e-6
    const value = isZero ? 0 : rawVal
    const ratio = (value - center) / range
    const pos = axis === 'x' ? 200 + ratio * 200 : 200 - ratio * 200
    if (pos < -1 || pos > 401) continue
    ticks.push({ value, pos, label: formatTickLabel(value, step), isZero })
  }
  return ticks
}
