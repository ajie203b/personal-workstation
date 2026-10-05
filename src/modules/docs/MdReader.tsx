import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { saveScrollAndProgress } from '@/db/docs'
import type { Annotation, DocSettings } from '@/db/db'

export interface MdSelectionInfo {
  text: string
  blockIdx: number
  /** 浮条锚点（容器坐标）：below=true 表示应显示在选区下方（靠近顶部时翻转） */
  popover: { left: number; y: number; below: boolean }
}

interface Props {
  hash: string
  md: string
  settings: DocSettings
  annotations: Annotation[]
  /** 深链定位：b7 / b7#annId */
  jump: { anchor: string; hl?: string; ts: number } | null
  onSelection: (sel: MdSelectionInfo | null) => void
  /** 上报当前进度：当前块号 + 阅读百分比 */
  onProgress: (blockIdx: number, pct: number) => void
  onRestored: () => void
  scrollRef: React.RefObject<HTMLDivElement>
  /** 初次挂载后的进度恢复 */
  initialTarget: { blockIdx: number; ratio: number } | null
}

/** 解析 Markdown：按空行切块，返回标题目录（块号即顶级块序号） */
export function parseMdBlocks(md: string): { headings: { level: number; text: string; blockIdx: number }[]; total: number } {
  const headings: { level: number; text: string; blockIdx: number }[] = []
  let inCode = false
  let blockIdx = -1
  let empty = true
  for (const raw of md.split('\n')) {
    if (raw.trimStart().startsWith('```')) inCode = !inCode
    if (raw.trim() === '' && !inCode) {
      empty = true
      continue
    }
    if (empty) {
      blockIdx++
      empty = false
      const m = raw.match(/^(#{1,4})\s+(.*)$/)
      if (m) headings.push({ level: m[1].length, text: m[2].replace(/[#*`]/g, '').trim(), blockIdx })
    }
  }
  return { headings, total: blockIdx + 1 }
}

/** MD 阅读器：块锚点渲染 + 沉浸排版 + 划词高亮 */
export function MdReader({
  hash, md, settings, annotations, jump, onSelection, onProgress, onRestored, scrollRef, initialTarget,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const lastScrollTop = useRef(0)
  const lastJumpTs = useRef(0)
  const restoredRef = useRef(false)
  const lastReportedPct = useRef(-1)
  const lastWriteRef = useRef(0)

  // 顶级块分配锚点 id
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    Array.from(el.children).forEach((child, i) => {
      if (child instanceof HTMLElement && !child.id) child.id = `b${i}`
    })
  }, [md])

  // 批注 → <mark> 包裹
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.querySelectorAll('mark[data-ann]').forEach((m) => {
      const parent = m.parentNode
      if (parent) while (m.firstChild) parent.insertBefore(m.firstChild, m)
      m.remove()
      parent?.normalize()
    })
    for (const ann of annotations) {
      if (ann.blockIdx == null || !ann.text) continue
      const block = el.querySelector(`#b${ann.blockIdx}`)
      if (block) wrapText(block as HTMLElement, ann.text, ann.id, ann.color)
    }
  }, [annotations, md])

  // 批注闪烁
  useEffect(() => {
    if (!jump?.hl) return
    const el = bodyRef.current?.querySelector(`[data-ann="${jump.hl}"]`)
    if (el) {
      el.classList.add('ann-flash')
      const t = setTimeout(() => el.classList.remove('ann-flash'), 2000)
      return () => clearTimeout(t)
    }
  }, [jump, annotations])

  // 首次挂载：恢复深度阅读进度（保存以视口上 1/3 为阅读点，恢复用同一基准）
  useEffect(() => {
    if (restoredRef.current || !initialTarget) return
    const container = scrollRef.current
    const block = bodyRef.current?.querySelector(`#b${initialTarget.blockIdx}`) as HTMLElement | null
    if (container && block) {
      const offset = Math.max(0, block.offsetTop + initialTarget.ratio * block.offsetHeight - container.clientHeight * 0.3)
      container.scrollTop = offset
      restoredRef.current = true
      onRestored()
    }
  }, [initialTarget, scrollRef, onRestored])

  // 目录 / 批注跳转
  useEffect(() => {
    if (!jump || jump.ts === lastJumpTs.current) return
    lastJumpTs.current = jump.ts
    const container = scrollRef.current
    const m = jump.anchor.match(/^b(\d+)/)
    if (!container || !m) return
    const block = bodyRef.current?.querySelector(`#b${m[1]}`) as HTMLElement | null
    if (block) container.scrollTo({ top: Math.max(0, block.offsetTop - 60), behavior: 'smooth' })
  }, [jump, scrollRef])

  // 滚动：双坐标保存 + 进度上报
  const onScroll = useCallback(() => {
    const container = scrollRef.current
    const body = bodyRef.current
    if (!container || !body) return
    const top = container.scrollTop
    const maxScroll = container.scrollHeight - container.clientHeight
    const pct = maxScroll > 0 ? Math.min(1, top / maxScroll) : 0

    // 当前块 = 视口上 1/3 处所在块
    let current = 0
    const kids = Array.from(body.children) as HTMLElement[]
    for (const k of kids) {
      if (k.offsetTop <= top + container.clientHeight * 0.3) current = Number(k.id.slice(1)) || 0
      else break
    }
    const intPct = Math.round(pct * 100)
    if (intPct !== lastReportedPct.current) {
      lastReportedPct.current = intPct
      onProgress(current, intPct / 100)
    }

    // 防快速翻页污染：单次位移 > 3000px 视为跳转，只更新 lastScroll
    // 写库节流至 500ms/次（阅读位置精度足够，避免每个滚动事件都开事务）
    const delta = Math.abs(top - lastScrollTop.current)
    lastScrollTop.current = top
    const now = Date.now()
    if (now - lastWriteRef.current < 500) return
    lastWriteRef.current = now
    if (delta < 3000) {
      const block = kids.find((k) => Number(k.id.slice(1)) === current)
      const ratio = block && block.offsetHeight > 0
        ? Math.min(1, Math.max(0, (top + container.clientHeight * 0.3 - block.offsetTop) / block.offsetHeight))
        : 0
      void saveScrollAndProgress(hash, top, { kind: 'md', blockIdx: current, ratio }, pct)
    } else {
      void saveScrollAndProgress(hash, top, null, pct)
    }
  }, [hash, onProgress, scrollRef])

  // 划词检测（mouseup 与移动端 selectionchange/touchend 共用）
  const checkSelection = useCallback(() => {
    const sel = window.getSelection()
    const container = scrollRef.current
    if (!sel || sel.isCollapsed || !container) {
      onSelection(null)
      return
    }
    const text = sel.toString().trim()
    if (!text) {
      onSelection(null)
      return
    }
    const node = sel.anchorNode
    const blockEl = (node instanceof Element ? node : node?.parentElement)?.closest('[id^="b"]')
    if (!blockEl) {
      onSelection(null)
      return
    }
    const blockIdx = Number((blockEl as HTMLElement).id.slice(1))
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    // 视口坐标（浮条为 fixed 定位，不受滚动容器裁剪）
    const topAbs = rect.top
    const bottomAbs = rect.bottom
    const below = topAbs < 90
    onSelection({
      text,
      blockIdx,
      popover: {
        left: rect.left + rect.width / 2,
        y: below ? bottomAbs : topAbs,
        below,
      },
    })
  }, [onSelection, scrollRef])

  const onMouseUp = useCallback(() => checkSelection(), [checkSelection])

  // 移动端：长按选择后无 mouseup，用 selectionchange / touchend 触发
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const debounced = () => {
      clearTimeout(timer)
      timer = setTimeout(checkSelection, 250)
    }
    document.addEventListener('selectionchange', debounced)
    document.addEventListener('touchend', debounced)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', debounced)
      document.removeEventListener('touchend', debounced)
    }
  }, [checkSelection])

  return (
    <div ref={scrollRef} onScroll={onScroll} className={`h-full overflow-y-auto theme-${settings.theme}`}>
      <div
        style={{ width: `${settings.widthPct}%`, fontSize: settings.fontSize, ['--md-leading' as string]: String(settings.leading) }}
        className="mx-auto px-2 py-10 md:py-14 min-w-0"
      >
        <div ref={bodyRef} className="md-body" onMouseUp={onMouseUp}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

/** 在元素内找到目标文本（可跨文本节点）并包上 mark */
function wrapText(root: HTMLElement, text: string, annId: string, color: string): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  const joined = nodes.map((n) => n.data).join('')
  const idx = joined.indexOf(text)
  if (idx < 0) return
  const endIdx = idx + text.length

  const mark = document.createElement('mark')
  mark.className = `hl-${color}`
  mark.dataset.ann = annId

  let consumed = 0
  const range = document.createRange()
  let rangeOpen = false
  for (const n of nodes) {
    const start = consumed
    const end = consumed + n.data.length
    consumed = end
    if (end <= idx || start >= endIdx) continue
    const localStart = Math.max(0, idx - start)
    const localEnd = Math.min(n.data.length, endIdx - start)
    if (!rangeOpen) {
      range.setStart(n, localStart)
      rangeOpen = true
    }
    range.setEnd(n, localEnd)
  }
  if (!rangeOpen) return
  try {
    range.surroundContents(mark)
  } catch {
    // 跨元素边界时降级为 extract+insert
    try {
      const frag = range.extractContents()
      mark.appendChild(frag)
      range.insertNode(mark)
    } catch {
      /* 忽略无法锚定的批注 */
    }
  }
}
