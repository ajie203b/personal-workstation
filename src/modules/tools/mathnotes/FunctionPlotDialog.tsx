import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from '@/shared/ui/Sheet'
import { Button } from '@/shared/ui/Button'
import type { PlotCurve } from './plot'
import { findIntersections, nearestCurvePoint } from './plotIntersections'

/** 曲线按空值和大幅跳变断开，避免将渐近线画成竖线。 */
export function plotPaths(values: (number | null)[], range: number, centerY = 0): string[] {
  const segments: string[] = []
  let path = ''
  let previous: number | null = null
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v) || Math.abs(v - centerY) > range * 4) {
      if (path) segments.push(path)
      path = ''; previous = null; return
    }
    const x = (i / Math.max(1, values.length - 1)) * 400
    const y = 200 - (v - centerY) / range * 200
    if (previous != null && Math.abs(y - previous) > 400) {
      if (path) segments.push(path)
      path = ''
    }
    path += `${path ? ' L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`
    previous = y
  })
  if (path) segments.push(path)
  return segments
}

/** 参数曲线的实数点映射到画布，遇到无定义点或大跳变时断开。 */
export function parametricPaths(points: ([number, number] | null)[], range: number, centerX = 0, centerY = 0): string[] {
  const paths: string[] = []
  let path = '', previous: [number, number] | null = null
  for (const point of points) {
    if (!point || !point.every(Number.isFinite) || Math.abs(point[0] - centerX) > range * 4 || Math.abs(point[1] - centerY) > range * 4) {
      if (path) paths.push(path); path = ''; previous = null; continue
    }
    const x = 200 + (point[0] - centerX) / range * 200, y = 200 - (point[1] - centerY) / range * 200
    if (previous && Math.hypot(x - previous[0], y - previous[1]) > 400) { if (path) paths.push(path); path = '' }
    path += `${path ? ' L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`
    previous = [x, y]
  }
  if (path) paths.push(path)
  return paths
}

/** 正交投影：旋转角度控制观察方向；坐标先按显示范围归一化。 */
export function project3d(x: number, y: number, z: number, yaw: number, pitch: number): [number, number] {
  const side = x * Math.cos(yaw) - y * Math.sin(yaw)
  const depth = x * Math.sin(yaw) + y * Math.cos(yaw)
  return [200 + 105 * side, 200 - 105 * (z * Math.cos(pitch) - depth * Math.sin(pitch))]
}

export function parametric3dPaths(points: ([number, number, number] | null)[], range: number, yaw: number, pitch: number): string[] {
  const paths: string[] = []
  let path = '', previous: [number, number] | null = null
  for (const point of points) {
    if (!point || !point.every(Number.isFinite) || point.some(v => Math.abs(v) > range * 4)) {
      if (path) paths.push(path); path = ''; previous = null; continue
    }
    const projected = project3d(point[0] / range, point[1] / range, point[2] / range, yaw, pitch)
    if (previous && Math.hypot(projected[0] - previous[0], projected[1] - previous[1]) > 180) { if (path) paths.push(path); path = '' }
    path += `${path ? ' L' : 'M'}${projected[0].toFixed(2)} ${projected[1].toFixed(2)}`
    previous = projected
  }
  if (path) paths.push(path)
  return paths
}

export function surfacePaths(values: (number | null)[][], range: number, yaw: number, pitch: number): string[] {
  const n = values.length - 1
  if (n < 1) return []
  const paths: string[] = []
  for (let direction = 0; direction < 2; direction++) for (let line = 0; line <= n; line += 2) {
    let path = '', previous: [number, number] | null = null
    for (let i = 0; i <= n; i++) {
      const row = direction ? i : line, col = direction ? line : i, value = values[row]?.[col]
      if (value == null || !Number.isFinite(value) || Math.abs(value) > range * 3) {
        if (path) paths.push(path); path = ''; previous = null; continue
      }
      const point = project3d(-1 + 2 * col / n, -1 + 2 * row / n, value / range, yaw, pitch)
      if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 120) { if (path) paths.push(path); path = '' }
      path += `${path ? ' L' : 'M'}${point[0].toFixed(2)} ${point[1].toFixed(2)}`
      previous = point
    }
    if (path) paths.push(path)
  }
  return paths
}

export function FunctionPlotDialog({ open, initial, onOpenChange, plot, onInsert, initialRange = 10, initialCenterX = 0, initialCenterY = 0, initialTMin = 0, initialTMax = Math.PI * 2, initialHidden = '' }: {
  open: boolean; initial: string; onOpenChange: (open: boolean) => void
  onInsert?: (expression: string, range: number, tMin: number, tMax: number, centerX: number, centerY: number, hiddenCurves: number[]) => void
  initialRange?: number; initialCenterX?: number; initialCenterY?: number; initialTMin?: number; initialTMax?: number; initialHidden?: string
  plot: (latex: string, min: number, max: number, tMin: number, tMax: number, centerX?: number, centerY?: number) => Promise<PlotCurve[]>
}) {
  const [input, setInput] = useState(initial)
  const [expression, setExpression] = useState(initial)
  const [range, setRange] = useState(initialRange)
  const [centerX, setCenterX] = useState(initialCenterX)
  const [centerY, setCenterY] = useState(initialCenterY)
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const [inspected, setInspected] = useState<ReturnType<typeof nearestCurvePoint>>(null)
  const pointers = useRef(new Map<number, {x: number; y: number}>())
  const gesture = useRef<{ x: number; y: number; centerX: number; centerY: number; range: number; distance?: number; pinch: boolean } | null>(null)
  const [tStart, setTStart] = useState('0')
  const [tEnd, setTEnd] = useState('6.283185307')
  const [tRange, setTRange] = useState<[number, number]>([0, Math.PI * 2])
  const [yaw, setYaw] = useState(-0.65)
  const [pitch, setPitch] = useState(0.65)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [curves, setCurves] = useState<PlotCurve[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showIntersections, setShowIntersections] = useState(true)
  useEffect(() => { if (open) { setInput(initial); setExpression(initial); setRange(initialRange); setCenterX(initialCenterX); setCenterY(initialCenterY); setHidden(new Set(initialHidden ? initialHidden.split(',').map(Number).filter(Number.isInteger) : [])); setInspected(null); setTStart(String(initialTMin)); setTEnd(String(initialTMax)); setTRange(previous => previous[0] === initialTMin && previous[1] === initialTMax ? previous : [initialTMin, initialTMax]); setYaw(-0.65); setPitch(0.65) } }, [open, initial, initialRange, initialCenterX, initialCenterY, initialTMin, initialTMax, initialHidden])
  useEffect(() => {
    if (!open || !expression.trim()) { setCurves([]); return }
    let active = true
    setBusy(true); setError(''); setCurves([]); setInspected(null)
    void plot(expression, -range, range, tRange[0], tRange[1], centerX, centerY).then(result => {
      if (!active) return
      setCurves(result)
      if (result.every(c => c.kind === 'explicit' ? c.values.every(v => v == null) : c.kind === 'implicit' ? c.segments.length === 0 : (c.kind === 'parametric' || c.kind === 'parametric3d') ? c.points.every(v => v == null) : c.values.every(row => row.every(v => v == null)))) setError('这个范围内没有可显示的曲线')
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : '无法绘制函数') })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [open, expression, range, centerX, centerY, tRange, plot])
  const is3d = curves.some(c => c.kind === 'surface' || c.kind === 'parametric3d')
  const visibleCurves = useMemo(() => curves.filter((_, index) => !hidden.has(index)), [curves, hidden])
  const intersections = useMemo(() => !is3d && showIntersections && visibleCurves.length > 1 ? findIntersections(visibleCurves, range, centerX, centerY) : { points: [], truncated: false }, [visibleCurves, range, centerX, centerY, is3d, showIntersections])
  const formatCoord = (v: number) => Math.abs(v) < range * 1e-8 ? '0' : Number(v.toPrecision(5)).toString()
  const isParametric = /(?:^|\n|;|；)\s*\([^\n]*\bt\b/.test(input)
  const colors = ['var(--primary)', '#e35b49', '#199b73', '#ac70d4', '#dd9a26']
  return <Dialog open={open} onOpenChange={onOpenChange} title="函数图像" description="输入函数、隐式方程、参数曲线或三维曲面。二维每行一条；三维单独绘制。" widthClass="w-[min(560px,94vw)]">
    <div className="flex flex-col gap-3">
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); const a = Number(tStart), b = Number(tEnd); if (isParametric && (!tStart.trim() || !tEnd.trim() || !Number.isFinite(a) || !Number.isFinite(b) || a >= b)) { setError('请填写有效的参数范围，起点须小于终点'); return }; if (isParametric) setTRange([a, b]); setHidden(new Set()); setInspected(null); setExpression(input.trim()) }}>
        <textarea aria-label="函数表达式" value={input} onChange={e => setInput(e.target.value)} placeholder={'例如：y=x^2、x^2+y^2=25\n参数曲线：(cos(t),sin(t))\n三维：z=sin(x)*cos(y) 或 (cos(t),sin(t),t)'} rows={2} className="min-w-0 flex-1 resize-y rounded-xl border border-outline bg-surface-2 px-3 py-2 text-base outline-none focus:border-primary" />
        <Button type="submit" variant="primary" disabled={!input.trim()}>绘制</Button>
      </form>
      {isParametric && <div className="flex items-center gap-2 text-sm text-on-surface-2"><span>参数 t</span><input aria-label="参数起点" type="number" value={tStart} onChange={e => setTStart(e.target.value)} className="w-24 min-w-0 rounded-lg border border-outline bg-surface px-2 py-1" /><span>至</span><input aria-label="参数终点" type="number" value={tEnd} onChange={e => setTEnd(e.target.value)} className="w-24 min-w-0 rounded-lg border border-outline bg-surface px-2 py-1" /></div>}
      <div className="rounded-xl border border-outline bg-surface-2 overflow-hidden">
        <svg viewBox="0 0 400 400" role="img" aria-label={`函数 ${expression} 的图像`} className="w-full max-h-[46vh]" preserveAspectRatio="xMidYMid meet" style={{ touchAction: 'none', cursor: 'grab' }}
          onPointerDown={e => {
            e.currentTarget.setPointerCapture(e.pointerId)
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
            if (is3d) { drag.current = { x: e.clientX, y: e.clientY }; return }
            const pts = [...pointers.current.values()]
            if (pts.length === 1) gesture.current = { x: e.clientX, y: e.clientY, centerX, centerY, range, pinch: false }
            else if (pts.length === 2) gesture.current = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2, centerX, centerY, range, distance: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), pinch: true }
          }}
          onPointerMove={e => {
            if (!pointers.current.has(e.pointerId)) return
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
            if (is3d && drag.current) { const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y; drag.current = { x: e.clientX, y: e.clientY }; setYaw(v => v + dx * 0.01); setPitch(v => Math.max(-1.35, Math.min(1.35, v + dy * 0.01))) }
          }}
          onPointerUp={e => {
            if (is3d) { pointers.current.delete(e.pointerId); drag.current = null; return }
            const state = gesture.current, rect = e.currentTarget.getBoundingClientRect(), size = Math.min(rect.width, rect.height)
            if (state && size > 0) {
              const pts = [...pointers.current.values()]
              if (state.pinch && pts.length >= 2 && state.distance) {
                const distance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
                const midX = (pts[0].x + pts[1].x) / 2, midY = (pts[0].y + pts[1].y) / 2
                if (distance > 1) setRange(Math.max(.01, Math.min(10000, state.range * state.distance / distance)))
                setCenterX(Math.max(-1e6, Math.min(1e6, state.centerX - (midX - state.x) / size * 2 * state.range)))
                setCenterY(Math.max(-1e6, Math.min(1e6, state.centerY + (midY - state.y) / size * 2 * state.range)))
                setInspected(null)
              } else if (!state.pinch) {
                const dx = e.clientX - state.x, dy = e.clientY - state.y
                if (Math.hypot(dx, dy) > 5) {
                  setCenterX(Math.max(-1e6, Math.min(1e6, state.centerX - dx / size * 2 * state.range)))
                  setCenterY(Math.max(-1e6, Math.min(1e6, state.centerY + dy / size * 2 * state.range)))
                  setInspected(null)
                } else {
                  const sx = (e.clientX - rect.left - (rect.width - size) / 2) / size * 400
                  const sy = (e.clientY - rect.top - (rect.height - size) / 2) / size * 400
                  setInspected(nearestCurvePoint(visibleCurves, range, sx, sy, centerX, centerY))
                }
              }
            }
            pointers.current.delete(e.pointerId)
            if (!pointers.current.size) gesture.current = null
            else if (gesture.current) gesture.current.pinch = true
          }} onPointerCancel={e => { pointers.current.delete(e.pointerId); if (!pointers.current.size) gesture.current = null; drag.current = null }}>
          <defs><clipPath id="function-plot-clip"><rect width="400" height="400" /></clipPath></defs>
          {!is3d && <>
            {Array.from({ length: 9 }, (_, i) => (i + 1) * 40).map(n => <g key={n} stroke="var(--outline)" strokeWidth="0.6" opacity="0.6"><path d={`M${n} 0V400 M0 ${n}H400`} /></g>)}
            <path d={`M${200 - centerX / range * 200} 0V400 M0 ${200 + centerY / range * 200}H400`} stroke="var(--on-surface-2)" strokeWidth="1.2" />
          </>}
          {is3d && [[1,0,0,'x'],[0,1,0,'y'],[0,0,1,'z']].map(([x,y,z,label]) => {
            const a = project3d(0,0,0,yaw,pitch), b = project3d(x as number,y as number,z as number,yaw,pitch)
            return <g key={label} stroke="var(--on-surface-2)" fill="var(--on-surface-2)"><path d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`} /><text x={b[0]} y={b[1]} fontSize="12" stroke="none">{label}</text></g>
          })}
          <g clipPath="url(#function-plot-clip)">{curves.map((curve, index) => {
            if (hidden.has(index)) return null
            const paths = curve.kind === 'explicit' ? plotPaths(curve.values, range, centerY)
              : curve.kind === 'implicit' ? curve.segments.map(([x1, y1, x2, y2]) => `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`)
              : curve.kind === 'parametric' ? parametricPaths(curve.points, range, centerX, centerY) : curve.kind === 'parametric3d' ? parametric3dPaths(curve.points, range, yaw, pitch) : surfacePaths(curve.values, range, yaw, pitch)
            return <g key={index} fill="none" stroke={colors[index % colors.length]} strokeWidth={curve.kind === 'surface' ? 1.2 : 2.5} strokeLinejoin="round" strokeLinecap="round">{paths.map((d, i) => <path key={i} d={d} />)}</g>
          })}</g>
          {!is3d && intersections.points.map((point, i) => <g key={`${point.first}-${point.second}-${i}`} aria-label={`交点 ${i + 1}，坐标 ${formatCoord(point.x)}，${formatCoord(point.y)}`}>
            <title>{`交点 ${i + 1}：(${formatCoord(point.x)}, ${formatCoord(point.y)})`}</title>
            <circle cx={point.screenX} cy={point.screenY} r="5" fill="var(--surface)" stroke="var(--on-surface)" strokeWidth="2" />
            <text x={Math.min(386, Math.max(8, point.screenX + 7))} y={Math.min(394, Math.max(12, point.screenY - 7))} fill="var(--on-surface)" fontSize="12" fontWeight="700">{i + 1}</text>
          </g>)}
          {!is3d && inspected && <g aria-label={`曲线坐标 ${formatCoord(inspected.x)}，${formatCoord(inspected.y)}`}><circle cx={inspected.screenX} cy={inspected.screenY} r="5" fill="var(--primary)" stroke="var(--surface)" strokeWidth="2" /></g>}
          {!is3d && <g fill="var(--on-surface-2)" fontSize="11"><text x="4" y="194">{formatCoord(centerX - range)}</text><text x="350" y="215">{formatCoord(centerX + range)}</text><text x="205" y="15">{formatCoord(centerY + range)}</text><text x="205" y="394">{formatCoord(centerY - range)}</text></g>}
        </svg>
      </div>
      {is3d && <div className="flex items-center gap-2 text-xs text-on-surface-2"><span>拖动旋转</span><Button variant="outline" aria-label="向左旋转" onClick={() => setYaw(v => v - Math.PI / 12)}>左转</Button><Button variant="outline" aria-label="向右旋转" onClick={() => setYaw(v => v + Math.PI / 12)}>右转</Button><Button variant="outline" aria-label="重置视角" onClick={() => { setYaw(-0.65); setPitch(0.65) }}>重置视角</Button></div>}
      {curves.length > 1 && <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">{curves.map((curve, i) => <button type="button" key={i} aria-pressed={!hidden.has(i)} onClick={() => { setHidden(previous => { const next = new Set(previous); if (next.has(i)) next.delete(i); else next.add(i); return next }); setInspected(null) }} style={{ color: colors[i % colors.length], opacity: hidden.has(i) ? .45 : 1 }}>{hidden.has(i) ? '○' : '●'} {curve.label}</button>)}</div>}
      {!is3d && <p className="text-xs text-on-surface-2">拖动平移，双指缩放，点击曲线查看坐标{inspected ? `：${inspected.label} ≈ (${formatCoord(inspected.x)}, ${formatCoord(inspected.y)})` : ''}</p>}
      {!is3d && curves.length > 1 && <section aria-label="曲线交点" className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-on-surface-2">
        <button type="button" aria-pressed={showIntersections} onClick={() => setShowIntersections(v => !v)} className="font-medium text-on-surface">{showIntersections ? '隐藏交点' : '显示交点'}</button>
        {showIntersections && <>
          <p className="mt-1">当前范围内的采样近似交点{intersections.truncated ? '（最多显示 50 个）' : ''}；相切或重合的曲线可能无法显示。</p>
          {intersections.points.length > 0 ? <ol className="mt-1 max-h-28 overflow-y-auto space-y-1">{intersections.points.map((point, i) => <li key={`${point.first}-${point.second}-${i}`}><span className="font-medium text-on-surface">{i + 1}. ({formatCoord(point.x)}, {formatCoord(point.y)})</span> · {visibleCurves[point.first].label} / {visibleCurves[point.second].label}</li>)}</ol> : <p className="mt-1">未检测到交点</p>}
        </>}
      </section>}
      <div className="flex items-center gap-2"><Button variant="outline" onClick={() => setRange(r => Math.max(0.01, r / 2))} disabled={busy || range <= 0.01}>放大</Button><Button variant="outline" onClick={() => setRange(r => Math.min(10000, r * 2))} disabled={busy || range >= 10000}>缩小</Button><span className="text-xs text-on-surface-2">范围 ±{range}</span>{!is3d && <Button variant="outline" onClick={() => { setCenterX(0); setCenterY(0); setInspected(null) }}>回到原点</Button>}</div>
      {onInsert && <div className="flex justify-end"><Button variant="primary" disabled={busy || !!error || !curves.length} onClick={() => onInsert(expression, range, tRange[0], tRange[1], centerX, centerY, [...hidden])}>插入笔记</Button></div>}
      {busy && <p className="text-xs text-on-surface-2" role="status">正在绘图…</p>}
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </div>
  </Dialog>
}
