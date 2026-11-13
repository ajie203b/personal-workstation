import { useEffect, useState } from 'react'
import type { Annotation } from '@/db/db'
import { cn } from '@/lib/cn'
import { collectPageRects, type NormRect } from './pdfRects'

/**
 * 选区预览层：每页挂一个，自己订阅选区变化。
 * 刻意不放在 PdfReader 的 state 里——拖拽选区时 selectionchange 每帧都来，
 * 状态挂在页列表上会连带 5 个 <Page> 一起重渲染，向右拖动就能感到卡顿。
 * 矩形存成页内百分比，所以滚动也不失配，无需跟 scroll。
 */
export function SelectionLayer({ page }: { page: number }) {
  const [rects, setRects] = useState<NormRect[] | null>(null)

  useEffect(() => {
    // 16ms 合并：与一帧同量级。刻意不用 rAF——页面不可见时 rAF 挂起，选区反馈会整个丢掉
    let timer: ReturnType<typeof setTimeout> | undefined
    const sync = () => {
      timer = undefined
      const sel = window.getSelection()
      const node = sel?.anchorNode
      const owner = sel && !sel.isCollapsed && sel.rangeCount
        ? ((node instanceof Element ? node : node?.parentElement)?.closest('[data-page]') as HTMLElement | null)
        : null
      if (!owner || Number(owner.dataset.page) !== page) {
        setRects((prev) => (prev ? null : prev))
        return
      }
      const next = collectPageRects(sel!.getRangeAt(0), owner.getBoundingClientRect())
      setRects(next.length ? next : null)
    }
    const onSel = () => {
      if (timer) return
      timer = setTimeout(sync, 16)
    }
    document.addEventListener('selectionchange', onSel)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', onSel)
    }
  }, [page])

  if (!rects) return null
  return (
    <div className="absolute inset-0 pointer-events-none">
      {rects.map((r, i) => (
        <span
          key={i}
          className="sel-preview absolute"
          style={{
            left: `${r.x * 100}%`,
            top: `${r.y * 100}%`,
            width: `${r.w * 100}%`,
            height: `${r.h * 100}%`,
          }}
        />
      ))}
    </div>
  )
}

/** 批注叠层：文字高亮填充 / 截图批注描边（非截图模式下可点击交互） */
export function PageAnnotationsOverlay({
  annotations,
  annRects,
  flashId,
  interactive = false,
  selectedId,
  onSelectAnn,
}: {
  annotations: Annotation[]
  annRects: Map<string, NormRect[]>
  flashId: string | null
  interactive?: boolean
  selectedId?: string | null
  onSelectAnn?: (ann: Annotation, rect: DOMRect) => void
}) {
  return (
    <>
      {annotations.map((a) => {
        const isShot = a.kind === 'shot'
        const colorCls = a.color === 'yellow' ? 'hl-yellow' : a.color === 'green' ? 'hl-green' : a.color === 'blue' ? 'hl-blue' : 'hl-red'
        return (
          <div
            key={a.id}
            data-ann={a.id}
            className={`absolute inset-0 pointer-events-none ${flashId === a.id ? 'ann-flash' : ''}`}
            style={{ ['--ann-opacity' as string]: '0.4' }}
          >
            {(annRects.get(a.id) ?? a.rects!).map((r, ri) => (
              <span
                key={ri}
                role={interactive && ri === 0 ? 'button' : undefined}
                aria-label={interactive && ri === 0 ? `管理批注：${a.text.slice(0, 30)}` : undefined}
                onMouseUp={interactive ? (e) => {
                  if (window.getSelection()?.isCollapsed !== false) {
                    e.stopPropagation()
                    onSelectAnn?.(a, e.currentTarget.getBoundingClientRect())
                  }
                } : undefined}
                onClick={interactive ? (e) => e.stopPropagation() : undefined}
                className={cn(
                  'absolute',
                  isShot ? 'border-2 border-primary' : colorCls,
                  interactive && 'pointer-events-auto cursor-pointer hover:brightness-95 transition-[box-shadow,filter]',
                  selectedId === a.id && 'ring-2 ring-primary ring-offset-1',
                )}
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`,
                  height: `${r.h * 100}%`,
                  ...(isShot ? { background: 'color-mix(in srgb, var(--primary) 8%, transparent)' } : {}),
                }}
              />
            ))}
          </div>
        )
      })}
    </>
  )
}

/** 页内查找命中矩形叠层（独立于 .textLayer，避免 pdf.js 透明字体层与重影问题） */
export function PageFindOverlay({
  matches,
  activeMatchIdx,
}: {
  matches: NormRect[][]
  activeMatchIdx: number
}) {
  if (!matches.length) return null
  return (
    <div className="absolute inset-0 pointer-events-none z-[2]">
      {matches.map((rects, mi) => {
        const active = mi === activeMatchIdx
        return rects.map((r, ri) => (
          <span
            key={`${mi}-${ri}`}
            className="absolute rounded-[2px]"
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
              background: active ? 'rgba(249, 115, 22, 0.55)' : 'rgba(250, 204, 21, 0.45)',
              outline: active ? '1.5px solid rgba(234, 88, 12, 0.95)' : undefined,
            }}
          />
        ))
      })}
    </div>
  )
}
