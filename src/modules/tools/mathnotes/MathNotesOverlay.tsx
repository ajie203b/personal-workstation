import { useLayoutEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/shared/ui/Button'
import { EmbeddedGraph } from './EmbeddedGraph'
import { MathView } from './MathView'
import { ANSWER_COLOR, HAND_FONT, MARK_WIDTH, type Action, type ModelState, type OverlayItem } from './canvasDraw'
import { transformStrokes } from './lasso'
import type { EditKind } from './noteSession'
import type { BlockResult, Box, NoteGraph, Stroke } from './types'
import type { PlotCurve } from './plot'

/** 单个算式块的答案 / 解 / 报错标记 / 识别失败标记 / 识别原文 */
export function OverlayAnswer({
  item,
  showLatex,
  onOpen,
  onRetry,
  onManual,
  mode = 'auto',
  revealed = false,
  onReveal,
  onMeasure,
}: {
  item: OverlayItem
  showLatex: boolean
  onOpen: () => void
  onRetry: () => void
  onManual?: () => void
  mode?: 'auto' | 'suggest' | 'off'
  revealed?: boolean
  onReveal?: () => void
  onMeasure: (key: string, width: number) => void
}) {
  const { res, block } = item
  const r = res?.result
  const answerRef = useRef<HTMLButtonElement>(null)
  // 实测答案宽度（scrollWidth 不受 maxWidth 限制），右侧放不下时改放下方
  useLayoutEffect(() => {
    const el = answerRef.current
    if (el) onMeasure(item.key, el.scrollWidth)
  })

  const latexChip =
    showLatex && res ? (
      <button
        type="button"
        onClick={onOpen}
        className="absolute pointer-events-auto cursor-pointer rounded-[8px] bg-surface/90 border border-outline px-1.5 py-0.5 text-[12px] text-on-surface-2 shadow-sm max-w-[80vw] overflow-hidden"
        style={{ left: block.box.minX, top: block.box.minY - 6, transform: 'translateY(-100%)' }}
        title="点击修改识别结果"
      >
        <MathView latex={res.edited ?? res.recognized} />
      </button>
    ) : null

  if (!r) {
    // 失败后可重试，也可以绕过识别直接输入算式。
    return (
      <div
        className="absolute pointer-events-auto flex items-center gap-1 rounded-full border border-danger/60 bg-surface/95 px-2 py-1 shadow-sm text-[12px] text-danger whitespace-nowrap"
        style={{ left: item.x, top: item.y, transform: 'translateY(-50%)', maxWidth: item.maxWidth }}
      >
        <button
          type="button"
          onClick={onRetry}
          title={`识别失败：${item.failed ?? ''}（点击重试）`}
          aria-label={`识别失败：${item.failed ?? ''}，点击重试`}
          data-testid="mathnotes-recognize-failed"
        >
          ⚠ 重试
        </button>
        {onManual && (
          <button type="button" onClick={onManual} aria-label="手动输入算式" className="rounded-full px-1.5 text-on-surface">
            手动输入
          </button>
        )}
      </div>
    )
  }

  if (r.kind === 'none' && !item.canCorrect) return latexChip

  if (r.kind === 'error' || (r.kind === 'none' && item.canCorrect)) {
    return (
      <>
        {latexChip}
        <button
          type="button"
          onClick={onOpen}
          title={r.message ?? '点击修改识别内容'}
          aria-label={r.kind === 'none' ? '未算出结果，点击修改识别内容' : `没算出来：${r.message ?? ''}，点击修改`}
          className="absolute pointer-events-auto cursor-pointer grid place-items-center rounded-full border-2 font-bold"
          style={{
            left: item.x,
            top: item.y,
            width: MARK_WIDTH,
            height: MARK_WIDTH,
            transform: 'translateY(-50%)',
            borderColor: ANSWER_COLOR,
            color: ANSWER_COLOR,
            fontSize: 15,
          }}
        >
          ?
        </button>
      </>
    )
  }

  if (mode === 'off') return latexChip
  if (mode === 'suggest' && !revealed) {
    return (
      <>
        {latexChip}
        <button
          type="button"
          onClick={onReveal}
          className="absolute pointer-events-auto rounded-full border border-outline bg-surface px-2 py-1 text-xs text-primary shadow-sm"
          style={{ left: item.x, top: item.y, transform: 'translateY(-50%)' }}
        >
          显示结果
        </button>
      </>
    )
  }

  const inline = item.placement === 'inline'
  const simpleText = r.text && !/[\\{}]/.test(r.text)
  return (
    <>
      {latexChip}
      <button
        ref={answerRef}
        type="button"
        onClick={onOpen}
        title="点击修改"
        className={cn(
          'absolute pointer-events-auto cursor-pointer text-left leading-none whitespace-nowrap',
          item.maxWidth != null && 'overflow-x-auto overflow-y-hidden',
        )}
        style={{
          left: item.x,
          // 写在等号后：与等号中线对齐；写在下方：从块底下往下排，多行解不会盖住算式
          top: inline ? item.y : item.y - item.fontSize / 2,
          transform: inline ? 'translateY(-50%)' : undefined,
          maxWidth: item.maxWidth,
          color: 'var(--on-surface)',
          fontSize: item.fontSize,
          fontWeight: item.fontWeight,
          fontFamily: HAND_FONT,
        }}
      >
        {simpleText ? <span>{r.text}</span> : <MathView latex={r.latex} />}
        {r.alt && (
          <span className="ml-2 opacity-80" style={{ fontSize: Math.max(13, item.fontSize * 0.5) }}>
            ≈ {r.alt}
          </span>
        )}
      </button>
    </>
  )
}

export function EmbeddedGraphLayer({
  graphs,
  graphsRef,
  resultsRef,
  graphDrag,
  pushAction,
  bump,
  markEdited,
  plot,
  onOpenPlot,
}: {
  graphs: NoteGraph[]
  graphsRef: React.MutableRefObject<NoteGraph[]>
  resultsRef: React.MutableRefObject<Map<string, BlockResult>>
  graphDrag: React.MutableRefObject<{ id: string; pointerId: number; x: number; y: number; original: NoteGraph } | null>
  pushAction: (a: Action) => void
  bump: () => void
  markEdited: (kind: EditKind) => void
  plot: (latex: string, min: number, max: number, tMin: number, tMax: number, centerX?: number, centerY?: number) => Promise<PlotCurve[]>
  onOpenPlot: (graph: NoteGraph, expression: string) => void
}) {
  return (
    <>
      {graphs.map((graph) => {
        const source = graph.sourceKey ? resultsRef.current.get(graph.sourceKey) : undefined
        const expression = source ? (source.edited ?? source.recognized) : graph.expression
        const updateGraph = (patch: Partial<NoteGraph>) => {
          const before = graphsRef.current
          graphsRef.current = graphsRef.current.map((g) => (g.id === graph.id ? { ...g, ...patch } : g))
          pushAction({ type: 'graphs', before, after: graphsRef.current })
          bump()
          markEdited('user')
        }
        return (
          <div
            key={graph.id}
            className="absolute pointer-events-auto rounded-xl border border-outline bg-surface shadow-sm overflow-hidden"
            style={{ left: graph.x, top: graph.y, width: graph.width, height: graph.height }}
          >
            <div
              className="h-8 flex items-center gap-1 px-2 bg-surface-2 border-b border-outline touch-none cursor-move"
              aria-label="拖动图像"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                graphDrag.current = { id: graph.id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, original: graph }
              }}
              onPointerMove={(e) => {
                const d = graphDrag.current
                if (!d || d.id !== graph.id || d.pointerId !== e.pointerId) return
                graphsRef.current = graphsRef.current.map((g) =>
                  g.id === d.id
                    ? { ...d.original, x: Math.max(0, d.original.x + e.clientX - d.x), y: Math.max(0, d.original.y + e.clientY - d.y) }
                    : g,
                )
                bump()
              }}
              onPointerUp={() => {
                const d = graphDrag.current
                if (!d || d.id !== graph.id) return
                const current = graphsRef.current.find((g) => g.id === d.id)
                graphDrag.current = null
                if (current && (current.x !== d.original.x || current.y !== d.original.y)) {
                  const before = graphsRef.current.map((g) => (g.id === d.id ? d.original : g))
                  pushAction({ type: 'graphs', before, after: graphsRef.current })
                  markEdited('user')
                }
              }}
              onPointerCancel={() => {
                const d = graphDrag.current
                if (d?.id === graph.id) {
                  graphsRef.current = graphsRef.current.map((g) => (g.id === d.id ? d.original : g))
                  graphDrag.current = null
                  bump()
                }
              }}
            >
              <span className="flex-1 truncate text-xs">{expression}</span>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="缩小图像"
                onClick={() => updateGraph({ width: Math.max(160, graph.width * 0.85), height: Math.max(140, graph.height * 0.85) })}
              >
                −
              </button>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="放大图像"
                onClick={() => updateGraph({ width: Math.min(600, graph.width * 1.15), height: Math.min(500, graph.height * 1.15) })}
              >
                ＋
              </button>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="删除图像"
                onClick={() => {
                  const before = graphsRef.current
                  graphsRef.current = graphsRef.current.filter((g) => g.id !== graph.id)
                  pushAction({ type: 'graphs', before, after: graphsRef.current })
                  bump()
                  markEdited('user')
                }}
              >
                ×
              </button>
            </div>
            <div style={{ height: 'calc(100% - 2rem)' }}>
              <EmbeddedGraph graph={graph} expression={expression} plot={plot} onOpen={() => onOpenPlot(graph, expression)} />
            </div>
          </div>
        )
      })}
    </>
  )
}

export function LassoSelectionOverlay({
  selectionBox,
  strokesRef,
  selectionDrag,
  selected,
  pushAction,
  afterChange,
  bump,
  onScale,
  onCopy,
  onDelete,
}: {
  selectionBox: Box
  strokesRef: React.MutableRefObject<Stroke[]>
  selectionDrag: React.MutableRefObject<{ pointerId: number; x: number; y: number; before: Stroke[] } | null>
  selected: string[]
  pushAction: (a: Action) => void
  afterChange: () => void
  bump: () => void
  onScale: (scale: number) => void
  onCopy: () => void
  onDelete: () => void
}) {
  return (
    <div
      className="absolute pointer-events-auto border-2 border-primary rounded-lg bg-primary/5 touch-none cursor-move"
      style={{
        left: selectionBox.minX - 6,
        top: selectionBox.minY - 6,
        width: Math.max(24, selectionBox.maxX - selectionBox.minX + 12),
        height: Math.max(24, selectionBox.maxY - selectionBox.minY + 12),
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        selectionDrag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, before: strokesRef.current }
      }}
      onPointerMove={(e) => {
        const d = selectionDrag.current
        if (!d || d.pointerId !== e.pointerId) return
        strokesRef.current = transformStrokes(d.before, new Set(selected), e.clientX - d.x, e.clientY - d.y)
        bump()
      }}
      onPointerUp={(e) => {
        const d = selectionDrag.current
        if (!d || d.pointerId !== e.pointerId) return
        selectionDrag.current = null
        const ids = new Set(selected)
        const before = d.before.filter((s) => ids.has(s.id))
        const after = strokesRef.current.filter((s) => ids.has(s.id))
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 1) {
          pushAction({ type: 'move', before, after })
          afterChange()
        }
      }}
      onPointerCancel={() => {
        const d = selectionDrag.current
        if (d) {
          strokesRef.current = d.before
          selectionDrag.current = null
          bump()
        }
      }}
    >
      <div className="absolute left-0 -top-10 flex gap-1 whitespace-nowrap" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" aria-label="缩小选中笔迹" className="rounded-lg bg-surface border border-outline px-2 py-1" onClick={() => onScale(0.85)}>
          −
        </button>
        <button type="button" aria-label="放大选中笔迹" className="rounded-lg bg-surface border border-outline px-2 py-1" onClick={() => onScale(1.15)}>
          +
        </button>
        <button type="button" className="rounded-lg bg-surface border border-outline px-2 py-1" onClick={onCopy}>
          复制
        </button>
        <button type="button" className="rounded-lg bg-surface border border-outline px-2 py-1" onClick={onDelete}>
          删除
        </button>
      </div>
    </div>
  )
}

export function ModelStatusBanner({
  model,
  percent,
  recognizing,
  onOpenSettings,
  onRetryModel,
}: {
  model: ModelState
  percent: number | null
  recognizing: number
  onOpenSettings: () => void
  onRetryModel: () => void
}) {
  if (model.phase !== 'loading' && model.phase !== 'error' && recognizing <= 0) return null
  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-3.5 pointer-events-auto">
      {model.phase === 'loading' ? (
        <div className="card flex items-center gap-2.5 px-3.5 py-2 shadow-lg min-w-[240px]">
          <Loader2 size={14} className="animate-spin text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium">首次使用，正在下载识别模型{percent != null ? ` ${percent}%` : '…'}</p>
            <div className="mt-1 h-1 rounded-full bg-surface-3 overflow-hidden">
              <div
                className={cn('h-full rounded-full bg-primary transition-[width] duration-200', percent == null && 'w-1/3 animate-pulse')}
                style={percent != null ? { width: `${percent}%` } : undefined}
              />
            </div>
            <p className="text-[10.5px] text-on-surface-2 mt-1">约 120MB，只下载一次，之后离线可用</p>
          </div>
        </div>
      ) : model.phase === 'error' ? (
        <div className="card flex items-center gap-2 px-3.5 py-2 shadow-lg max-w-[92vw]">
          <p className="text-[12px] text-danger leading-snug min-w-0">{model.message}</p>
          <Button size="sm" variant="outline" className="h-8 px-3 shrink-0" onClick={onOpenSettings}>
            换下载源
          </Button>
          <Button size="sm" variant="primary" className="h-8 px-3 shrink-0" onClick={onRetryModel}>
            重试
          </Button>
        </div>
      ) : (
        <div className="card flex items-center gap-2 px-3 py-1.5 shadow">
          <Loader2 size={13} className="animate-spin text-primary" />
          <span className="text-[11.5px] text-on-surface-2">识别中…</span>
        </div>
      )}
    </div>
  )
}
