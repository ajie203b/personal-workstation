import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import type { Annotation, Task } from '@/db/db'
import { addAnnotation, deleteBookmark, getDocBlob, touchDoc, updateAnnotation } from '@/db/docs'
import { useAnnotations, useDoc, useDocBacklinks } from '@/db/hooks'
import { toggleDone } from '@/db/tasks'
import { MORPH_NAME, morphClose } from '@/lib/viewTransition'
import { isFutureTask } from '@/lib/date'
import { READER_PANEL_LIMITS, useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { readDocumentText } from '@/lib/readDocumentText'
import { shareMarkdown } from '@/lib/shareDoc'
import { Skeleton } from '@/shared/ui/Skeleton'
import { recognizeImageDataUrl } from '@/modules/tools/ocr/ocrClient'
import { AnnotationReviewDialog } from './AnnotationReviewDialog'
import { formatCitation } from './citation'
import { exportAnnotationsToMarkdownFile } from './exportAnnotations'
import { isAnnotationDue } from './reviewSm2'
import { MdReader, parseMdBlocks } from './MdReader'
import type { TocItem } from './PdfReader'
import { parseFlowDoc, type FlowDoc } from './flowDoc'
import { FLOW_KINDS, addBookmarkAt, locatorFor } from './reader/locator'
import { DEFAULT_SETTINGS, useReadingPosition } from './reader/useReadingPosition'
import { useReaderLayout } from './reader/useReaderLayout'
import { useDocAnnotations } from './reader/useDocAnnotations'
import { type Selection } from './reader/types'
import { PanelHead, PanelSplitter, RightContent, TocContent } from './reader/ReaderPanels'
import { AnnotationTaskDialog } from './reader/AnnotationTaskDialog'
import { ReaderToolbar } from './reader/ReaderToolbar'
import { ReaderFindBar } from './reader/ReaderFindBar'
import { FinishReadingDialog, PdfAnnotationPopover, ReaderMobileSheets, SelectionPopover } from './reader/ReaderOverlays'

const PdfReader = lazy(() => import('./PdfReader').then((m) => ({ default: m.PdfReader })))
const FlowReader = lazy(() => import('./FlowReader').then((m) => ({ default: m.FlowReader })))

const READER_SKELETON = (
  <div className="mx-auto w-full max-w-[720px] px-6 py-8 flex flex-col gap-3">
    <Skeleton className="h-6 w-2/3" />
    {Array.from({ length: 9 }).map((_, i) => (
      <Skeleton key={i} className={i % 4 === 3 ? 'h-3 w-2/3' : 'h-3'} />
    ))}
  </div>
)

/**
 * 阅读器页面：只负责「把三种阅读器、三栏布局、各种弹层组装起来」。
 *
 * 按职责拆成了多块：
 * - 阅读位置（排版设置 / 双坐标恢复 / 进度 / 跳转）→ reader/useReadingPosition
 * - 批注操作（建高亮 / 改色 / 评论 / 导出 / 转任务）→ reader/useDocAnnotations
 * - 分栏布局（拖宽 / 折叠 / 重排锚点）→ reader/useReaderLayout
 * - 顶栏与弹层 → reader/ReaderToolbar & reader/ReaderOverlays
 * 侧栏与小组件在 reader/ReaderPanels，定位串工具在 reader/locator。
 */
export function DocReaderPage() {
  const { docId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useUi((s) => s.toast)

  const doc = useDoc(docId)
  const annotations = useAnnotations(doc?.hash)
  const backlinks = useDocBacklinks(docId)

  const scrollRef = useRef<HTMLDivElement>(null)
  const {
    settings, updateSettings, progressPct, setProgressPct,
    currentLocator, setCurrentLocator, initialTarget, jump, doJump,
  } = useReadingPosition({
    docHash: doc?.hash,
    paramP: params.get('p'),
    paramHl: params.get('hl') ?? undefined,
  })
  const {
    workspaceRef, readerPanels, toggleReaderPanel, resetReaderLayout, resetPanelWidth,
    onSplitDown, onSplitMove, onSplitEnd, onSplitKey,
  } = useReaderLayout(doc?.id, scrollRef)

  const [content, setContent] = useState<
    { kind: 'pdf'; data: ArrayBuffer } | { kind: 'md'; md: string } | { kind: 'flow'; data: FlowDoc } | null
  >(null)
  const [toc, setToc] = useState<TocItem[]>([])
  const [mdHeadings, setMdHeadings] = useState<{ level: number; text: string; blockIdx: number }[]>([])
  const [numPages, setNumPages] = useState(0)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [selectedPdfAnn, setSelectedPdfAnn] = useState<{ ann: Annotation; popover: { left: number; y: number; below: boolean } } | null>(null)
  const [ocrBusyId, setOcrBusyId] = useState<string | null>(null)
  const [focusAnnId, setFocusAnnId] = useState<{ id: string; ts: number } | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [shotMode, setShotMode] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const paramQ = params.get('q')?.trim() ?? ''
  const [findOpen, setFindOpen] = useState(() => Boolean(paramQ))
  const [findQuery, setFindQuery] = useState(paramQ)
  const [debouncedFindQuery, setDebouncedFindQuery] = useState(paramQ)
  const [findActive, setFindActive] = useState(0)
  const [findState, setFindState] = useState({ total: 0, searching: false })
  const [findFocusTick, setFindFocusTick] = useState(0)
  const [activeTocAnchor, setActiveTocAnchor] = useState('')
  /** 手机上收起阅读器顶栏（轻点正文切换），把纵向空间还给正文 */
  const [chromeHidden, setChromeHidden] = useState(false)
  const tapRef = useRef<{ x: number; y: number } | null>(null)
  const resetLayout = () => {
    updateSettings({
      fontSize: DEFAULT_SETTINGS.fontSize,
      leading: DEFAULT_SETTINGS.leading,
      widthPct: DEFAULT_SETTINGS.widthPct,
      zoom: 1,
      pdfSpread: false,
      pdfTrimMargins: false,
    }, true)
    resetReaderLayout()
    toast('已恢复默认布局')
  }

  const [leftTab, setLeftTab] = useState<'toc' | 'marks'>('toc')
  const [rightTab, setRightTab] = useState<'anns' | 'backlinks'>('anns')
  const [mobilePanel, setMobilePanel] = useState<'toc' | 'anns' | null>(null)
  const restoredShown = useRef(false)
  const [finishAsk, setFinishAsk] = useState<Task[] | null>(null)
  const [finishPicked, setFinishPicked] = useState<Set<string>>(new Set())
  const finishAsked = useRef(false)
  const prevPct = useRef(0)

  useEffect(() => {
    if (!paramQ) return
    setFindOpen(true)
    setFindQuery(paramQ)
    setDebouncedFindQuery(paramQ)
    setFindActive(0)
  }, [paramQ])

  useEffect(() => {
    if (!findQuery.trim()) {
      setDebouncedFindQuery('')
      setFindActive(0)
      return
    }
    if (findQuery === debouncedFindQuery) return
    const t = window.setTimeout(() => {
      setDebouncedFindQuery(findQuery)
      setFindActive(0)
    }, 120)
    return () => window.clearTimeout(t)
  }, [findQuery, debouncedFindQuery])

  const onFindState = useCallback((next: { total: number; searching: boolean }) => {
    setFindState(next)
    setFindActive((a) => (next.total > 0 ? Math.min(a, next.total - 1) : 0))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setChromeHidden(false)
        setFindOpen(true)
        setFindFocusTick((t) => t + 1)
        return
      }
      if (e.key === 'Escape') {
        if (showSettings) setShowSettings(false)
        else if (findOpen) setFindOpen(false)
        else if (selectedPdfAnn) setSelectedPdfAnn(null)
        else if (shotMode) setShotMode(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showSettings, findOpen, selectedPdfAnn, shotMode])

  // 载入文档内容（依赖 doc.id 原始值，避免 liveQuery 对象身份变化引发重载循环）
  const docContentId = doc?.id
  const docHash = doc?.hash
  const docKind = doc?.kind
  const flowRef = useRef<FlowDoc | null>(null)
  const [loadFail, setLoadFail] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  useEffect(() => {
    if (!docContentId || !docHash || !docKind) return
    let alive = true
    setContent(null)
    setLoadFail(null)
    setToc([])
    setActiveTocAnchor('')
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
          setContent({ kind: 'pdf', data: new ArrayBuffer(0) })
        } else if (FLOW_KINDS.includes(docKind)) {
          const flow = await parseFlowDoc(docKind, blob)
          if (!alive) { flow.dispose?.(); return }
          flowRef.current = flow
          setToc(
            flow.toc?.length
              ? flow.toc.map((t) => ({ level: t.level, title: t.title, page: 1, anchor: t.anchor }))
              : flow.segments.map((s, i) => ({ level: 0, title: s.title ?? `第 ${i + 1} 段`, page: i + 1 })),
          )
          setActiveTocAnchor(flow.toc?.[0]?.anchor ?? '')
          setContent({ kind: 'flow', data: flow })
        } else {
          const text = await readDocumentText(blob)
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
    return () => { alive = false }
  }, [docContentId, docHash, docKind, reloadTick])

  useEffect(() => () => flowRef.current?.dispose?.(), [])

  const onRestored = useCallback(() => {
    if (restoredShown.current) return
    restoredShown.current = true
    toast('已回到上次阅读位置')
  }, [toast])

  const {
    create: createAnnotation, remove: removeAnnotation, recolor, comment,
    exportNotes, anchorFor, task,
  } = useDocAnnotations({
    doc,
    selection,
    clearSelection: () => setSelection(null),
    toast,
    onExported: (id) => navigate(`/docs/${id}`),
  })

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

  const runShotOcr = useCallback(async (ann: Annotation) => {
    if (!ann.img || ocrBusyId) return
    setOcrBusyId(ann.id)
    try {
      const res = await recognizeImageDataUrl(ann.img)
      const text = res.text.trim()
      if (!text) {
        toast('未识别到可读文字')
        return
      }
      await updateAnnotation(ann.id, { text })
      toast(`已识别 ${res.lines.length} 行文字并写入批注`)
    } catch (err) {
      toast(err instanceof Error ? `OCR 识别失败：${err.message}` : 'OCR 识别失败')
    } finally {
      setOcrBusyId((cur) => (cur === ann.id ? null : cur))
    }
  }, [ocrBusyId, toast])

  const liveSelectedPdfAnn = useMemo(() => {
    if (!selectedPdfAnn) return null
    const cur = annotations.find((a) => a.id === selectedPdfAnn.ann.id)
    return cur ? { ...selectedPdfAnn, ann: cur } : null
  }, [selectedPdfAnn, annotations])

  const reviewDueCount = useMemo(
    () => annotations.filter((a) => isAnnotationDue(a)).length,
    [annotations],
  )

  const onProgress = useCallback((index: number, pct: number) => {
    setProgressPct(pct)
    setCurrentLocator(locatorFor(doc?.kind, index))
    const finishable = backlinks.filter((t) => !isFutureTask(t))
    if (!finishAsked.current && pct >= 0.995 && prevPct.current < 0.98 && finishable.length > 0) {
      finishAsked.current = true
      setFinishPicked(new Set(finishable.map((t) => t.id)))
      setFinishAsk(finishable)
    }
    prevPct.current = pct
  }, [doc?.kind, backlinks, setProgressPct, setCurrentLocator])

  const addCurrentBookmark = useCallback(() => {
    if (!doc) return
    void addBookmarkAt(doc, currentLocator).then(() => toast('已添加书签'))
  }, [doc, currentLocator, toast])

  const shareDoc = useCallback(() => {
    if (!doc || content?.kind !== 'md') { toast('文档还没载入完成'); return }
    void shareMarkdown(doc.title, content.md).then((msg) => { if (msg) toast(msg) }).catch(() => toast('分享失败，请重试'))
  }, [doc, content, toast])

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
  const activeFindQuery = findOpen ? debouncedFindQuery : ''

  return (
    <div
      className="h-full flex flex-col bg-surface"
      style={{
        viewTransitionName: MORPH_NAME,
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      <ReaderToolbar
        doc={doc}
        numPages={numPages}
        progressPct={progressPct}
        pct={pct}
        chromeHidden={chromeHidden}
        shotMode={shotMode}
        onToggleShot={() => setShotMode((v) => !v)}
        findOpen={findOpen}
        onToggleFind={() =>
          setFindOpen((v) => {
            const next = !v
            if (next) setFindFocusTick((t) => t + 1)
            return next
          })
        }
        hasAnnotations={annotations.length > 0}
        showSettings={showSettings}
        onToggleSettings={() => setShowSettings((v) => !v)}
        onCloseSettings={() => setShowSettings(false)}
        settings={settings}
        updateSettings={updateSettings}
        onResetLayout={resetLayout}
        leftCollapsed={readerPanels.leftCollapsed}
        rightCollapsed={readerPanels.rightCollapsed}
        onTogglePanel={toggleReaderPanel}
        mobilePanel={mobilePanel}
        onOpenMobilePanel={setMobilePanel}
        onBack={() => morphClose(() => document.getElementById(`doc-${doc.id}`), () => navigate('/docs'))}
        onBookmark={addCurrentBookmark}
        onEdit={() => navigate(`/docs/edit/${doc.id}`)}
        onShare={shareDoc}
        onExportNotes={exportNotes}
        onExportMdFile={() => {
          void exportAnnotationsToMarkdownFile(doc)
            .then((name) => toast(`已导出 ${name}`))
            .catch(() => toast('导出失败'))
        }}
        onCopyCitation={(style) => {
          const txt = formatCitation(doc, style)
          void navigator.clipboard.writeText(txt).then(
            () => toast(style === 'bibtex' ? '已复制 BibTeX 引文' : '已复制 RIS 引文'),
            () => toast('复制失败'),
          )
        }}
        onOpenReview={() => setReviewOpen(true)}
        reviewDueCount={reviewDueCount}
      />

      <ReaderFindBar
        open={findOpen}
        focusTick={findFocusTick}
        query={findQuery}
        active={findActive}
        total={findState.total}
        searching={findState.searching}
        onQueryChange={(q) => {
          setFindQuery(q)
          setFindActive(0)
        }}
        onNext={() => setFindActive((i) => (findState.total > 0 ? (i + 1) % findState.total : 0))}
        onPrev={() => setFindActive((i) => (findState.total > 0 ? (i - 1 + findState.total) % findState.total : 0))}
        onClose={() => setFindOpen(false)}
      />

      {/* 三栏工作区 */}
      <div
        ref={workspaceRef}
        className="reader-workspace flex-1 flex min-h-0"
        onPointerDown={(e) => { tapRef.current = { x: e.clientX, y: e.clientY } }}
        onPointerUp={(e) => {
          if (window.matchMedia('(min-width: 768px)').matches) return
          const start = tapRef.current
          tapRef.current = null
          if (!start) return
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) return
          if (window.getSelection()?.toString()) return
          const el = e.target as HTMLElement
          if (el.closest('button,a,input,textarea,select,[role="button"],[contenteditable="true"]')) return
          setChromeHidden((v) => !v)
        }}
      >
        <aside
          data-reader-panel="left"
          aria-hidden={readerPanels.leftCollapsed}
          className={cn(
            'reader-panel hidden lg:flex flex-col shrink-0 min-h-0 overflow-hidden bg-surface-2/40',
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
            activeAnchor={activeTocAnchor}
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

        <div className="flex-1 min-w-0 relative min-h-0 bg-surface">
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
              onProgress={onProgress}
              onRestored={onRestored}
              scrollRef={scrollRef}
              initialTarget={(initialTarget as { blockIdx: number; ratio: number } | null)?.blockIdx != null ? (initialTarget as { blockIdx: number; ratio: number }) : null}
              onFontSizeChange={(px) => updateSettings({ fontSize: px })}
              findQuery={activeFindQuery}
              findActive={findActive}
              onFindState={onFindState}
            />
          )}
          {content?.kind === 'pdf' && (
            <Suspense fallback={READER_SKELETON}>
              <PdfReader
                hash={doc.hash}
                settings={settings}
                annotations={annotations}
                jump={jump}
                onSelection={(sel) => {
                  if (sel) setSelectedPdfAnn(null)
                  setSelection(sel ? { kind: 'pdf', ...sel } : null)
                }}
                shotMode={shotMode}
                onShot={onShot}
                onProgress={onProgress}
                onRestored={onRestored}
                onLoaded={(n, outline) => {
                  setNumPages(n)
                  setToc(outline)
                }}
                scrollRef={scrollRef}
                initialTarget={(initialTarget as { page: number; offsetRatio: number } | null)?.page != null ? (initialTarget as { page: number; offsetRatio: number }) : null}
                onZoom={(z) => updateSettings({ zoom: z })}
                findQuery={activeFindQuery}
                findActive={findActive}
                onFindState={onFindState}
                selectedAnnId={liveSelectedPdfAnn?.ann.id ?? null}
                onSelectAnnotation={(sel) => {
                  if (sel) setSelection(null)
                  setSelectedPdfAnn(sel)
                }}
              />
            </Suspense>
          )}
          {content?.kind === 'flow' && (
            <Suspense fallback={READER_SKELETON}>
              <FlowReader
                hash={doc.hash}
                flow={content.data}
                settings={settings}
                annotations={annotations}
                jump={jump}
                onSelection={(sel) => setSelection(sel ? { kind: 'flow', ...sel } : null)}
                onProgress={onProgress}
                onRestored={onRestored}
                onLoaded={(n) => setNumPages(n)}
                onActiveAnchor={setActiveTocAnchor}
                scrollRef={scrollRef}
                initialTarget={(initialTarget as { segIdx: number; ratio: number } | null)?.segIdx != null ? (initialTarget as { segIdx: number; ratio: number }) : null}
                onFontSizeChange={(px) => updateSettings({ fontSize: px })}
                findQuery={activeFindQuery}
                findActive={findActive}
                onFindState={onFindState}
              />
            </Suspense>
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
          {!content && !loadFail && READER_SKELETON}

          {selection && (
            <SelectionPopover
              selection={selection}
              onHighlight={(c, toTask) => void createAnnotation(c, toTask)}
              onCopy={(text) => {
                void navigator.clipboard.writeText(text)
                toast('已复制')
              }}
            />
          )}
          {liveSelectedPdfAnn && !selection && (
            <PdfAnnotationPopover
              selected={liveSelectedPdfAnn}
              ocrBusy={ocrBusyId === liveSelectedPdfAnn.ann.id}
              onRecolor={recolor}
              onOcr={(ann) => void runShotOcr(ann)}
              onComment={(ann) => {
                setSelectedPdfAnn(null)
                setRightTab('anns')
                if (readerPanels.rightCollapsed) toggleReaderPanel('right')
                if (window.matchMedia('(max-width: 1279px)').matches) setMobilePanel('anns')
                setFocusAnnId({ id: ann.id, ts: Date.now() })
              }}
              onToTask={(ann) => {
                setSelectedPdfAnn(null)
                task.open(ann)
              }}
              onDelete={(id) => {
                setSelectedPdfAnn(null)
                removeAnnotation(id)
              }}
            />
          )}
        </div>

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
          data-reader-panel="right"
          aria-hidden={readerPanels.rightCollapsed}
          className={cn(
            'reader-panel hidden xl:flex flex-col shrink-0 min-h-0 overflow-hidden bg-surface-2/40',
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
            onJump={doJump}
            onToTask={task.open}
            onDelete={removeAnnotation}
            onRecolor={recolor}
            onComment={comment}
            onOcr={(a) => void runShotOcr(a)}
            ocrBusyId={ocrBusyId}
            focusAnnId={focusAnnId}
            docId={docId}
            anchorFor={anchorFor}
          />
        </aside>
      </div>

      <AnnotationTaskDialog task={task} />

      <FinishReadingDialog
        finishAsk={finishAsk}
        finishPicked={finishPicked}
        onTogglePick={(id) => {
          setFinishPicked((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
          })
        }}
        onClose={() => setFinishAsk(null)}
        onConfirm={() => {
          const picked = (finishAsk ?? []).filter((t) => finishPicked.has(t.id))
          setFinishAsk(null)
          void Promise.all(picked.map((t) => toggleDone(t))).then(() => {
            toast(`已完成 ${picked.length} 个任务`)
          })
        }}
      />

      <ReaderMobileSheets
        mobilePanel={mobilePanel}
        onClose={() => setMobilePanel(null)}
        doc={doc}
        docId={docId}
        toc={toc}
        mdHeadings={mdHeadings}
        annotations={annotations}
        backlinks={backlinks}
        leftTab={leftTab}
        onLeftTabChange={setLeftTab}
        rightTab={rightTab}
        onRightTabChange={setRightTab}
        currentLocator={currentLocator}
        activeAnchor={activeTocAnchor}
        onJump={doJump}
        onDeleteBookmark={(id) => void deleteBookmark(id)}
        onToTask={task.open}
        onDeleteAnnotation={removeAnnotation}
        onRecolorAnnotation={recolor}
        onCommentAnnotation={comment}
        onOcrAnnotation={(a) => void runShotOcr(a)}
        ocrBusyId={ocrBusyId}
        focusAnnId={focusAnnId}
        anchorFor={anchorFor}
      />

      <AnnotationReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        docs={doc ? [doc] : []}
        annotations={annotations}
        onJump={(_docId, anchor, hlId) => {
          setReviewOpen(false)
          doJump(anchor, hlId)
        }}
      />
    </div>
  )
}
