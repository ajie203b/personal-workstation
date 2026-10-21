import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import {
  ArrowLeft, ArrowUpRight, Bookmark, BookmarkPlus, ChevronLeft, ChevronRight, Copy, Crop,
  Highlighter, List, ListPlus, MessageSquareText, BookDown, MoreHorizontal, PanelLeft, PanelRight, PenLine, Settings2,
  Trash2, LocateFixed, Plus, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Annotation, Doc, DocSettings, Task } from '@/db/db'
import { DOC_KIND_LABEL, type ReadingPosition } from '@/db/db'
import { db } from '@/db/db'
import {
  addAnnotation, addBookmark, deleteAnnotation, deleteBookmark,
  getDocBlob, getPosition, saveDocSettings, touchDoc, updateAnnotation,
} from '@/db/docs'
import { useAnnotations, useDoc, useDocBacklinks } from '@/db/hooks'
import { toggleDone } from '@/db/tasks'
import { MORPH_NAME, morphClose } from '@/lib/viewTransition'
import { useDocTabs } from '@/stores/tabs'
import {
  DEFAULT_READER_PANELS, READER_PANEL_LIMITS, useUi,
} from '@/stores/ui'
import { cn } from '@/lib/cn'
import { Segmented } from '@/shared/ui/Segmented'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { Sheet } from '@/shared/ui/Sheet'
import { DropdownMenu, DropdownMenuTrigger, MenuContent, MenuItem, MenuSeparator } from '@/shared/ui/Menu'
import { Skeleton } from '@/shared/ui/Skeleton'
import { MdReader, parseMdBlocks } from './MdReader'
import { PdfReader, type TocItem } from './PdfReader'
import { FlowReader } from './FlowReader'
import { parseFlowDoc, type FlowDoc } from './flowDoc'
import { exportAnnotationsToDoc } from './exportAnnotations'
import { isFutureTask } from '@/lib/date'

const FLOW_KINDS: readonly Doc['kind'][] = ['epub', 'docx', 'pptx', 'txt']

/** 折叠空白后从第一个句末标点截断，最长 48 字；pdf.js 字距排版的中文会带空格，这里一并收紧 */
function firstSentence(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').replace(/([\u4e00-\u9fff]) (?=[\u4e00-\u9fff])/g, '$1').trim()
  if (!s) return ''
  const hit = s.match(/^.{2,48}?(?:[。！？；]|[.!?](?=\s|$))/)
  return hit ? hit[0].trim() : s.slice(0, 48)
}

/**
 * 书签摘录：取该位置的第一句话。
 * 先读已渲染的 DOM（书签总是加在当前看到的页/块上），PDF 页不在渲染窗口时退回全文索引的分页文本。
 */
async function quoteAtLocator(doc: Doc, anchor: string): Promise<string | undefined> {
  const m = anchor.match(/^([pbf])(\d+)$/)
  if (!m) return undefined
  const idx = Number(m[2])
  let raw = ''
  if (m[1] === 'p') {
    raw = document.querySelector(`[data-page="${idx}"] .textLayer`)?.textContent ?? ''
    if (!raw.trim()) raw = (await db.docText.get(doc.hash))?.segments?.[idx - 1] ?? ''
  } else if (m[1] === 'b') {
    raw = document.getElementById(`b${idx}`)?.textContent ?? ''
  } else {
    raw = document.querySelector(`[data-seg="${idx}"]`)?.textContent ?? ''
  }
  return firstSentence(raw) || undefined
}

type Selection =
  | { kind: 'md'; text: string; blockIdx: number; popover: { left: number; y: number; below: boolean } }
  | { kind: 'pdf'; text: string; page: number; rects: { x: number; y: number; w: number; h: number }[]; popover: { left: number; y: number; below: boolean } }
  | { kind: 'flow'; text: string; segIdx: number; popover: { left: number; y: number; below: boolean } }

const DEFAULT_SETTINGS: DocSettings = { theme: 'day', fontSize: 17, leading: 1.85, widthPct: 72 }

const COLORS = ['yellow', 'green', 'blue', 'red'] as const

export function DocReaderPage() {
  const { docId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useUi((s) => s.toast)

  const doc = useDoc(docId)
  const annotations = useAnnotations(doc?.hash)
  const backlinks = useDocBacklinks(docId)

  const scrollRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  /** 拖动分隔线时的起点；宽度直接写 CSS 变量，避免每个 pointermove 都重渲染正文 */
  const splitDrag = useRef<{ side: 'left' | 'right'; startX: number; startW: number } | null>(null)
  /** 改栏宽会让正文重排：记下视口顶部那一块及块内相对位置，重排后放回原处 */
  const readingAnchor = useRef<{ el: HTMLElement; ratio: number; gap: number } | null>(null)
  /** 连续改宽时只保留最后一轮锚点跟踪 */
  const anchorSeq = useRef(0)
  const readerPanels = useUi((s) => s.readerPanels)
  const setReaderPanels = useUi((s) => s.setReaderPanels)
  // 组件在拖拽途中被卸载时，别把全页的 col-resize / 禁选留下
  useEffect(() => () => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])
  const [content, setContent] = useState<
    { kind: 'pdf'; data: ArrayBuffer } | { kind: 'md'; md: string } | { kind: 'flow'; data: FlowDoc } | null
  >(null)
  const [settings, setSettings] = useState<DocSettings>(DEFAULT_SETTINGS)
  const [progressPct, setProgressPct] = useState(0)
  const [currentLocator, setCurrentLocator] = useState('') // p3 / b7 / f2
  const [toc, setToc] = useState<TocItem[]>([])
  const [mdHeadings, setMdHeadings] = useState<{ level: number; text: string; blockIdx: number }[]>([])
  const [numPages, setNumPages] = useState(0)
  const [jump, setJump] = useState<{ anchor: string; hl?: string; ts: number } | null>(null)
  const [initialTarget, setInitialTarget] = useState<
    { page: number; offsetRatio: number } | { blockIdx: number; ratio: number } | { segIdx: number; ratio: number } | null
  >(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [shotMode, setShotMode] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  /** 手机上收起阅读器顶栏（轻点正文切换），把纵向空间还给正文 */
  const [chromeHidden, setChromeHidden] = useState(false)
  const tapRef = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!showSettings) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSettings(false) }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [showSettings])
  const [leftTab, setLeftTab] = useState<'toc' | 'marks'>('toc')
  const [rightTab, setRightTab] = useState<'anns' | 'backlinks'>('anns')
  const [mobilePanel, setMobilePanel] = useState<'toc' | 'anns' | null>(null)
  const restoredShown = useRef(false)
  // 读完提醒：进度第一次跨到 100% 时，若有未完成的关联任务就问一句
  const [finishAsk, setFinishAsk] = useState<Task[] | null>(null)
  const [finishPicked, setFinishPicked] = useState<Set<string>>(new Set())
  const finishAsked = useRef(false)
  const prevPct = useRef(0)

  // 载入文档内容（依赖 doc.id 原始值，避免 liveQuery 对象身份变化引发重载循环）
  const docContentId = doc?.id
  const docHash = doc?.hash
  const docKind = doc?.kind
  const flowRef = useRef<FlowDoc | null>(null)
  /** 内容载入失败（文件丢了 / 解析炸了）—— 就地给重试，不拆整页 */
  const [loadFail, setLoadFail] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  useEffect(() => {
    if (!docContentId || !docHash || !docKind) return
    let alive = true
    setContent(null)
    setLoadFail(null)
    setToc([])
    setMdHeadings([])
    flowRef.current?.dispose?.()
    flowRef.current = null
    void (async () => {
      try {
        const blob = await getDocBlob(docHash)
        if (!alive) return
        if (!blob) {
          setLoadFail('文件本体没找到，可能被系统清理了。请重新导入这份文档。')
          return
        }
        await touchDoc(docContentId)
        if (docKind === 'pdf') {
          // PDF 由 PdfReader 自行加载 Blob（避免双份 ArrayBuffer 占用内存）
          setContent({ kind: 'pdf', data: new ArrayBuffer(0) })
        } else if (FLOW_KINDS.includes(docKind)) {
          // EPUB/DOCX/PPTX/TXT：解析为流式段落
          const flow = await parseFlowDoc(docKind, blob)
          if (!alive) { flow.dispose?.(); return }
          flowRef.current = flow
          setToc(flow.segments.map((s, i) => ({ level: 0, title: s.title ?? `第 ${i + 1} 段`, page: i + 1 })))
          setContent({ kind: 'flow', data: flow })
        } else {
          const text = await blob.text()
          if (!alive) return
          setMdHeadings(parseMdBlocks(text).headings)
          setContent({ kind: 'md', md: text })
        }
      } catch (e) {
        if (!alive) return
        setContent(null)
        setLoadFail(e instanceof Error && e.message ? e.message : '这个文件解析失败，可能已损坏。')
      }
    })()
    return () => {
      alive = false
    }
  }, [docContentId, docHash, docKind, reloadTick])

  // 组件卸载时释放 flow 文档的 blob URL（EPUB 图片）
  useEffect(() => () => flowRef.current?.dispose?.(), [])

  // 排版设置按文档记忆 + 双坐标恢复：深链参数 > 深度阅读进度
  const paramP = params.get('p')
  const paramHl = params.get('hl') ?? undefined
  useEffect(() => {
    if (!docHash) return
    let alive = true
    void getPosition(docHash).then((pos) => {
      if (!alive) return
      if (pos?.settings) setSettings(pos.settings)
      if (paramP || paramHl) {
        setInitialTarget(null)
        if (paramP) setJump({ anchor: paramP, hl: paramHl, ts: Date.now() })
        else if (paramHl && pos) setJump({ anchor: pos.progress ? anchorOf(pos.progress) : 'p1', hl: paramHl, ts: Date.now() })
      } else if (pos?.progress) {
        const prog = pos.progress
        // 先把页头进度和目录高亮对齐到恢复位置；阅读器滚动事件到达前也不空白
        setProgressPct(pos.progressPct ?? 0)
        setCurrentLocator(anchorOf(prog))
        setInitialTarget(
          prog.kind === 'pdf' ? { page: prog.page, offsetRatio: prog.offsetRatio }
          : prog.kind === 'flow' ? { segIdx: prog.segIdx, ratio: prog.ratio }
          : { blockIdx: prog.blockIdx, ratio: prog.ratio },
        )
      } else {
        // 无历史进度：不恢复也不提示
        setInitialTarget(null)
      }
    })
    return () => {
      alive = false
    }
  }, [docHash, paramP, paramHl])

  /** 批注转任务（v0.7 改）：勾选内容进笔记区，标题由用户输入 */
  const [taskFrom, setTaskFrom] = useState<{ ann: Annotation; doc: Doc } | null>(null)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskNotes, setTaskNotes] = useState('')

  // 预填笔记：勾选内容 + 已有评论
  useEffect(() => {
    if (taskFrom) {
      const { ann } = taskFrom
      setTaskNotes(`批注：${ann.text}${ann.comment ? `\n评论：${ann.comment}` : ''}`)
      setTaskTitle('')
    }
  }, [taskFrom])

  const onRestored = useCallback(() => {
    if (restoredShown.current) return
    restoredShown.current = true
    toast('已回到上次阅读位置')
  }, [toast])

  // 多标签（M2.5）：打开的文档登记进标签栏
  const openTab = useDocTabs((s) => s.open)
  useEffect(() => {
    if (doc) openTab(doc.id, doc.title)
  }, [doc?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 区域截图（M2.5）：裁剪结果存为截图批注
  const onShot = useCallback(
    (shot: { page: number; rects: { x: number; y: number; w: number; h: number }[]; img: string }) => {
      if (!doc) return
      void addAnnotation({
        docHash: doc.hash,
        kind: 'shot',
        img: shot.img,
        page: shot.page,
        rects: shot.rects,
        text: '区域截图',
        color: 'blue',
      }).then(() => toast('已添加截图批注'))
    },
    [doc, toast],
  )

  const onProgress = useCallback((locator: number, pct: number) => {
    setProgressPct(pct)
    setCurrentLocator(
      doc?.kind === 'pdf' ? `p${locator}`
      : doc?.kind === 'md' ? `b${locator}`
      : `f${locator}`,
    )
    // 从「没读完」跨到 100% 才算读完；打开时本来就 100% 的不再打扰
    const finishable = backlinks.filter((t) => !isFutureTask(t))
    if (!finishAsked.current && pct >= 0.995 && prevPct.current < 0.98 && finishable.length > 0) {
      finishAsked.current = true
      setFinishPicked(new Set(finishable.map((t) => t.id)))
      setFinishAsk(finishable)
    }
    prevPct.current = pct
  }, [doc?.kind, backlinks])

  const doJump = useCallback((anchor: string, hl?: string) => {
    setJump({ anchor, hl, ts: Date.now() })
  }, [])

  const updateSettings = useCallback(
    (patch: Partial<DocSettings>) => {
      if (!doc) return
      setSettings((s) => {
        const next = { ...s, ...patch }
        void saveDocSettings(doc.hash, next)
        return next
      })
    },
    [doc],
  )

  /* ---------- 三栏布局：拖动调宽 / 折叠 ---------- */

  const panelWidth = (side: 'left' | 'right') =>
    side === 'left' ? readerPanels.leftWidth : readerPanels.rightWidth

  const applyPanelWidth = (side: 'left' | 'right', width: number) => {
    workspaceRef.current?.style.setProperty(
      side === 'left' ? '--reader-left-w' : '--reader-right-w',
      `${Math.round(width)}px`,
    )
  }

  const captureReadingAnchor = useCallback(() => {
    anchorSeq.current += 1
    const container = scrollRef.current
    if (!container) return
    const cr = container.getBoundingClientRect()
    const nodes = container.querySelectorAll<HTMLElement>('.md-body > *, section[data-seg], [data-page]')
    let hit: HTMLElement | null = null
    for (const el of nodes) {
      const r = el.getBoundingClientRect()
      if (r.bottom > cr.top + 8 && r.top < cr.bottom) { hit = el; break }
    }
    if (!hit) { readingAnchor.current = null; return }
    const r = hit.getBoundingClientRect()
    const gap = Math.max(0, r.top - cr.top)
    // 块顶在视口上方时记录「读到了块内百分之几」，PDF 页这种高块重排后不会跳行
    const ratio = gap > 0 || r.height <= 0 ? 0 : Math.min(1, (cr.top - r.top) / r.height)
    readingAnchor.current = { el: hit, ratio, gap }
  }, [scrollRef])

  const restoreReadingAnchor = useCallback(() => {
    const a = readingAnchor.current
    const container = scrollRef.current
    if (!a || !container || !a.el.isConnected) return
    const cr = container.getBoundingClientRect()
    const r = a.el.getBoundingClientRect()
    const desiredTop = a.gap > 0 ? a.gap : -a.ratio * r.height
    const delta = (r.top - cr.top) - desiredTop
    if (Math.abs(delta) > 0.5) container.scrollTop += delta
  }, [scrollRef])

  /** 折叠有 300ms 宽度过渡，PDF 页宽还会晚一帧重排；多盯一小段保持锚点 */
  const keepReadingAnchor = useCallback((duration = 420) => {
    const seq = ++anchorSeq.current
    const start = performance.now()
    const tick = () => {
      if (seq !== anchorSeq.current) return
      restoreReadingAnchor()
      if (performance.now() - start < duration) requestAnimationFrame(tick)
      else readingAnchor.current = null
    }
    requestAnimationFrame(tick)
  }, [restoreReadingAnchor])

  // 首次布局在绘制前写好变量；之后拖动只改 DOM 变量，正文不参与重渲染
  // doc?.id 必须参与：首次挂载时 doc 还没到，workspace 尚未渲染，ref 是空的
  useLayoutEffect(() => {
    applyPanelWidth('left', readerPanels.leftWidth)
    applyPanelWidth('right', readerPanels.rightWidth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerPanels.leftWidth, readerPanels.rightWidth, doc?.id])

  const clampPanel = (side: 'left' | 'right', width: number) => {
    const limits = side === 'left' ? READER_PANEL_LIMITS.left : READER_PANEL_LIMITS.right
    const ws = workspaceRef.current
    const other = side === 'left'
      ? (readerPanels.rightCollapsed ? 0 : readerPanels.rightWidth)
      : (readerPanels.leftCollapsed ? 0 : readerPanels.leftWidth)
    const available = ws ? ws.clientWidth - other - 360 : limits.max
    return Math.round(Math.min(limits.max, Math.max(limits.min, Math.min(width, available))))
  }

  const onSplitDown = (side: 'left' | 'right') => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    captureReadingAnchor()
    splitDrag.current = { side, startX: e.clientX, startW: panelWidth(side) }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 老浏览器无捕获也能拖 */ }
    workspaceRef.current?.setAttribute('data-resizing', 'true')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const onSplitMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = splitDrag.current
    if (!d) return
    const delta = e.clientX - d.startX
    const raw = d.side === 'left' ? d.startW + delta : d.startW - delta
    applyPanelWidth(d.side, clampPanel(d.side, raw))
    restoreReadingAnchor()
  }

  const onSplitEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = splitDrag.current
    if (!d) return
    splitDrag.current = null
    workspaceRef.current?.removeAttribute('data-resizing')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 未捕获时忽略 */ }
    const varName = d.side === 'left' ? '--reader-left-w' : '--reader-right-w'
    const width = Number.parseFloat(workspaceRef.current?.style.getPropertyValue(varName) ?? '')
    if (Number.isFinite(width)) {
      setReaderPanels(d.side === 'left' ? { leftWidth: width } : { rightWidth: width })
    }
    // PDF 页宽由子组件异步量完后重排，多盯一段把锚点压住
    keepReadingAnchor(320)
  }

  const onSplitKey = (side: 'left' | 'right') => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = e.shiftKey ? 32 : 16
    const dir = e.key === 'ArrowRight' ? 1 : -1
    const grow = side === 'left' ? dir : -dir
    const next = clampPanel(side, panelWidth(side) + grow * step)
    captureReadingAnchor()
    applyPanelWidth(side, next)
    setReaderPanels(side === 'left' ? { leftWidth: next } : { rightWidth: next })
    keepReadingAnchor(320)
  }

  const toggleReaderPanel = (side: 'left' | 'right') => {
    captureReadingAnchor()
    setReaderPanels(side === 'left'
      ? { leftCollapsed: !readerPanels.leftCollapsed }
      : { rightCollapsed: !readerPanels.rightCollapsed })
    keepReadingAnchor()
  }

  const resetReaderLayout = () => {
    captureReadingAnchor()
    setReaderPanels(DEFAULT_READER_PANELS)
    keepReadingAnchor()
  }

  const resetPanelWidth = (side: 'left' | 'right') => {
    const width = side === 'left' ? DEFAULT_READER_PANELS.leftWidth : DEFAULT_READER_PANELS.rightWidth
    captureReadingAnchor()
    applyPanelWidth(side, width)
    setReaderPanels(side === 'left' ? { leftWidth: width } : { rightWidth: width })
    keepReadingAnchor(320)
  }

  const createAnnotation = useCallback(
    async (color: (typeof COLORS)[number], withTask = false) => {
      if (!doc || !selection) return
      const base = doc.kind === 'pdf'
        ? { docHash: doc.hash, page: (selection as Extract<Selection, { kind: 'pdf' }>).page, rects: (selection as Extract<Selection, { kind: 'pdf' }>).rects, text: selection.text, color }
        : doc.kind === 'md'
          ? { docHash: doc.hash, blockIdx: (selection as Extract<Selection, { kind: 'md' }>).blockIdx, text: selection.text, color }
          : { docHash: doc.hash, blockIdx: (selection as Extract<Selection, { kind: 'flow' }>).segIdx, text: selection.text, color }
      const ann = await addAnnotation(base)
      if (withTask) {
        setTaskFrom({ ann, doc })
      } else {
        toast('已添加高亮')
      }
      setSelection(null)
      window.getSelection()?.removeAllRanges()
    },
    [doc, selection, toast, navigate],
  )

  const exportAnnotations = useCallback(() => {
    if (!doc) return
    void exportAnnotationsToDoc(doc).then((id) => {
      toast('批注笔记已生成')
      navigate(`/docs/${id}`)
    })
  }, [doc, navigate, toast])

  const addCurrentBookmark = useCallback(async () => {
    if (!doc) return
    const unitLabel = doc.kind === 'pdf'
      ? `第 ${currentLocator.replace('p', '') || 1} 页`
      : doc.kind === 'md'
        ? `第 ${Number(currentLocator.replace('b', '0')) + 1} 段`
        : `第 ${Number(currentLocator.replace('f', '0')) + 1} ${doc.kind === 'pptx' ? '片' : doc.kind === 'epub' ? '章' : '节'}`
    const anchor = currentLocator || (doc.kind === 'pdf' ? 'p1' : doc.kind === 'md' ? 'b0' : 'f0')
    await addBookmark(doc.hash, unitLabel, anchor, await quoteAtLocator(doc, anchor))
    toast('已添加书签')
  }, [doc, currentLocator, toast])

  if (!doc) {
    return (
      <div className="h-full grid place-items-center text-center px-6">
        <div>
          <p className="text-[15px] font-semibold mb-1.5">{docId ? '文档不存在或已删除' : '加载中…'}</p>
          {docId && (
            <button onClick={() => { window.location.hash = '#/docs' }} className="text-[13px] text-primary hover:underline cursor-pointer">
              返回文档库
            </button>
          )}
        </div>
      </div>
    )
  }

  const pct = Math.round(progressPct * 100)

  return (
    // 共享元素转场的「详情侧」：根容器常挂转场名，打开时与文档卡片插值生长、
    // 返回时再「长回」卡片。不支持时该属性无副作用。
    <div
      className="h-full flex flex-col bg-surface"
      style={{
        viewTransitionName: MORPH_NAME,
        // 安卓全面屏：状态栏/挖孔/横屏摄像头要占掉真实空间，不能再让正文顶到屏幕边缘
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      {/* 顶栏：手机上轻点正文可收起，把 56px 真正还给正文（再点一下回来）。
          用高度过渡而不是 translateY —— transform 不回收布局空间，收起来也白收 */}
      <header
        className={cn(
          'glass relative z-30 shrink-0 flex items-center gap-1 sm:gap-2 px-2.5 md:px-4 border-b border-outline/70 overflow-hidden',
          'transition-[height,opacity] duration-300 ease-standard',
          chromeHidden ? 'h-0 opacity-0 border-transparent pointer-events-none' : 'h-14 opacity-100',
        )}
      >
        <button
          onClick={() => morphClose(() => document.getElementById(`doc-${doc.id}`), () => navigate('/docs'))}
          aria-label="返回文档库"
          className="grid place-items-center shrink-0 w-9 h-9 md:w-10 md:h-10 rounded-[10px] md:rounded-[12px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors"
        >
          <ArrowLeft size={19} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold truncate leading-tight">{doc.title}</p>
          <p className="text-[11px] text-on-surface-2 leading-tight truncate">
            {doc.kind === 'pdf'
              ? (numPages ? `PDF · ${numPages} 页` : 'PDF')
              : doc.kind === 'pptx'
                ? (numPages ? `PPT · ${numPages} 片` : 'PPT')
                : doc.kind === 'epub'
                  ? (numPages ? `EPUB · ${numPages} 章` : 'EPUB')
                  : DOC_KIND_LABEL[doc.kind]}
            {progressPct > 0 && ` · 已读 ${pct}%`}
          </p>
        </div>

        {/* 手机上低频文档动作收进「更多」，把标题从 7 个图标里解放出来 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="更多文档操作"
              title="更多"
              className="sm:hidden grid place-items-center shrink-0 w-9 h-9 rounded-[10px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer"
            >
              <MoreHorizontal size={18} />
            </button>
          </DropdownMenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => void addCurrentBookmark()}>
              <BookmarkPlus size={15} /> 添加书签
            </MenuItem>
            {doc.kind === 'md' && (
              <MenuItem onSelect={() => navigate(`/docs/edit/${doc.id}`)}>
                <PenLine size={15} /> 继续写作
              </MenuItem>
            )}
            {doc.kind === 'pdf' && (
              <MenuItem active={shotMode} onSelect={() => setShotMode((v) => !v)}>
                <Crop size={15} /> {shotMode ? '退出截图模式' : '区域截图批注'}
              </MenuItem>
            )}
            {annotations.length > 0 && (
              <>
                <MenuSeparator />
                <MenuItem onSelect={exportAnnotations}>
                  <BookDown size={15} /> 导出批注为笔记
                </MenuItem>
              </>
            )}
          </MenuContent>
        </DropdownMenu>

        <IconBtn label="添加书签" className="hidden sm:grid" onClick={() => void addCurrentBookmark()}><BookmarkPlus size={18} /></IconBtn>
        {doc.kind === 'md' && (
          <IconBtn label="继续写作" className="hidden sm:grid" onClick={() => navigate(`/docs/edit/${doc.id}`)}>
            <PenLine size={18} />
          </IconBtn>
        )}
        {doc.kind === 'pdf' && (
          <IconBtn label={shotMode ? '退出截图模式' : '区域截图批注（拖拽框选）'} className="hidden sm:grid" active={shotMode} onClick={() => setShotMode((v) => !v)}>
            <Crop size={18} />
          </IconBtn>
        )}
        {annotations.length > 0 && (
          <IconBtn label="导出批注为笔记" className="hidden sm:grid" onClick={exportAnnotations}>
            <BookDown size={18} />
          </IconBtn>
        )}

        {/* 排版设置（弹层） */}
        <div className="relative">
          <IconBtn label="排版设置" active={showSettings} onClick={() => setShowSettings((v) => !v)}><Settings2 size={18} /></IconBtn>
          {showSettings && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowSettings(false)} />
              <div
                className="pop z-50 w-[260px] p-4 flex flex-col gap-3.5 fixed"
                style={{ right: 12, top: 'calc(env(safe-area-inset-top, 0px) + 60px)' }}
              >
                <div>
                  <p className="text-[12px] font-medium text-on-surface-2 mb-1.5">阅读主题</p>
                  <Segmented
                    size="sm"
                    value={settings.theme}
                    onChange={(v) => updateSettings({ theme: v as DocSettings['theme'] })}
                    options={[
                      { value: 'day', label: '日间' },
                      { value: 'night', label: '夜间' },
                      { value: 'sepia', label: '羊皮纸' },
                      { value: 'dusk', label: '暮色' },
                    ]}
                  />
                </div>
                {doc.kind === 'pdf' ? (
                  <Stepper
                    label="缩放"
                    value={`${Math.round((settings.zoom ?? 1) * 100)}%`}
                    onMinus={() => updateSettings({ zoom: Math.max(0.5, Math.round(((settings.zoom ?? 1) - 0.1) * 10) / 10) })}
                    onPlus={() => updateSettings({ zoom: Math.min(3, Math.round(((settings.zoom ?? 1) + 0.1) * 10) / 10) })}
                  />
                ) : (
                  <>
                    <Stepper label="字号" value={`${settings.fontSize}px`} onMinus={() => updateSettings({ fontSize: Math.max(14, settings.fontSize - 1) })} onPlus={() => updateSettings({ fontSize: Math.min(32, settings.fontSize + 1) })} />
                    <Stepper label="行距" value={settings.leading.toFixed(2)} onMinus={() => updateSettings({ leading: Math.max(1.6, Math.round((settings.leading - 0.1) * 10) / 10) })} onPlus={() => updateSettings({ leading: Math.min(2.2, Math.round((settings.leading + 0.1) * 10) / 10) })} />
                  </>
                )}
                <div>
                  <p className="text-[12px] font-medium text-on-surface-2 mb-1.5 flex items-center justify-between">
                    <span>正文宽度</span>
                    <span className="text-on-surface tabular-nums">{settings.widthPct}%</span>
                  </p>
                  <input
                    type="range"
                    min={50}
                    max={100}
                    step={2}
                    value={settings.widthPct}
                    onChange={(e) => updateSettings({ widthPct: Number(e.target.value) })}
                    aria-label="正文宽度"
                    className="w-full h-5 cursor-pointer accent-[var(--primary)]"
                  />
                  <div className="flex justify-between text-[10.5px] text-on-surface-2 mt-0.5">
                    <span>窄</span><span>宽</span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-on-surface-2">排版按文档记忆，栏宽按设备记忆</p>
                  <button
                    type="button"
                    onClick={resetReaderLayout}
                    className="shrink-0 text-[11px] font-medium text-primary hover:underline cursor-pointer"
                  >
                    重置布局
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <span className="hidden md:block w-px h-5 bg-outline/80 mx-0.5" aria-hidden />
        <IconBtn
          label={readerPanels.leftCollapsed ? '展开目录栏' : '收起目录栏'}
          active={!readerPanels.leftCollapsed}
          className="hidden md:grid"
          onClick={() => toggleReaderPanel('left')}
        >
          <PanelLeft size={18} />
        </IconBtn>
        <IconBtn
          label={readerPanels.rightCollapsed ? '展开批注栏' : '收起批注栏'}
          active={!readerPanels.rightCollapsed}
          className="hidden lg:grid"
          onClick={() => toggleReaderPanel('right')}
        >
          <PanelRight size={18} />
        </IconBtn>
        <IconBtn label="目录与高亮" className="md:hidden" active={mobilePanel === 'toc'} onClick={() => setMobilePanel('toc')}><List size={18} /></IconBtn>
        <IconBtn label="批注与反链" className="lg:hidden" active={mobilePanel === 'anns'} onClick={() => setMobilePanel('anns')}><MessageSquareText size={18} /></IconBtn>
      </header>

      {/* 多标签栏（M2.5）：打开过多个文档时显示 */}
      <TabBar docId={docId} onJump={(id) => navigate(`/docs/${id}`)} />

      {/* 三栏工作区 */}
      <div
        ref={workspaceRef}
        className="reader-workspace flex-1 flex min-h-0"
        onPointerDown={(e) => { tapRef.current = { x: e.clientX, y: e.clientY } }}
        onPointerUp={(e) => {
          // 只在手机上做「轻点切换工具栏」：桌面空间够，别和双击选词较劲
          if (window.matchMedia('(min-width: 768px)').matches) return
          const start = tapRef.current
          tapRef.current = null
          if (!start) return
          // 手指挪过（滚动 / 双指缩放 / 拖拽框选）就不算轻点
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) return
          // 有选中文本（划词高亮）时不抢事件
          if (window.getSelection()?.toString()) return
          const el = e.target as HTMLElement
          if (el.closest('button,a,input,textarea,select,[role="button"],[contenteditable="true"]')) return
          setChromeHidden((v) => !v)
        }}
      >
        {/* 左：目录 + 高亮 */}
        <aside
          aria-hidden={readerPanels.leftCollapsed}
          className={cn(
            'reader-panel hidden md:flex flex-col shrink-0 min-h-0 overflow-hidden bg-surface-2/40',
            readerPanels.leftCollapsed && 'invisible opacity-0 pointer-events-none',
          )}
          style={{ width: readerPanels.leftCollapsed ? 0 : 'var(--reader-left-w)' }}
        >
          <PanelHead
            value={leftTab}
            onChange={setLeftTab}
            tabs={[
              { value: 'toc', label: '目录' },
              { value: 'marks', label: '高亮', count: annotations.length },
            ]}
            collapse={{ side: 'left', onCollapse: () => toggleReaderPanel('left') }}
          />
          <TocContent
            doc={doc}
            toc={toc}
            mdHeadings={mdHeadings}
            annotations={annotations}
            leftTab={leftTab}
            currentLocator={currentLocator}
            onJump={doJump}
            onDeleteBookmark={(id) => void deleteBookmark(id)}
          />
        </aside>
        {!readerPanels.leftCollapsed && (
          <PanelSplitter
            side="left"
            label="目录栏宽度"
            width={readerPanels.leftWidth}
            min={READER_PANEL_LIMITS.left.min}
            max={READER_PANEL_LIMITS.left.max}
            onPointerDown={onSplitDown('left')}
            onPointerMove={onSplitMove}
            onPointerUp={onSplitEnd}
            onPointerCancel={onSplitEnd}
            onLostPointerCapture={onSplitEnd}
            onDoubleClick={() => resetPanelWidth('left')}
            onKeyDown={onSplitKey('left')}
          />
        )}

        {/* 中：阅读画布（高度由上面的确定链给，min-h-0 让 flex 子项可以收缩，滚动落在阅读器自己身上） */}
        <div className="flex-1 min-w-0 relative min-h-0 bg-surface">
          {/* 细进度线：只在正文上下文中出现，不占阅读空间 */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[2px]" aria-hidden>
            <div
              className="h-full origin-left bg-primary/70 transition-transform duration-200 ease-out"
              style={{ transform: `scaleX(${progressPct})`, opacity: progressPct > 0.002 ? 1 : 0 }}
            />
          </div>
          {content?.kind === 'md' && (
            <MdReader
              hash={doc.hash}
              md={content.md}
              settings={settings}
              annotations={annotations}
              jump={jump}
              onSelection={(sel) => setSelection(sel ? { kind: 'md', ...sel } : null)}
              onProgress={(idx, pct2) => onProgress(idx, pct2)}
              onRestored={onRestored}
              scrollRef={scrollRef}
              initialTarget={(initialTarget as { blockIdx: number; ratio: number } | null)?.blockIdx != null ? (initialTarget as { blockIdx: number; ratio: number }) : null}
              onFontSizeChange={(px) => updateSettings({ fontSize: px })}
            />
          )}
          {content?.kind === 'pdf' && (
            <PdfReader
              hash={doc.hash}
              settings={settings}
              annotations={annotations}
              jump={jump}
              onSelection={(sel) => setSelection(sel ? { kind: 'pdf', ...sel } : null)}
              shotMode={shotMode}
              onShot={onShot}
              onProgress={(page, pct2) => onProgress(page, pct2)}
              onRestored={onRestored}
              onLoaded={(n, outline) => {
                setNumPages(n)
                setToc(outline)
              }}
              scrollRef={scrollRef}
              initialTarget={(initialTarget as { page: number; offsetRatio: number } | null)?.page != null ? (initialTarget as { page: number; offsetRatio: number }) : null}
              onZoom={(z) => updateSettings({ zoom: z })}
            />
          )}
          {content?.kind === 'flow' && (
            <FlowReader
              hash={doc.hash}
              flow={content.data}
              settings={settings}
              annotations={annotations}
              jump={jump}
              onSelection={(sel) => setSelection(sel ? { kind: 'flow', ...sel } : null)}
              onProgress={(seg, pct2) => onProgress(seg, pct2)}
              onRestored={onRestored}
              onLoaded={(n) => setNumPages(n)}
              scrollRef={scrollRef}
              initialTarget={(initialTarget as { segIdx: number; ratio: number } | null)?.segIdx != null ? (initialTarget as { segIdx: number; ratio: number }) : null}
              onFontSizeChange={(px) => updateSettings({ fontSize: px })}
            />
          )}
          {!content && loadFail && (
            <div className="flex-1 grid place-items-center px-6">
              <div className="max-w-sm text-center">
                <p className="text-[15px] font-semibold">这份文档没能打开</p>
                <p className="text-[13px] text-on-surface-2 mt-1.5 leading-relaxed">{loadFail}</p>
                <div className="flex items-center justify-center gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => setReloadTick((n) => n + 1)}
                    className="h-9 px-4 rounded-[10px] bg-primary text-on-primary text-[13px] font-medium cursor-pointer"
                  >
                    重试
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/docs')}
                    className="h-9 px-4 rounded-[10px] border border-outline text-[13px] text-on-surface-2 hover:text-on-surface cursor-pointer"
                  >
                    返回文档库
                  </button>
                </div>
              </div>
            </div>
          )}
          {!content && !loadFail && (
            // 骨架屏按「正文块」的形状铺，比一句「正在载入文档…」更像内容马上就到
            <div className="mx-auto w-full max-w-[720px] px-6 py-8 flex flex-col gap-3">
              <Skeleton className="h-6 w-2/3" />
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className={i % 4 === 3 ? 'h-3 w-2/3' : 'h-3'} />
              ))}
            </div>
          )}

          {/* 划词浮条（选区近顶部时自动翻转到下方，避免被裁切/遮挡） */}
          {selection && (
            <div
              className="sel-popover"
              style={{
                left: Math.min(Math.max(selection.popover.left, 104), window.innerWidth - 104),
                top: Math.max(selection.popover.y, 8),
                transform: selection.popover.below ? 'translate(-50%, 10px)' : 'translate(-50%, -100%)',
              }}
            >
              {COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={`高亮-${c}`}
                  onClick={() => void createAnnotation(c)}
                  className={`w-7 h-7 rounded-full hl-${c} border border-outline/60 hover:scale-110 transition-transform cursor-pointer`}
                />
              ))}
              <span className="w-px h-5 bg-outline mx-1" />
              <button
                aria-label="复制选中文本"
                className="grid place-items-center w-7 h-7 rounded-lg text-on-surface-2 hover:bg-surface-3"
                onClick={() => {
                  void navigator.clipboard.writeText(selection.text)
                  toast('已复制')
                }}
              >
                <Copy size={15} />
              </button>
              <button
                aria-label="高亮并转为任务"
                title="高亮并转为任务"
                className="grid place-items-center w-7 h-7 rounded-lg text-primary hover:bg-primary-soft"
                onClick={() => void createAnnotation('yellow', true)}
              >
                <ListPlus size={15} />
              </button>
            </div>
          )}
        </div>

        {/* 右：批注 + 反链（lg+ 常驻） */}
        {!readerPanels.rightCollapsed && (
          <PanelSplitter
            side="right"
            label="批注栏宽度"
            width={readerPanels.rightWidth}
            min={READER_PANEL_LIMITS.right.min}
            max={READER_PANEL_LIMITS.right.max}
            onPointerDown={onSplitDown('right')}
            onPointerMove={onSplitMove}
            onPointerUp={onSplitEnd}
            onPointerCancel={onSplitEnd}
            onLostPointerCapture={onSplitEnd}
            onDoubleClick={() => resetPanelWidth('right')}
            onKeyDown={onSplitKey('right')}
          />
        )}
        <aside
          aria-hidden={readerPanels.rightCollapsed}
          className={cn(
            'reader-panel hidden lg:flex flex-col shrink-0 min-h-0 overflow-hidden bg-surface-2/40',
            readerPanels.rightCollapsed && 'invisible opacity-0 pointer-events-none',
          )}
          style={{ width: readerPanels.rightCollapsed ? 0 : 'var(--reader-right-w)' }}
        >
          <PanelHead
            value={rightTab}
            onChange={setRightTab}
            tabs={[
              { value: 'anns', label: '批注', count: annotations.length },
              { value: 'backlinks', label: '反链', count: backlinks.length },
            ]}
            collapse={{ side: 'right', onCollapse: () => toggleReaderPanel('right') }}
          />
          <RightContent
            annotations={annotations}
            backlinks={backlinks}
            rightTab={rightTab}
            onJump={(a) => doJump(a)}
            onToTask={(ann) => setTaskFrom({ ann, doc })}
            onDelete={(id) => void deleteAnnotation(id)}
            onRecolor={(id, color) => void updateAnnotation(id, { color })}
            onComment={(id, comment) => void updateAnnotation(id, { comment })}
            docId={docId}
            anchorFor={(a) => annotationAnchor(doc, a)}
          />
        </aside>
      </div>

      {/* 批注 → 任务弹窗：勾选内容进笔记区，标题自己输入 */}
      <Dialog
        open={taskFrom != null}
        onOpenChange={(v) => !v && setTaskFrom(null)}
        title="从批注创建任务"
        description="勾选内容已放入任务笔记；任务标题自己起。"
      >
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="block text-[12px] font-medium text-on-surface-2 mb-1">任务标题</span>
            <input
              autoFocus
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="输入任务标题…"
              className="w-full h-10 px-3 rounded-[10px] bg-surface-2 border border-outline text-[14px] outline-none focus:border-primary/60"
            />
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-on-surface-2 mb-1">笔记内容（已预填勾选内容，可改）</span>
            <textarea
              value={taskNotes}
              onChange={(e) => setTaskNotes(e.target.value)}
              rows={4}
              className="w-full rounded-[10px] bg-surface-2 border border-outline px-3 py-2 text-[13px] outline-none focus:border-primary/60 resize-none leading-relaxed"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setTaskFrom(null)}>取消</Button>
            <Button
              variant="primary"
              disabled={!taskTitle.trim()}
              onClick={() => {
                if (!taskFrom) return
                const { ann, doc: d } = taskFrom
                const anchor = ann.page != null ? `p${ann.page}` : `b${ann.blockIdx ?? 0}`
                void import('@/db/tasks').then(async ({ addTask }) => {
                  const t = await addTask({
                    title: taskTitle.trim(),
                    tier: 'anytime',
                    tags: ['批注'],
                    notes: taskNotes.trim() || undefined,
                  })
                  await db.tasks.update(t.id, { docRef: { docId: d.id, anchor: `${anchor}#${ann.id}`, label: d.title } })
                  toast('任务已创建')
                  setTaskFrom(null)
                  setTaskTitle('')
                })
              }}
            >
              创建任务
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 读完提醒：把引用本文档的任务收尾 */}
      <Dialog
        open={finishAsk != null}
        onOpenChange={(v) => !v && setFinishAsk(null)}
        title="这篇读完了"
        description="下面这些任务引用了本文档，要顺手标记完成吗？"
      >
        <div className="flex flex-col gap-1.5 max-h-[45dvh] overflow-y-auto">
          {finishAsk?.map((t) => {
            const checked = finishPicked.has(t.id)
            return (
              <label
                key={t.id}
                className="flex items-center gap-2.5 min-h-10 px-3 rounded-[10px] bg-surface-2 hover:bg-surface-3 transition-colors cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    setFinishPicked((prev) => {
                      const next = new Set(prev)
                      if (next.has(t.id)) next.delete(t.id)
                      else next.add(t.id)
                      return next
                    })
                  }}
                  className="w-4 h-4 shrink-0 accent-[var(--primary)]"
                />
                <span className="text-[13px] leading-snug">{t.title}</span>
              </label>
            )
          })}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={() => setFinishAsk(null)}>稍后</Button>
          <Button
            variant="primary"
            disabled={finishPicked.size === 0}
            onClick={() => {
              const picked = (finishAsk ?? []).filter((t) => finishPicked.has(t.id))
              setFinishAsk(null)
              void Promise.all(picked.map((t) => toggleDone(t))).then(() => {
                toast(`已完成 ${picked.length} 个任务`)
              })
            }}
          >
            完成所选
          </Button>
        </div>
      </Dialog>

      {/* 移动端抽屉 */}
      <Sheet open={mobilePanel === 'toc'} onOpenChange={(v) => !v && setMobilePanel(null)} title="目录与高亮">
        <PanelHead
          value={leftTab}
          onChange={setLeftTab}
          tabs={[
            { value: 'toc', label: '目录' },
            { value: 'marks', label: '高亮', count: annotations.length },
          ]}
          className="border-b-0 px-0"
        />
        <TocContent
          doc={doc}
          toc={toc}
          mdHeadings={mdHeadings}
          annotations={annotations}
          leftTab={leftTab}
          currentLocator={currentLocator}
          onJump={(a, hl) => {
            doJump(a, hl)
            setMobilePanel(null)
          }}
          onDeleteBookmark={(id) => void deleteBookmark(id)}
        />
      </Sheet>
      <Sheet open={mobilePanel === 'anns'} onOpenChange={(v) => !v && setMobilePanel(null)} title="批注与反链">
        <PanelHead
          value={rightTab}
          onChange={setRightTab}
          tabs={[
            { value: 'anns', label: '批注', count: annotations.length },
            { value: 'backlinks', label: '反链', count: backlinks.length },
          ]}
          className="border-b-0 px-0"
        />
        <RightContent
          annotations={annotations}
          backlinks={backlinks}
          rightTab={rightTab}
          onJump={(a, hl) => {
            doJump(a, hl)
            setMobilePanel(null)
          }}
          onToTask={(ann) => setTaskFrom({ ann, doc })}
          onDelete={(id) => void deleteAnnotation(id)}
          onRecolor={(id, color) => void updateAnnotation(id, { color })}
          onComment={(id, comment) => void updateAnnotation(id, { comment })}
          docId={docId}
          anchorFor={(a) => annotationAnchor(doc, a)}
        />
      </Sheet>
    </div>
  )
}

/* ---------- 小组件 ---------- */

/** 多标签栏：关一个自动切邻居；仅剩一个时不显示 */
function TabBar({ docId, onJump }: { docId?: string; onJump: (id: string) => void }) {
  const tabs = useDocTabs((s) => s.tabs)
  const closeTab = useDocTabs((s) => s.close)
  if (tabs.length < 2) return null
  return (
    <div className="shrink-0 flex items-stretch gap-1 px-2 pt-1.5 overflow-x-auto border-b border-outline/60 bg-surface">
      {tabs.map((t) => {
        const active = t.id === docId
        return (
          <div
            key={t.id}
            className={cn(
              'group flex items-center gap-1.5 pl-3 pr-1.5 h-9 rounded-t-[10px] cursor-pointer select-none shrink-0 max-w-[180px] transition-colors',
              active ? 'bg-surface-2 text-on-surface' : 'text-on-surface-2 hover:bg-surface-3/70',
            )}
            onClick={() => onJump(t.id)}
          >
            <span className={cn('text-[12px] truncate', active && 'font-medium')}>{t.title}</span>
            <button
              aria-label={`关闭标签 ${t.title}`}
              onClick={(e) => {
                e.stopPropagation()
                const neighbor = closeTab(t.id)
                if (t.id === docId) {
                  if (neighbor) onJump(neighbor)
                  else window.location.hash = '#/docs'
                }
              }}
              className="grid place-items-center w-5 h-5 rounded-md opacity-40 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger cursor-pointer"
            >
              <X size={11} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function IconBtn({
  children, label, onClick, className = '', active = false,
}: {
  children: React.ReactNode
  label: string
  onClick?: () => void
  className?: string
  active?: boolean
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid place-items-center shrink-0 w-9 h-9 md:w-10 md:h-10 rounded-[10px] md:rounded-[12px] transition-colors cursor-pointer ${active ? 'bg-primary-soft text-primary' : 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface'} ${className}`}
    >
      {children}
    </button>
  )
}

type PanelTabOption<V extends string> = { value: V; label: string; count?: number }

/** 侧栏页签：轻量胶囊 + 计数，右侧留折叠按钮（抽屉里不传 collapse） */
function PanelHead<V extends string>({
  value, onChange, tabs, collapse, className,
}: {
  value: V
  onChange: (v: V) => void
  tabs: PanelTabOption<V>[]
  collapse?: { side: 'left' | 'right'; onCollapse: () => void }
  className?: string
}) {
  const CollapseIcon = collapse?.side === 'left' ? ChevronLeft : ChevronRight
  return (
    <div className={cn('shrink-0 flex items-center gap-1 h-11 px-2.5 border-b border-outline/60', className)}>
      <div role="tablist" aria-label="面板切换" className="flex items-center gap-0.5 min-w-0">
        {tabs.map((t) => {
          const active = t.value === value
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.value)}
              className={cn(
                'h-7 px-2.5 rounded-[8px] text-[12.5px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer',
                active
                  ? 'bg-surface text-on-surface shadow-[0_1px_2px_rgba(32,31,29,0.07)]'
                  : 'text-on-surface-2 hover:text-on-surface hover:bg-surface-3/60',
              )}
            >
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className={cn(
                  'min-w-[16px] h-4 px-1 rounded-full grid place-items-center text-[10px] leading-none tabular-nums',
                  active ? 'bg-primary-soft text-primary' : 'bg-surface-3 text-on-surface-2',
                )}>
                  {t.count}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {collapse && (
        <button
          type="button"
          aria-label={collapse.side === 'left' ? '收起目录栏' : '收起批注栏'}
          title="收起侧栏"
          onClick={collapse.onCollapse}
          className="ml-auto shrink-0 grid place-items-center w-7 h-7 rounded-[8px] text-on-surface-2 hover:text-on-surface hover:bg-surface-3/70 transition-colors cursor-pointer"
        >
          <CollapseIcon size={15} />
        </button>
      )}
    </div>
  )
}

/** 可拖拽分隔线：命中区 ±4px，双击复位；键盘 ←/→ 按 16px 步进（Shift 32px） */
function PanelSplitter({
  side, width, min, max, label, ...rest
}: React.ComponentProps<'div'> & {
  side: 'left' | 'right'
  width: number
  min: number
  max: number
  label: string
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="拖动调节宽度，双击恢复默认"
      className={cn('reader-splitter', side === 'left' ? 'hidden md:block' : 'hidden lg:block')}
      {...rest}
    />
  )
}

function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] font-medium text-on-surface-2">{label}</span>
      <div className="flex items-center gap-2">
        <button className="w-7 h-7 rounded-lg bg-surface-3 text-on-surface-2 hover:text-on-surface cursor-pointer" onClick={onMinus}>−</button>
        <span className="text-[13px] font-medium w-12 text-center">{value}</span>
        <button className="w-7 h-7 rounded-lg bg-surface-3 text-on-surface-2 hover:text-on-surface cursor-pointer" onClick={onPlus}>+</button>
      </div>
    </div>
  )
}

function anchorOf(progress: NonNullable<ReadingPosition['progress']>): string {
  if (progress.kind === 'pdf') return `p${progress.page}`
  if (progress.kind === 'flow') return `f${progress.segIdx}`
  return `b${progress.blockIdx}`
}

/** 批注定位锚点：pdf=p 页码；md=b 块号；flow(epub/docx/pptx/txt)=f 章节号（blockIdx 存 segIdx） */
function annotationAnchor(doc: Doc, a: Annotation): string {
  if (doc.kind === 'pdf') return `p${a.page}`
  if (FLOW_KINDS.includes(doc.kind)) return `f${a.blockIdx}`
  return `b${a.blockIdx}`
}

/* ---------- 左栏内容 ---------- */

const FLOW_UNIT: Partial<Record<Doc['kind'], string>> = { epub: '章', pptx: '片', docx: '节', txt: '节' }

function annotationColorClass(a: Annotation): string {
  if (a.kind === 'shot') return 'bg-primary'
  return a.color === 'yellow' ? 'bg-yellow-400' : a.color === 'green' ? 'bg-green-400' : a.color === 'blue' ? 'bg-blue-400' : 'bg-red-400'
}

function highlightLocator(doc: Doc, a: Annotation): string {
  if (doc.kind === 'pdf') return `第 ${a.page ?? 1} 页`
  if (FLOW_KINDS.includes(doc.kind)) return `第 ${(a.blockIdx ?? 0) + 1} ${FLOW_UNIT[doc.kind] ?? '节'}`
  return ''
}

function TocContent({
  doc, toc, mdHeadings, annotations, leftTab, currentLocator, onJump, onDeleteBookmark,
}: {
  doc: Doc
  toc: TocItem[]
  mdHeadings: { level: number; text: string; blockIdx: number }[]
  annotations: Annotation[]
  leftTab: 'toc' | 'marks'
  currentLocator: string
  onJump: (anchor: string, hl?: string) => void
  onDeleteBookmark: (id: string) => void
}) {
  const marks = useLiveQueryBookmarks(doc.hash)
  const currentNum = currentLocator ? Number(currentLocator.slice(1)) : NaN

  // 当前章节 = 最后一个「已经到达」的目录项；还没滚动过时默认第一章，避免目录全灰
  const activeIndex = useMemo(() => {
    if (leftTab !== 'toc' || toc.length === 0) return -1
    if (!Number.isFinite(currentNum)) return 0
    let idx = 0
    for (let i = 0; i < toc.length; i++) {
      if (doc.kind === 'pdf' ? toc[i].page <= currentNum : toc[i].page - 1 <= currentNum) idx = i
    }
    return idx
  }, [leftTab, doc.kind, toc, currentNum])

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-4 min-h-0">
      {leftTab === 'toc' ? (
        doc.kind === 'pdf' ? (
          toc.length > 0 ? (
            <TocList
              items={toc}
              activeIndex={activeIndex}
              anchor={(item) => `p${item.page}`}
              badge={(item) => String(item.page)}
              onJump={onJump}
            />
          ) : (
            <PanelEmpty icon={List} title="没有书签大纲" hint="这份 PDF 没有内置目录，可以用书签记位置。" />
          )
        ) : FLOW_KINDS.includes(doc.kind) ? (
          toc.length > 1 ? (
            <TocList
              items={toc}
              activeIndex={activeIndex}
              anchor={(item) => `f${item.page - 1}`}
              badge={(item) => String(item.page)}
              onJump={onJump}
            />
          ) : (
            <PanelEmpty icon={List} title="没有章节结构" hint="这份文档没有可解析的章节，直接滚动阅读即可。" />
          )
        ) : (
          <MdToc
            headings={mdHeadings}
            currentBlock={currentLocator.startsWith('b') ? Number(currentLocator.slice(1)) : null}
            onJump={onJump}
          />
        )
      ) : annotations.length === 0 ? (
        <PanelEmpty icon={Highlighter} title="还没有高亮" hint="划选正文，点浮条上的颜色即可高亮。" />
      ) : (
        <ul className="py-1.5">
          {annotations.map((a) => {
            const locator = highlightLocator(doc, a)
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onJump(annotationAnchor(doc, a), a.id)}
                  className="relative w-full text-left rounded-[9px] pl-3 pr-2 py-2 hover:bg-surface-3/60 transition-colors cursor-pointer flex gap-2"
                >
                  <span className={cn('absolute left-0.5 top-2 bottom-2 w-[2.5px] rounded-full', annotationColorClass(a))} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] leading-[1.55] line-clamp-3">{a.text}</span>
                    {(locator || a.comment) && (
                      <span className="mt-1 flex items-center gap-1.5 text-[10.5px] text-on-surface-2">
                        {locator && <span className="tabular-nums">{locator}</span>}
                        {a.comment && <MessageSquareText size={10} className="shrink-0" />}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {marks.length > 0 && (
        <BookmarkList marks={marks} onJump={onJump} onDelete={onDeleteBookmark} />
      )}
    </div>
  )
}

/** PDF / 流式文档目录共用：当前章节着色 + 自动滚入视野 */
function TocList({
  items, activeIndex, anchor, badge, onJump,
}: {
  items: TocItem[]
  activeIndex: number
  anchor: (item: TocItem) => string
  badge: (item: TocItem) => string
  onJump: (anchor: string) => void
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (activeIndex >= 0) activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return (
    <nav className="py-1.5" aria-label="文档目录">
      {items.map((item, i) => {
        const active = i === activeIndex
        return (
          <button
            key={`${item.page}-${i}`}
            ref={active ? activeRef : undefined}
            type="button"
            onClick={() => onJump(anchor(item))}
            className={cn(
              'group w-full flex items-start gap-2 text-left rounded-[9px] py-[7px] pr-2 transition-colors cursor-pointer',
              active ? 'bg-primary-soft/70 text-on-surface' : 'text-on-surface-2 hover:bg-surface-3/60 hover:text-on-surface',
            )}
            style={{ paddingLeft: 10 + Math.min(item.level, 4) * 12 }}
          >
            <span className={cn('shrink-0 mt-[6px] w-1.5 h-1.5 rounded-full transition-colors', active ? 'bg-primary' : 'bg-outline group-hover:bg-on-surface-2/50')} />
            <span className={cn('flex-1 min-w-0 text-[12.5px] leading-[1.55] line-clamp-2', active && 'font-medium')}>{item.title}</span>
            <span className={cn('shrink-0 mt-[2px] text-[10.5px] tabular-nums', active ? 'text-primary' : 'text-on-surface-2/75')}>{badge(item)}</span>
          </button>
        )
      })}
    </nav>
  )
}

function BookmarkList({
  marks, onJump, onDelete,
}: {
  marks: { id: string; label: string; anchor: string; quote?: string }[]
  onJump: (anchor: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <section className="mt-2 border-t border-outline/60 pt-2" aria-label="书签">
      <div className="flex items-center gap-1.5 px-2.5 pt-0.5 pb-1 text-[11px] font-medium text-on-surface-2">
        <Bookmark size={12} />
        <span>书签</span>
        <span className="tabular-nums opacity-70">{marks.length}</span>
      </div>
      {marks.map((b) => (
        <div key={b.id} className="group flex items-start gap-1.5 rounded-[9px] pl-2.5 pr-1.5 py-1.5 hover:bg-surface-3/60 transition-colors">
          <button type="button" className="flex-1 min-w-0 text-left cursor-pointer" onClick={() => onJump(b.anchor)}>
            <span className="block text-[12.5px] leading-snug">{b.label}</span>
            {b.quote && <span className="block mt-0.5 text-[11px] leading-snug text-on-surface-2 line-clamp-2">{b.quote}</span>}
          </button>
          <button
            type="button"
            aria-label="删除书签"
            onClick={() => onDelete(b.id)}
            className="mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 text-on-surface-2 hover:text-danger transition-opacity cursor-pointer"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </section>
  )
}

function PanelEmpty({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) {
  return (
    <div className="grid place-items-center text-center px-4 py-12">
      <div className="grid place-items-center w-11 h-11 rounded-[14px] bg-surface-3/60 text-on-surface-2 mb-3">
        <Icon size={18} strokeWidth={1.8} />
      </div>
      <p className="text-[12.5px] font-medium">{title}</p>
      <p className="text-[11.5px] text-on-surface-2 leading-relaxed mt-1 max-w-[210px]">{hint}</p>
    </div>
  )
}

/** MD 目录：标题由页面加载时一并解析，不再二次读文件 */
function MdToc({
  headings, currentBlock, onJump,
}: {
  headings: { level: number; text: string; blockIdx: number }[]
  currentBlock: number | null
  onJump: (anchor: string, hl?: string) => void
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null)
  const activeIndex = useMemo(() => {
    if (currentBlock == null) return headings.length > 0 ? 0 : -1
    let idx = 0
    for (let i = 0; i < headings.length; i++) {
      if (headings[i].blockIdx <= currentBlock) idx = i
    }
    return idx
  }, [headings, currentBlock])

  useEffect(() => {
    if (activeIndex >= 0) activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!headings.length) {
    return <PanelEmpty icon={List} title="没有标题" hint="在 Markdown 里用 # 写标题，目录会自动生成。" />
  }
  return (
    <nav className="py-1.5" aria-label="标题目录">
      {headings.map((h, i) => {
        const active = i === activeIndex
        const levelClass = h.level === 1 ? 'text-[13px] font-semibold' : h.level === 2 ? 'text-[12.5px]' : 'text-[12px]'
        return (
          <button
            key={`${h.blockIdx}-${i}`}
            ref={active ? activeRef : undefined}
            type="button"
            onClick={() => onJump(`b${h.blockIdx}`)}
            className={cn(
              'group w-full flex items-start gap-2 text-left rounded-[9px] py-[7px] pr-2 transition-colors cursor-pointer',
              active ? 'bg-primary-soft/70 text-on-surface' : 'text-on-surface-2 hover:bg-surface-3/60 hover:text-on-surface',
            )}
            style={{ paddingLeft: 10 + Math.min(h.level - 1, 3) * 12 }}
          >
            <span className={cn('shrink-0 mt-[6px] w-1.5 h-1.5 rounded-full transition-colors', active ? 'bg-primary' : 'bg-outline group-hover:bg-on-surface-2/50')} />
            <span className={cn('flex-1 min-w-0 leading-[1.55] line-clamp-2', levelClass)}>{h.text}</span>
          </button>
        )
      })}
    </nav>
  )
}

/* ---------- 右栏内容 ---------- */

function RightContent({
  annotations, backlinks, rightTab, onJump, onToTask, onDelete, onRecolor, onComment, docId, anchorFor,
}: {
  annotations: Annotation[]
  backlinks: Task[]
  rightTab: 'anns' | 'backlinks'
  onJump: (anchor: string, hl?: string) => void
  onToTask: (ann: Annotation) => void
  onDelete: (id: string) => void
  onRecolor: (id: string, color: Annotation['color']) => void
  onComment: (id: string, comment?: string) => void
  docId?: string
  anchorFor: (a: Annotation) => string
}) {
  const [editing, setEditing] = useState<string | null>(null)

  if (rightTab === 'backlinks') {
    return (
      <div className="flex-1 overflow-y-auto px-2.5 pb-4 min-h-0">
        {backlinks.length === 0 ? (
          <PanelEmpty
            icon={ArrowUpRight}
            title="暂无引用"
            hint={docId ? '在批注上点「转任务」，或从任务详情挂载本文档，反链会显示在这里。' : '还没有任务引用本文档。'}
          />
        ) : (
          <>
            <p className="text-[11px] text-on-surface-2 px-1.5 pt-2.5 pb-2 tabular-nums">{backlinks.length} 个任务引用了本文档</p>
            <div className="flex flex-col gap-2">
              {backlinks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    window.location.hash = `#/tasks?tier=${t.tier}&focus=${t.id}`
                  }}
                  className="group w-full text-left rounded-[12px] border border-outline/70 bg-surface px-3 py-2.5 hover:border-outline hover:-translate-y-px transition-[border-color,transform] cursor-pointer"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0" />
                    <p className="flex-1 text-[12.5px] font-medium leading-snug line-clamp-2">{t.title}</p>
                    <ArrowUpRight size={13} className="shrink-0 mt-0.5 text-on-surface-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <p className="text-[10.5px] text-on-surface-2 mt-1 pl-3.5">
                    {t.tier === 'today' ? '今日' : t.tier === 'upcoming' ? '近期' : t.tier === 'anytime' ? '随时' : '将来'} · {t.status === 'doing' ? '进行中' : '待办'}
                  </p>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-2.5 pb-4 min-h-0">
      {annotations.length === 0 ? (
        <PanelEmpty icon={Highlighter} title="还没有批注" hint="划选正文 → 选颜色高亮 → 高亮可加评论、一键转任务。" />
      ) : (
        <div className="pt-2 flex flex-col gap-2">
          <p className="text-[11px] text-on-surface-2 px-1.5 pb-0.5 tabular-nums">{annotations.length} 条批注</p>
          {annotations.map((a) => (
            <article key={a.id} className="group relative rounded-[12px] border border-outline/70 bg-surface overflow-hidden transition-colors hover:border-outline">
              <span className={cn('absolute left-0 top-0 bottom-0 w-[3px]', annotationColorClass(a))} aria-hidden />
              <div className="pl-3 pr-2.5 py-2.5">
                {a.kind === 'shot' && a.img && (
                  <button
                    type="button"
                    onClick={() => onJump(anchorFor(a), a.id)}
                    className="block w-full mb-2 cursor-zoom-in"
                    aria-label="跳到截图所在页"
                  >
                    <img src={a.img} alt="区域截图" className="w-full rounded-[8px] border border-outline/70" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onJump(anchorFor(a), a.id)}
                  title="跳到原文位置"
                  className="w-full text-left cursor-pointer"
                >
                  <span className="block text-[12.5px] leading-[1.6] text-on-surface line-clamp-4">{a.text}</span>
                </button>
                {a.comment && editing !== a.id && (
                  <p className="mt-1.5 ml-0.5 pl-2 border-l-2 border-outline/70 text-[11.5px] leading-relaxed text-on-surface-2">{a.comment}</p>
                )}
                {editing === a.id ? (
                  <textarea
                    autoFocus
                    defaultValue={a.comment ?? ''}
                    rows={2}
                    placeholder="写下评论…"
                    onBlur={(e) => {
                      onComment(a.id, e.target.value.trim() || undefined)
                      setEditing(null)
                    }}
                    className="mt-1.5 w-full rounded-[8px] bg-surface-2 border border-outline px-2.5 py-1.5 text-[12.5px] outline-none focus:border-primary/60 resize-none"
                  />
                ) : null}
                <div className="ann-actions mt-2 pt-1.5 border-t border-outline/60 flex items-center gap-0.5 -ml-1">
                  {a.kind !== 'shot' && COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`改为${c}`}
                      onClick={() => onRecolor(a.id, c)}
                      className={`w-[18px] h-[18px] rounded-full hl-${c} border ${a.color === c ? 'border-on-surface' : 'border-outline/50'} cursor-pointer`}
                    />
                  ))}
                  {a.kind !== 'shot' && <span className="w-px h-3.5 bg-outline mx-1" />}
                  <MiniBtn label="评论" onClick={() => setEditing(editing === a.id ? null : a.id)}><MessageSquareText size={13} /></MiniBtn>
                  <MiniBtn label="定位" onClick={() => onJump(anchorFor(a), a.id)}><LocateFixed size={13} /></MiniBtn>
                  <MiniBtn label="转任务" onClick={() => onToTask(a)}><Plus size={13} /></MiniBtn>
                  <MiniBtn label="删除" danger onClick={() => onDelete(a.id)}><Trash2 size={13} /></MiniBtn>
                  <span className="ml-auto text-[10.5px] text-on-surface-2 pr-1 tabular-nums">
                    {new Date(a.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}


function MiniBtn({ children, label, onClick, danger = false }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid place-items-center w-7 h-7 rounded-lg hover:bg-surface-3 cursor-pointer ${danger ? 'text-on-surface-2 hover:text-danger' : 'text-on-surface-2 hover:text-on-surface'}`}
    >
      {children}
    </button>
  )
}

/* 书签 live query（局部 hook） */
function useLiveQueryBookmarks(docHash: string) {
  return (
    useLiveQuery(
      () => db.bookmarks.where('docHash').equals(docHash).reverse().sortBy('createdAt'),
      [docHash],
      [] as { id: string; label: string; anchor: string; quote?: string; createdAt: number }[],
    ) ?? []
  )
}
