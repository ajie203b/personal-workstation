import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import type { DocSettings } from '@/db/db'
import type { FlowDoc } from './flowDoc'
import { saveScrollAndProgress } from '@/db/docs'

export interface FlowJumpTarget {
  segIdx: number
  ratio: number
}

interface Props {
  hash: string
  flow: FlowDoc
  settings: DocSettings
  jump: { anchor: string; ts: number } | null
  onProgress: (segIdx: number, pct: number) => void
  onRestored: () => void
  onLoaded: (segCount: number) => void
  scrollRef: React.RefObject<HTMLDivElement>
  initialTarget: FlowJumpTarget | null
}

/**
 * 流式阅读器（v1.3）：EPUB / DOCX / PPTX / TXT 统一滚动阅读。
 * 复用沉浸排版设置（主题/字号/行距/页宽），双坐标进度按 segment + ratio 记忆。
 */
export function FlowReader({ hash, flow, settings, jump, onProgress, onRestored, onLoaded, scrollRef, initialTarget }: Props) {
  const restoredRef = useRef(false)
  const lastWriteRef = useRef(0)
  const segRefs = useRef<(HTMLElement | null)[]>([])
  const [flashSeg, setFlashSeg] = useState<number | null>(null)

  useEffect(() => { onLoaded(flow.segments.length) }, [flow.segments.length, onLoaded])

  // 进度上报：滚动位置 → 当前 segment + 总进度
  const report = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const top = container.scrollTop
    const viewH = container.clientHeight
    const totalH = container.scrollHeight - viewH
    const pct = totalH > 0 ? Math.min(1, Math.max(0, top / totalH)) : 0
    // 找当前视口顶部所在 segment
    let idx = 0
    for (let i = 0; i < segRefs.current.length; i++) {
      const el = segRefs.current[i]
      if (el && el.offsetTop <= top + viewH * 0.35) idx = i
    }
    const el = segRefs.current[idx]
    const ratio = el && el.offsetHeight > 0
      ? Math.min(1, Math.max(0, (top - el.offsetTop) / el.offsetHeight))
      : 0
    onProgress(idx, pct)
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

  // 恢复进度：优先深度进度，其次精确滚动
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current) return
    const container = scrollRef.current
    if (!container) return
    const target = initialTarget
    if (target) {
      const el = segRefs.current[target.segIdx]
      if (el) {
        container.scrollTop = el.offsetTop + el.offsetHeight * target.ratio
        restoredRef.current = true
        onRestored()
      }
    }
    didInit.current = true
  }, [initialTarget, onRestored, scrollRef])

  // 跳转锚点 f{n}
  useEffect(() => {
    if (!jump) return
    const m = jump.anchor.match(/^f(\d+)$/)
    if (!m) return
    const idx = Number(m[1])
    const el = segRefs.current[idx]
    const container = scrollRef.current
    if (el && container) {
      container.scrollTo({ top: Math.max(0, el.offsetTop - 8), behavior: 'smooth' })
      setFlashSeg(idx)
      const t = setTimeout(() => setFlashSeg(null), 1600)
      return () => clearTimeout(t)
    }
  }, [jump, scrollRef])

  const themeCls = `theme-${settings.theme}`

  return (
    <div className="h-full overflow-y-auto overscroll-contain" style={{ background: 'var(--reader-bg, inherit)' }}>
      <div
        className={cn('mx-auto px-4 py-8', themeCls)}
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
              style={{ fontSize: settings.fontSize, lineHeight: settings.leading }}
              dangerouslySetInnerHTML={{ __html: seg.html }}
            />
          </section>
        ))}
        <div className="h-24" />
      </div>
    </div>
  )
}
