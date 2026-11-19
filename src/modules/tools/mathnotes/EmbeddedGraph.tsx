import { useEffect, useMemo, useState } from 'react'
import type { NoteGraph } from './types'
import type { PlotCurve } from './plot'
import { plotPaths, parametricPaths, parametric3dPaths, surfacePaths } from './FunctionPlotDialog'
import { computeAxisTicks } from './plotTicks'

const GRAPH_COLORS = ['var(--primary)', '#e35b49', '#169b70', '#9b5de5', '#d97706']

export function EmbeddedGraph({ graph, expression, plot, onOpen }: {
  graph: NoteGraph
  expression: string
  plot: (text: string, min: number, max: number, tMin: number, tMax: number, centerX?: number, centerY?: number) => Promise<PlotCurve[]>
  onOpen: () => void
}) {
  const [curves, setCurves] = useState<PlotCurve[]>([])
  const [error, setError] = useState('')
  const cx = graph.centerX ?? 0
  const cy = graph.centerY ?? 0

  useEffect(() => {
    let live = true
    setError('')
    void plot(expression, -graph.range, graph.range, graph.tMin, graph.tMax, cx, cy)
      .then((c) => { if (live) setCurves(c) })
      .catch(() => { if (live) { setCurves([]); setError('图像暂不可用，点击编辑') } })
    return () => { live = false }
  }, [expression, graph.range, graph.tMin, graph.tMax, cx, cy, plot])

  const is3d = curves.some((c) => c.kind === 'surface' || c.kind === 'parametric3d')
  const xTicks = useMemo(() => (is3d ? [] : computeAxisTicks(cx, graph.range, 'x', 4)), [is3d, cx, graph.range])
  const yTicks = useMemo(() => (is3d ? [] : computeAxisTicks(cy, graph.range, 'y', 4)), [is3d, cy, graph.range])
  const axisX = 200 - (cx / graph.range) * 200
  const axisY = 200 + (cy / graph.range) * 200
  const clampedAxisX = Math.max(16, Math.min(384, axisX))
  const clampedAxisY = Math.max(18, Math.min(384, axisY))

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`编辑图像 ${expression}`}
      className="relative w-full h-full overflow-hidden rounded-b-xl bg-surface text-left cursor-pointer"
    >
      <svg viewBox="0 0 400 400" className="w-full h-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
        {!is3d && (
          <>
            <g stroke="var(--outline)" strokeWidth="0.8" opacity="0.55">
              {xTicks.map((t) => (
                <line key={`gx-${t.label}`} x1={t.pos} y1="0" x2={t.pos} y2="400" />
              ))}
              {yTicks.map((t) => (
                <line key={`gy-${t.label}`} x1="0" y1={t.pos} x2="400" y2={t.pos} />
              ))}
            </g>
            <g stroke="var(--on-surface-2)" strokeWidth="1.4" opacity="0.85">
              {axisX >= 0 && axisX <= 400 && (
                <>
                  <line x1={axisX} y1="400" x2={axisX} y2="6" />
                  <path d={`M${axisX - 4} 13 L${axisX} 4 L${axisX + 4} 13`} fill="none" />
                </>
              )}
              {axisY >= 0 && axisY <= 400 && (
                <>
                  <line x1="0" y1={axisY} x2="394" y2={axisY} />
                  <path d={`M387 ${axisY - 4} L396 ${axisY} L387 ${axisY + 4}`} fill="none" />
                </>
              )}
            </g>
          </>
        )}
        <svg x="0" y="0" width="400" height="400" viewBox="0 0 400 400" overflow="hidden">
          {curves.map((curve, i) => {
            if (graph.hiddenCurves?.includes(i)) return null
            const paths = curve.kind === 'explicit'
              ? plotPaths(curve.values, graph.range, cy)
              : curve.kind === 'implicit'
                ? curve.segments.map(([x, y, a, b]) => `M${x} ${y}L${a} ${b}`)
                : curve.kind === 'parametric'
                  ? parametricPaths(curve.points, graph.range, cx, cy)
                  : curve.kind === 'parametric3d'
                    ? parametric3dPaths(curve.points, graph.range, -0.65, 0.65)
                    : surfacePaths(curve.values, graph.range, -0.65, 0.65)
            return (
              <g
                key={i}
                fill="none"
                stroke={GRAPH_COLORS[i % GRAPH_COLORS.length]}
                strokeWidth={curve.kind === 'surface' ? 1.4 : 2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {paths.map((d, j) => <path key={j} d={d} />)}
              </g>
            )
          })}
        </svg>
        {!is3d && (
          <g
            fill="var(--on-surface-2)"
            stroke="var(--surface)"
            strokeWidth="3.5"
            style={{ paintOrder: 'stroke' }}
            fontSize="13"
            fontWeight="500"
          >
            {xTicks.map((t) => {
              if (t.isZero || t.pos < 22 || t.pos > 378) return null
              const y = clampedAxisY > 368 ? clampedAxisY - 10 : clampedAxisY + 16
              return <text key={`tx-${t.label}`} x={t.pos} y={y} textAnchor="middle">{t.label}</text>
            })}
            {yTicks.map((t) => {
              if (t.isZero || t.pos < 18 || t.pos > 384) return null
              const rightSide = clampedAxisX < 340
              return (
                <text
                  key={`ty-${t.label}`}
                  x={rightSide ? clampedAxisX + 7 : clampedAxisX - 7}
                  y={t.pos + 4}
                  textAnchor={rightSide ? 'start' : 'end'}
                >
                  {t.label}
                </text>
              )
            })}
          </g>
        )}
      </svg>
      {error && <span className="absolute left-2 top-2 text-xs text-danger">{error}</span>}
    </button>
  )
}
