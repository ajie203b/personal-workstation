import { useLayoutEffect, useRef, useState } from 'react'
import { Loader2, Pencil, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/shared/ui/Button'
import { EmbeddedGraph } from './EmbeddedGraph'
import { MathView } from './MathView'
import { normalizeLatex } from './latexNormalize'
import { HAND_FONT, MARK_WIDTH, type Action, type ModelState, type OverlayItem } from './canvasDraw'
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

  const chipStyle = (() => {
    if (item.chipPos) {
      return {
        left: item.chipPos.x,
        top: item.chipPos.y,
        transform: item.chipPos.above ? 'translateY(-100%)' : undefined,
        maxWidth: item.chipPos.maxWidth,
      }
    }
    if (block.box.minY < 40) {
      if (item.placement === 'inline') {
        return { left: Math.max(4, block.box.minX), top: block.box.maxY + 6 }
      }
      return { left: Math.max(4, block.box.minX), top: Math.max(4, block.box.minY) }
    }
    return { left: Math.max(4, block.box.minX), top: block.box.minY - 6, transform: 'translateY(-100%)' }
  })()

  const normalizedSource = res ? normalizeLatex(res.edited ?? res.recognized) : ''
  const latexChip =
    showLatex && res ? (
      <button
        type="button"
        onClick={onOpen}
        className="absolute pointer-events-auto cursor-pointer rounded-[8px] bg-surface/95 border border-outline px-1.5 py-0.5 text-[12px] text-on-surface-2 shadow-sm max-w-[80vw] overflow-x-auto overflow-y-hidden whitespace-nowrap z-10 hover:border-primary/50"
        style={chipStyle}
        title="点击修改识别结果"
      >
        <MathView latex={normalizedSource || '\\text{（空）}'} />
      </button>
    ) : null

  if (!r) {
    if (item.failed) {
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
            className="cursor-pointer"
          >
            ⚠ 重试
          </button>
          {onManual && (
            <button
              type="button"
              onClick={onManual}
              aria-label="手动输入算式"
              className="inline-flex items-center gap-1 rounded-full px-1.5 text-on-surface hover:bg-surface-3 cursor-pointer"
            >
              <Pencil size={11} aria-hidden />
              <span>手动输入</span>
            </button>
          )}
        </div>
      )
    }
    // 书写或识别排队期间不弹出可点「手动输入」按钮，避免平板手写时按钮紧跟笔尖遮挡/误触；
    // 顶部工具栏与底部状态条已提供随时可用的键盘输入入口。
    return null
  }

  if (r.kind === 'none' && r.assigned && mode !== 'off') {
    return (
      <>
        {latexChip}
        <button
          type="button"
          onClick={onOpen}
          title={`已注册变量 ${r.assigned.name} = ${r.assigned.value}，点击修改`}
          aria-label={`已定义变量 ${r.assigned.name} 等于 ${r.assigned.value}`}
          className="absolute pointer-events-auto cursor-pointer inline-flex items-center gap-1 rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-[12px] font-medium text-ok shadow-xs whitespace-nowrap hover:bg-ok/15"
          style={{ left: item.x, top: item.y, transform: 'translateY(-50%)', maxWidth: item.maxWidth }}
        >
          ✓ = {r.assigned.value}
        </button>
      </>
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
          className="absolute pointer-events-auto cursor-pointer grid place-items-center rounded-full border-2 font-bold border-[#D97706] text-[#B45309] dark:border-[#FBBF24] dark:text-[#FBBF24] bg-surface/85"
          style={{
            left: item.x,
            top: item.y,
            width: MARK_WIDTH,
            height: MARK_WIDTH,
            transform: 'translateY(-50%)',
            fontSize: 15,
          }}
        >
          ?
          <span
            aria-hidden
            className="absolute -right-1.5 -bottom-1.5 size-4 rounded-full bg-surface border border-outline grid place-items-center text-on-surface-2 shadow-xs"
          >
            <Pencil size={9} />
          </span>
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
          className="absolute pointer-events-auto rounded-full border border-outline bg-surface px-2 py-1 text-xs text-primary shadow-sm cursor-pointer"
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
          'absolute pointer-events-auto cursor-pointer text-left leading-none whitespace-nowrap text-[#B45309] dark:text-[#FBBF24]',
          item.maxWidth != null && 'overflow-x-auto overflow-y-hidden',
        )}
        style={{
          left: item.x,
          // 写在等号后：与等号中线对齐；写在下方：从块底下往下排，多行解不会盖住算式
          top: inline ? item.y : item.y - item.fontSize / 2,
          transform: inline ? 'translateY(-50%)' : undefined,
          maxWidth: item.maxWidth,
          fontSize: item.fontSize,
          fontWeight: item.fontWeight,
          fontFamily: HAND_FONT,
          textShadow: '0 0 6px var(--canvas), 0 0 12px var(--canvas)',
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
  zoom = 1,
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
  zoom?: number
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
            data-graph-id={graph.id}
            className="absolute pointer-events-auto rounded-xl border border-outline bg-surface shadow-sm overflow-hidden flex flex-col"
            style={{ left: graph.x, top: graph.y, width: graph.width, height: graph.height }}
          >
            <div
              className="h-9 max-md:h-10 shrink-0 flex items-center gap-1 px-2 bg-surface-2 border-b border-outline touch-none cursor-move"
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
                    ? {
                        ...d.original,
                        x: Math.max(0, d.original.x + (e.clientX - d.x) / zoom),
                        y: Math.max(0, d.original.y + (e.clientY - d.y) / zoom),
                      }
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
              <span className="flex-1 min-w-0 truncate text-xs leading-none" title={expression}>
                <MathView latex={normalizeLatex(expression) || expression} />
              </span>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="缩小图像"
                className="grid place-items-center min-w-7 min-h-7 max-md:min-w-9 max-md:min-h-9 rounded-md text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer"
                onClick={() => updateGraph({ width: Math.max(160, graph.width * 0.85), height: Math.max(140, graph.height * 0.85) })}
              >
                −
              </button>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="放大图像"
                className="grid place-items-center min-w-7 min-h-7 max-md:min-w-9 max-md:min-h-9 rounded-md text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer"
                onClick={() => updateGraph({ width: Math.min(600, graph.width * 1.15), height: Math.min(500, graph.height * 1.15) })}
              >
                ＋
              </button>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="删除图像"
                className="grid place-items-center min-w-7 min-h-7 max-md:min-w-9 max-md:min-h-9 rounded-md text-on-surface-2 hover:bg-surface-3 hover:text-danger transition-colors cursor-pointer"
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
            <div className="flex-1 min-h-0">
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
  zoom = 1,
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
  zoom?: number
  pushAction: (a: Action) => void
  afterChange: () => void
  bump: () => void
  onScale: (scale: number) => void
  onCopy: () => void
  onDelete: () => void
}) {
  const toolbarBelow = selectionBox.minY < 56
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
        strokesRef.current = transformStrokes(
          d.before,
          new Set(selected),
          (e.clientX - d.x) / zoom,
          (e.clientY - d.y) / zoom,
        )
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
      <div
        className={cn('absolute left-0 flex gap-1 whitespace-nowrap z-20', !toolbarBelow && '-top-10')}
        style={toolbarBelow ? { top: 'calc(100% + 8px)' } : undefined}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button type="button" aria-label="缩小选中笔迹" className="min-h-8 min-w-8 rounded-lg bg-surface border border-outline px-2 py-1 text-xs shadow-sm cursor-pointer hover:bg-surface-2" onClick={() => onScale(0.85)}>
          −
        </button>
        <button type="button" aria-label="放大选中笔迹" className="min-h-8 min-w-8 rounded-lg bg-surface border border-outline px-2 py-1 text-xs shadow-sm cursor-pointer hover:bg-surface-2" onClick={() => onScale(1.15)}>
          +
        </button>
        <button type="button" className="min-h-8 rounded-lg bg-surface border border-outline px-2 py-1 text-xs shadow-sm cursor-pointer hover:bg-surface-2" onClick={onCopy}>
          复制
        </button>
        <button type="button" className="min-h-8 rounded-lg bg-surface border border-outline px-2 py-1 text-xs shadow-sm text-danger cursor-pointer hover:bg-surface-2" onClick={onDelete}>
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
  onNewFormula,
}: {
  model: ModelState
  percent: number | null
  recognizing: number
  onOpenSettings: () => void
  onRetryModel: () => void
  onNewFormula?: () => void
}) {
  const [dismissedPhase, setDismissedPhase] = useState<'loading' | 'error' | null>(null)
  if (model.phase !== 'loading' && model.phase !== 'error' && recognizing <= 0) return null
  if ((model.phase === 'loading' || model.phase === 'error') && dismissedPhase === model.phase) {
    return recognizing > 0 ? (
      <div className="absolute left-1/2 -translate-x-1/2 bottom-3.5 w-max pointer-events-auto z-20">
        <div className="card flex items-center gap-2 px-3 py-1.5 shadow">
          <Loader2 size={13} className="animate-spin text-primary" />
          <span className="text-[11.5px] text-on-surface-2">识别中…</span>
        </div>
      </div>
    ) : null
  }
  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-3.5 w-max max-w-[calc(100%-1.5rem)] pointer-events-auto z-20">
      {model.phase === 'loading' ? (
        <div className="card flex items-start gap-2.5 px-3.5 py-2 shadow-lg min-w-[240px]">
          <Loader2 size={14} className="animate-spin text-primary shrink-0 mt-1" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium">首次使用，正在下载识别模型{percent != null ? ` ${percent}%` : '…'}</p>
            <div className="mt-1 h-1 rounded-full bg-surface-3 overflow-hidden">
              <div
                className={cn('h-full rounded-full bg-primary transition-[width] duration-200', percent == null && 'w-1/3 animate-pulse')}
                style={percent != null ? { width: `${percent}%` } : undefined}
              />
            </div>
            <p className="text-[10.5px] text-on-surface-2 mt-1">
              约 120MB，只下载一次 · 可先手写{onNewFormula ? '或' : ''}
              {onNewFormula && (
                <button type="button" onClick={onNewFormula} className="underline text-primary cursor-pointer ml-0.5">
                  键盘输入
                </button>
              )}
            </p>
          </div>
          <button
            type="button"
            aria-label="收起模型下载提示"
            title="收起提示，继续书写"
            onClick={() => setDismissedPhase('loading')}
            className="grid place-items-center size-7 -mr-1 -mt-0.5 rounded-lg text-on-surface-2 hover:bg-surface-3 hover:text-on-surface cursor-pointer shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      ) : model.phase === 'error' ? (
        <div className="card flex flex-col gap-2 px-4 py-3 shadow-lg max-w-sm">
          <div className="flex items-start justify-between gap-2">
            <p role="status" className="text-[13px] text-danger">识别模型加载失败，可点「手动输入」离线计算，或换源重试。</p>
            <button
              type="button"
              aria-label="收起模型错误提示"
              title="收起提示，继续手写或手动输入"
              onClick={() => setDismissedPhase('error')}
              className="grid place-items-center size-7 -mr-1.5 -mt-1 rounded-lg text-on-surface-2 hover:bg-surface-3 hover:text-on-surface cursor-pointer shrink-0"
            >
              <X size={14} />
            </button>
          </div>
          <details className="text-xs text-on-surface-2">
            <summary className="cursor-pointer">详情</summary>
            <p className="break-all max-h-24 overflow-y-auto mt-1">{model.message}</p>
          </details>
          <div className="flex flex-wrap justify-end gap-2">
            {onNewFormula && (
              <Button size="sm" variant="outline" className="h-9 px-3" onClick={onNewFormula}>键盘输入</Button>
            )}
            <Button size="sm" variant="outline" className="h-9 px-3" onClick={onOpenSettings}>换下载源</Button>
            <Button
              size="sm"
              variant="primary"
              className="h-9 px-3"
              onClick={() => {
                setDismissedPhase(null)
                onRetryModel()
              }}
            >
              重试
            </Button>
          </div>
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
