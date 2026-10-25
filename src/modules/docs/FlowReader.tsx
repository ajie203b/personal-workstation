import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { Annotation, AnnotationTextAnchor, DocSettings } from '@/db/db'
import type { FlowDoc } from './flowDoc'
import { saveScrollAndProgress } from '@/db/docs'
import { handleDocLink } from '@/lib/links'
import { usePinch } from '@/lib/usePinch'
import { collectTextAnchors, wrapText } from './reader/textAnchors'

export interface FlowSelectionInfo {
  text: string
  segIdx: number
  textAnchors: AnnotationTextAnchor[]
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
  /** 正文图片点开看大图（Word 扫描件、截图缩略图都靠它看清） */
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null)

  // 双指缩放 = 改字号：手势中只写 CSS 变量，不触发 React 重渲染；松手才落库
  const proseRef = useRef<HTMLDivElement>(null)
  const liveFontRef = useRef(settings.fontSize)
  const baseFontRef = useRef(settings.fontSize)
  const fontAnchor = useRef<{ el: HTMLElement; top: number } | null>(null)
  const pinchTarget = useRef<HTMLElement | null>(null)
  useEffect(() => {
    liveFontRef.current = settings.fontSize
    // 松手落库后全局变量已经等于新字号，撤掉可见章节上的临时覆盖
    const target = pinchTarget.current
    if (!target) return
    target.style.removeProperty('--flow-font-size')
    target.style.removeProperty('--word-font-scale')
    pinchTarget.current = null
  }, [settings.fontSize])

  usePinch(scrollRef, {
    onStart: () => {
      if (pinchTarget.current) {
        pinchTarget.current.style.removeProperty('--flow-font-size')
        pinchTarget.current.style.removeProperty('--word-font-scale')
        pinchTarget.current = null
      }
      baseFontRef.current = liveFontRef.current
      const c = scrollRef.current
      const segs = segRefs.current.filter(Boolean) as HTMLElement[]
      if (!c) return
      const cr = c.getBoundingClientRect()
      const hit = segs.find((el) => el.getBoundingClientRect().bottom > cr.top + 8) ?? segs[0]
      fontAnchor.current = hit ? { el: hit, top: hit.getBoundingClientRect().top - cr.top } : null
      pinchTarget.current = hit ?? null
    },
    onScale: (ratio) => {
      const px = Math.round(Math.min(32, Math.max(14, baseFontRef.current * ratio)))
      liveFontRef.current = px
      // 手势中只给当前可见章节改字号：其它章节保持旧值，不在每一帧整篇重排。
      // 松手后 settings 更新，全局变量一次性落到所有章节。
      const target = fontAnchor.current?.el ?? proseRef.current
      if (!target) return
      target.style.setProperty('--flow-font-size', `${px}px`)
      target.style.setProperty('--word-font-scale', String(px / 16))
    },
    onEnd: () => {
      if (liveFontRef.current !== settings.fontSize) {
        onFontSizeChange?.(liveFontRef.current)
      } else if (pinchTarget.current) {
        pinchTarget.current.style.removeProperty('--flow-font-size')
        pinchTarget.current.style.removeProperty('--word-font-scale')
        pinchTarget.current = null
      }
    },
  })

  useLayoutEffect(() => {
    const a = fontAnchor.current
    const c = scrollRef.current
    if (!a || !c || !a.el.isConnected) return
    const cr = c.getBoundingClientRect()
    c.scrollTop += (a.el.getBoundingClientRect().top - cr.top) - a.top
  }, [settings.fontSize, scrollRef])

  useEffect(() => { onLoaded(flow.segments.length) }, [flow.segments.length, onLoaded])

  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

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

  // 批注逐片回放，跨章节也保留精确选区；旧批注按起点及摘录兼容定位。
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
      if (ann.textAnchors?.length) {
        for (const anchor of ann.textAnchors) {
          const root = roots[anchor.blockIdx]
          if (root) wrapText(root, anchor.text, ann.id, ann.color, anchor)
        }
      } else {
        const sections = roots.filter((root): root is HTMLElement => !!root)
        const bodies = roots.map((root) => root?.querySelector<HTMLElement>('.flow-body') ?? null)
        const fromBodies = bodies.slice(ann.blockIdx).filter((root): root is HTMLElement => !!root)
        // 旧摘录优先匹配正文，避免同名的合成章节标题抢走正文高亮。
        if (wrapText(fromBodies, ann.text, ann.id, ann.color)) continue
        const fromSections = roots.slice(ann.blockIdx).filter((root): root is HTMLElement => !!root)
        if (wrapText(fromSections, ann.text, ann.id, ann.color)) continue
        if (wrapText(bodies.filter((root): root is HTMLElement => !!root), ann.text, ann.id, ann.color)) continue
        wrapText(sections, ann.text, ann.id, ann.color)
      }
    }
  }, [annotations, flow])

  // EPUB 图片按需加载：只解压进入视口附近的图片，打开大书不再等全部资源
  useEffect(() => {
    const root = scrollRef.current
    const resolve = flow.resolveImage
    if (!root || !resolve) return
    let alive = true
    const load = async (img: HTMLImageElement) => {
      const path = img.dataset.epubSrc
      if (!path) return
      img.removeAttribute('data-epub-src')
      const url = await resolve(path)
      if (!alive) return
      if (url) img.src = url
      else img.remove()
    }
    const imgs = [...root.querySelectorAll<HTMLImageElement>('img[data-epub-src]')]
    if (!imgs.length) return
    if (!('IntersectionObserver' in window)) {
      for (const img of imgs) void load(img)
      return
    }
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        io.unobserve(entry.target)
        void load(entry.target as HTMLImageElement)
      }
    }, { root, rootMargin: '800px 0px' })
    for (const img of imgs) io.observe(img)
    return () => {
      alive = false
      io.disconnect()
    }
  }, [flow, scrollRef])

  // 章节闪烁不再重建整棵 DOM，只给目标节点加/摘类，避免打断已加载的图片
  useEffect(() => {
    if (flashSeg == null) return
    const el = segRefs.current[flashSeg]
    if (!el) return
    el.classList.add('ann-flash', 'rounded-[10px]')
    const t = window.setTimeout(() => el.classList.remove('ann-flash', 'rounded-[10px]'), 1600)
    return () => {
      window.clearTimeout(t)
      el.classList.remove('ann-flash', 'rounded-[10px]')
    }
  }, [flashSeg])

  // 恢复进度：优先深度进度
  // layout effect 让定位发生在绘制这一帧之前（否则先闪一下顶部再瞬移）；
  // 进度是从库里异步读的、可能比正文晚到，所以没拿到目标前不能把自己标成已完成
  const didInit = useRef(false)
  // 同一位置切换到另一篇文档时，组件会复用；恢复标记必须跟着新 flow 重置
  useLayoutEffect(() => {
    restoredRef.current = false
    didInit.current = false
    fontAnchor.current = null
    pinchTarget.current = null
  }, [flow])
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
    const range = sel.getRangeAt(0)
    const roots = segRefs.current
    if (!roots.some((root) => root?.contains(range.startContainer)) || !roots.some((root) => root?.contains(range.endContainer))) {
      onSelection(null)
      return
    }
    const textAnchors = collectTextAnchors(range, roots)
    if (!textAnchors.length) { onSelection(null); return }
    const segIdx = textAnchors[0].blockIdx
    const rect = range.getBoundingClientRect()
    const below = rect.top < 90
    onSelection({
      text,
      segIdx,
      textAnchors,
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

  // 字号/行距/主题变化只改外层 CSS 变量；这棵章节树保持引用不变，React 不会重建整篇 DOM
  const segmentEls = useMemo(() => flow.segments.map((seg, i) => (
    <section
      key={i}
      data-seg={i}
      ref={(el) => { segRefs.current[i] = el }}
      className={cn('flow-doc flow-seg', i > 0 && 'mt-10 pt-8 border-t border-outline/60')}
    >
      {flow.unit !== 'doc' && (
        <h2 className="flow-seg-title">{seg.title}</h2>
      )}
      {/* seg.html 在 flowDoc 解析阶段已过 sanitizeHtml 白名单清洗（事件属性 / 脚本 / 危险协议都会被摘掉），
          这里不要再拼接任何未经清洗的外部 HTML */}
      <div className="flow-body" dangerouslySetInnerHTML={{ __html: seg.html }} />
    </section>
  )), [flow])

  return (
    <>
    {/* ref 必须挂在这个根节点上：滚动监听、进度上报、位置恢复、目录跳转全走 scrollRef，
        漏挂时这些路径会静默空转（容器是真的能滚，只是没人听见它的 scroll 事件） */}
    <div
      ref={scrollRef}
      // EPUB/DOCX 正文里的链接同样不能改掉 SPA 地址（详见 lib/links）；
      // 图片点开看大图 —— Word 里的图经常是整页扫描件，靠缩略图看不清
      onClick={(e) => {
        const target = e.target as Element
        const img = target.closest?.('img')
        if (img) {
          // 还没按需加载的 EPUB 图片只有一个透明占位，别拿它开大图
          if (img.hasAttribute('data-epub-src')) return
          const src = img.getAttribute('src')
          if (src) {
            e.preventDefault()
            setPreview({ src, alt: img.getAttribute('alt') ?? '' })
            return
          }
        }
        const a = target.closest?.('a[href]')
        if (a) handleDocLink(e, a.getAttribute('href'))
      }}
      style={{ touchAction: 'pan-x pan-y' }}
      className={cn('h-full overflow-y-auto overscroll-contain', themeCls)}
    >
      <div
        ref={proseRef}
        className="reader-prose mx-auto py-8 md:py-12"
        style={{
          ['--reader-width' as string]: `${settings.widthPct}%`,
          ['--flow-font-size' as string]: `${settings.fontSize}px`,
          ['--flow-leading' as string]: String(settings.leading),
          ['--word-font-scale' as string]: String(settings.fontSize / 16),
          ['--word-leading' as string]: String(settings.leading),
        }}
      >
        {flow.styles && <style>{flow.styles}</style>}
        {segmentEls}
        <div className="h-24" />
      </div>
    </div>

    {preview && (
      <div
        role="dialog"
        aria-label="查看大图"
        onClick={() => setPreview(null)}
        className="fixed inset-0 z-[70] bg-black/88 flex items-center justify-center p-3 md:p-8"
        style={{ animation: 'overlay-fade var(--dur-1) var(--ease-standard)' }}
      >
        <img
          src={preview.src}
          alt={preview.alt}
          className="max-w-full max-h-full object-contain rounded-[10px] border border-white/15"
        />
        <button
          type="button"
          aria-label="关闭大图"
          onClick={() => setPreview(null)}
          className="absolute top-[calc(env(safe-area-inset-top)+12px)] right-3 grid place-items-center w-10 h-10 rounded-full bg-white/12 text-white hover:bg-white/20 transition-colors cursor-pointer"
        >
          <X size={19} />
        </button>
      </div>
    )}
    </>
  )
}
