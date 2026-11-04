import { useEffect, useState } from 'react'
import type { NoteGraph } from './types'
import type { PlotCurve } from './plot'
import { plotPaths, parametricPaths, parametric3dPaths, surfacePaths } from './FunctionPlotDialog'

export function EmbeddedGraph({ graph, expression, plot, onOpen }: {
  graph: NoteGraph; expression: string; plot: (text: string, min: number, max: number, tMin: number, tMax: number, centerX?: number, centerY?: number) => Promise<PlotCurve[]>; onOpen: () => void
}) {
  const [curves, setCurves] = useState<PlotCurve[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setError('')
    void plot(expression, -graph.range, graph.range, graph.tMin, graph.tMax, graph.centerX ?? 0, graph.centerY ?? 0).then(c => { if (live) setCurves(c) }).catch(() => { if (live) { setCurves([]); setError('图像暂不可用，点击编辑') } })
    return () => { live = false }
  }, [expression, graph.range, graph.tMin, graph.tMax, graph.centerX, graph.centerY, plot])
  const colors = ['var(--primary)', '#e35b49', '#199b73', '#ac70d4', '#dd9a26']
  return <button type="button" onClick={onOpen} aria-label={`编辑图像 ${expression}`} className="w-full h-full overflow-hidden rounded-lg bg-surface-2 text-left">
    <svg viewBox="0 0 400 400" className="w-full h-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <defs><clipPath id={`clip-${graph.id}`}><rect width="400" height="400" /></clipPath></defs>
      <path d={`M${200 - (graph.centerX ?? 0) / graph.range * 200} 0V400 M0 ${200 + (graph.centerY ?? 0) / graph.range * 200}H400`} stroke="var(--outline)" />
      <g clipPath={`url(#clip-${graph.id})`}>{curves.map((curve, i) => {
        if (graph.hiddenCurves?.includes(i)) return null
        const paths = curve.kind === 'explicit' ? plotPaths(curve.values, graph.range, graph.centerY ?? 0) : curve.kind === 'implicit' ? curve.segments.map(([x,y,a,b]) => `M${x} ${y}L${a} ${b}`) : curve.kind === 'parametric' ? parametricPaths(curve.points, graph.range, graph.centerX ?? 0, graph.centerY ?? 0) : curve.kind === 'parametric3d' ? parametric3dPaths(curve.points, graph.range, -.65, .65) : surfacePaths(curve.values, graph.range, -.65, .65)
        return <g key={i} fill="none" stroke={colors[i % colors.length]} strokeWidth="2">{paths.map((d, j) => <path key={j} d={d} />)}</g>
      })}</g>
    </svg>
    {error && <span className="absolute left-2 top-8 text-xs text-danger">{error}</span>}
  </button>
}
