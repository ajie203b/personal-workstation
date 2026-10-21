import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import type { Annotation, DocSettings } from '@/db/db'
import type { FlowDoc } from './flowDoc'
import { saveScrollAndProgress } from '@/db/docs'
import { handleDocLink } from '@/lib/links'
import { usePinch } from '@/lib/usePinch'
import { wrapText } from './MdReader'

export interface FlowSelectionInfo {
  text: string
  segIdx: number
  /** 浮条锚点（视口坐标）：below=true 表示应显示在选区下方 */
  popover: { left: number; y: number; below: boolean }
}

export interface FlowJumpTarget {
  segIdx: number
  ratio: number
}

interface Props {
  hash: string
  flow: FlowDoc
  settings: DocSettings
  annotations: Annotation[]
  jump: { anchor: string; hl?: string; ts: number } | null
  onSelection: (sel: FlowSelectionInfo | null) => void
  onProgress: (segIdx: number, pct: number) => void
  onRestored: () => void
  onLoaded: (segCount: number) => void
  scrollRef: React.RefObject<HTMLDivElement>
  initialTarget: FlowJumpTarget | null
  /** 双指缩放提交后的字号（px） */
  onFontSizeChange?: (px: number) => void
}

/**
 * 流式阅读器（v1.3）：EPUB / DOCX / PPTX / TXT 统一滚动阅读。
 * 复用沉浸排版设置与批注体系（v1.3.1：划词高亮按章节/片定位，文本 mark 包裹）。
 */
export function FlowReader({ hash, flow, settings, annotations, jump, onSelection, onProgress, onRestored, onLoaded, scrollRef, initialTarget, onFontSizeChange }: Props) {
  const restoredRef = useRef(false)
  const lastWriteRef = useRef(0)
  const lastJumpTs = useRef(0)
  const lastReportedPct = useRef(-1)
  const segRefs = useRef<(HTMLElement | null)[]>([])
  const [flashSeg, setFlashSeg] = useState<number | null>(null)

  // 双指缩放 = 改字号：docx/epub/pptx/txt 与 Markdown 同一套手感
  const [liveFont, setLiveFont] = useState(settings.fontSize)
  const liveFontRef = useRef(settings.fontSize)
  const baseFontRef = useRef(settings.fontSize)
  const fontAnchor = useRef<{ el: HTMLElement; top: number } | null>(null)
  useEffect(() => {
    liveFontRef.current = settings.fontSize
    setLiveFont(settings.fontSize)
  }, [settings.fontSize])

  usePinch(scrollRef, {
    onStart: () => {
      baseFontRef.current = liveFontRef.current
      const c = scrollRef.current
      const segs = segRefs.current.filter(Boolean) as HTMLElement[]
      if (!c) return
      const cr = c.getBoundingClientRect()
      const hit = segs.find((el) => el.getBoundingClientRect().bottom > cr.top + 8) ?? segs[0]
      fontAnchor.current = hit ? { el: hit, top: hit.getBoundingClientRect().top - cr.top } : null
    },
    onScale: (ratio) => {
      const px = Math.round(Math.min(32, Math.max(14, baseFontRef.current * ratio)))
      liveFontRef.current = px
      setLiveFont(px)
    },
    onEnd: () => { onFontSizeChange?.(liveFontRef.current) },
  })

  useLayoutEffect(() => {
    const a = fontAnchor.current
    const c = scrollRef.current
    if (!a || !c || !a.el.isConnected) return
    const cr = c.getBoundingClientRect()
    c.scrollTop += (a.el.getBoundingClientRect().top - cr.top) - a.top
  }, [liveFont, scrollRef])

  useEffect(() => { onLoaded(flow.segments.length) }, [flow.segments.length, onLoaded])

  // 进度上报：滚动位置 → 当前 segment + 总进度
  const report = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const top = container.scrollTop
    const viewH = container.clientHeight
    const totalH = container.scrollHeight - viewH
    const pct = totalH > 0 ? Math.min(1, Math.max(0, top / totalH)) : 0
    let idx = 0
    for (let i = 0; i < segRefs.current.length; i++) {
      const el = segRefs.current[i]
      if (el && el.offsetTop <= top + viewH * 0.35) idx = i
    }
    const el = segRefs.current[idx]
    const ratio = el && el.offsetHeight > 0
      ? Math.min(1, Math.max(0, (top - el.offsetTop) / el.offsetHeight))
      : 0
    const intPct = Math.round(pct * 100)
    if (intPct !== lastReportedPct.current) {
      lastReportedPct.current = intPct
      onProgress(idx, intPct / 100)
    }
    const now = Date.now()
    if (now - lastWriteRef.current > 1200) {
      lastWriteRef.current = now
      void saveScrollAndProgress(hash, top, { kind: 'flow', segIdx: idx, ratio }, pct)
    }
  }, [hash, onProgress, scrollRef])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    container.addEventListener('scroll', report, { passive: true })
    return () => container.removeEventListener('scroll', report)
  }, [report, scrollRef])

  // 批注 → <mark> 包裹（定位到所属 segment 的正文）
  useLayoutEffect(() => {
    const roots = segRefs.current
    // 先清掉旧 mark
    for (const root of roots) {
      if (!root) continue
      root.querySelectorAll('mark[data-ann]').forEach((m) => {
        const parent = m.parentNode
        if (parent) while (m.firstChild) parent.insertBefore(m.firstChild, m)
        m.remove()
        parent?.normalize()
      })
    }
    for (const ann of annotations) {
      if (ann.blockIdx == null || !ann.text) continue
      const root = roots[ann.blockIdx]?.querySelector('.flow-body') as HTMLElement | null
      if (root) wrapText(root, ann.text, ann.id, ann.color)
    }
  }, [annotations, flow])

  // 恢复进度：优先深度进度
  // layout effect 让定位发生在绘制这一帧之前（否则先闪一下顶部再瞬移）；
  // 进度是从库里异步读的、可能比正文晚到，所以没拿到目标前不能把自己标成已完成
  const didInit = useRef(false)
  useLayoutEffect(() => {
    if (didInit.current) return
    const container = scrollRef.current
    if (!container || !initialTarget) return
    const el = segRefs.current[initialTarget.segIdx]
    if (!el) return
    container.scrollTop = el.offsetTop + el.offsetHeight * initialTarget.ratio
    restoredRef.current = true
    didInit.current = true
    onRestored()
  }, [initialTarget, onRestored, scrollRef])

  // 跳转锚点 f{n} / 批注闪烁
  useEffect(() => {
    if (!jump || jump.ts === lastJumpTs.current) return
    lastJumpTs.current = jump.ts
    const m = jump.anchor.match(/^f(\d+)/)
    const container = scrollRef.current
    if (!m || !container) return
    const idx = Number(m[1])
    const el = segRefs.current[idx]
    if (el) {
      container.scrollTo({ top: Math.max(0, el.offsetTop - 8), behavior: 'smooth' })
      setFlashSeg(idx)
      const t = setTimeout(() => setFlashSeg(null), 1600)
      return () => clearTimeout(t)
    }
  }, [jump, scrollRef])

  useEffect(() => {
    if (!jump?.hl) return
    const mark = document.querySelector(`mark[data-ann="${jump.hl}"]`)
    if (mark) {
      mark.classList.add('ann-flash')
      const t = setTimeout(() => mark.classList.remove('ann-flash'), 2000)
      return () => clearTimeout(t)
    }
  }, [jump, annotations])

  // 划词检测（mouse + 移动端 selectionchange/touchend）
  const checkSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      onSelection(null)
      return
    }
    const text = sel.toString().trim()
    if (!text) {
      onSelection(null)
      return
    }
    const node = sel.anchorNode
    const segEl = (node instanceof Element ? node : node?.parentElement)?.closest('section[data-seg]') as HTMLElement | null
    if (!segEl) {
      onSelection(null)
      return
    }
    const segIdx = Number(segEl.dataset.seg)
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    const below = rect.top < 90
    onSelection({
      text,
      segIdx,
      popover: {
        left: rect.left + rect.width / 2,
        y: below ? rect.bottom : rect.top,
        below,
      },
    })
  }, [onSelection])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const debounced = () => {
      clearTimeout(timer)
      timer = setTimeout(checkSelection, 250)
    }
    document.addEventListener('selectionchange', debounced)
    document.addEventListener('mouseup', checkSelection)
    document.addEventListener('touchend', debounced)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', debounced)
      document.removeEventListener('mouseup', checkSelection)
      document.removeEventListener('touchend', debounced)
    }
  }, [checkSelection])

  const themeCls = `theme-${settings.theme}`

  return (
    // ref 必须挂在这个根节点上：滚动监听、进度上报、位置恢复、目录跳转全走 scrollRef，
    // 漏挂时这些路径会静默空转（容器是真的能滚，只是没人听见它的 scroll 事件）
    <div
      ref={scrollRef}
      // EPUB/DOCX 正文里的链接同样不能改掉 SPA 地址（详见 lib/links）
      onClick={(e) => {
        const a = (e.target as Element).closest?.('a[href]')
        if (a) handleDocLink(e, a.getAttribute('href'))
      }}
      style={{ touchAction: 'pan-x pan-y' }}
      className={cn('h-full overflow-y-auto overscroll-contain', themeCls)}
    >
      <div
        className="mx-auto px-4 py-8"
        style={{ width: `${settings.widthPct}%`, maxWidth: 860, minWidth: 300 }}
      >
        {flow.segments.map((seg, i) => (
          <section
            key={i}
            data-seg={i}
            ref={(el) => { segRefs.current[i] = el }}
            className={cn(
              'flow-doc flow-seg',
              flashSeg === i && 'ann-flash rounded-[10px]',
              i > 0 && 'mt-10 pt-8 border-t border-outline/60',
            )}
          >
            {flow.unit !== 'doc' && (
              <h2 className="flow-seg-title">{seg.title}</h2>
            )}
            <div
              className="flow-body"
              style={{
                fontSize: liveFont,
                lineHeight: settings.leading,
                // 图片跟随字号缩放；max-width 反向缩回，保证放大后仍不超过正文栏宽
                ['--flow-img-zoom' as string]: String(liveFont / 17),
                ['--flow-img-max' as string]: `${100 / (liveFont / 17)}%`,
              }}
              dangerouslySetInnerHTML={{ __html: seg.html }}
            />
          </section>
        ))}
        <div className="h-24" />
      </div>
    </div>
  )
}
