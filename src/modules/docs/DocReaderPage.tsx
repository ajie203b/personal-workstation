import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import {
  ArrowLeft, BookDown, BookmarkPlus, Copy, Crop, List, ListPlus, MessageSquareText,
  MoreHorizontal, PanelLeft, PanelRight, PenLine, Settings2,
} from 'lucide-react'
import type { Task } from '@/db/db'
import { DOC_KIND_LABEL } from '@/db/db'
import { addAnnotation, deleteBookmark, getDocBlob, touchDoc } from '@/db/docs'
import { useAnnotations, useDoc, useDocBacklinks } from '@/db/hooks'
import { toggleDone } from '@/db/tasks'
import { MORPH_NAME, morphClose } from '@/lib/viewTransition'
import { isFutureTask } from '@/lib/date'
import { useDocTabs } from '@/stores/tabs'
import { READER_PANEL_LIMITS, useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Dialog, Sheet } from '@/shared/ui/Sheet'
import { DropdownMenu, DropdownMenuTrigger, MenuContent, MenuItem, MenuSeparator } from '@/shared/ui/Menu'
import { Skeleton } from '@/shared/ui/Skeleton'
import { MdReader, parseMdBlocks } from './MdReader'
import { PdfReader, type TocItem } from './PdfReader'
import { FlowReader } from './FlowReader'
import { parseFlowDoc, type FlowDoc } from './flowDoc'
import { FLOW_KINDS, addBookmarkAt, locatorFor } from './reader/locator'
import { useReadingPosition } from './reader/useReadingPosition'
import { useReaderLayout } from './reader/useReaderLayout'
import { useDocAnnotations } from './reader/useDocAnnotations'
import { HL_COLORS, type Selection } from './reader/types'
import { IconBtn, PanelHead, PanelSplitter, RightContent, TabBar, TocContent } from './reader/ReaderPanels'
import { ReaderSettingsPanel } from './reader/ReaderSettingsPanel'

/**
 * 阅读器页面：只负责「把三种阅读器、三栏布局、各种弹层组装起来」。
 *
 * 按职责拆成了三块，页面从 1737 行降到 ~750 行：
 * - 阅读位置（排版设置 / 双坐标恢复 / 进度 / 跳转）→ reader/useReadingPosition
 * - 批注操作（建高亮 / 改色 / 评论 / 导出 / 转任务）→ reader/useDocAnnotations
 * - 分栏布局（拖宽 / 折叠 / 重排锚点）→ reader/useReaderLayout
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
  const [shotMode, setShotMode] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  /** 手机上收起阅读器顶栏（轻点正文切换），把纵向空间还给正文 */
  const [chromeHidden, setChromeHidden] = useState(false)
  const tapRef = useRef<{ x: number; y: number } | null>(null)
  const [leftTab, setLeftTab] = useState<'toc' | 'marks'>('toc')
  const [rightTab, setRightTab] = useState<'anns' | 'backlinks'>('anns')
  const [mobilePanel, setMobilePanel] = useState<'toc' | 'anns' | null>(null)
  const restoredShown = useRef(false)
  // 读完提醒：进度第一次跨到 100% 时，若有未完成的关联任务就问一句
  const [finishAsk, setFinishAsk] = useState<Task[] | null>(null)
  const [finishPicked, setFinishPicked] = useState<Set<string>>(new Set())
  const finishAsked = useRef(false)
  const prevPct = useRef(0)

  useEffect(() => {
    if (!showSettings) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSettings(false) }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [showSettings])

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

  const onProgress = useCallback((index: number, pct: number) => {
    setProgressPct(pct)
    setCurrentLocator(locatorFor(doc?.kind, index))
    // 从「没读完」跨到 100% 才算读完；打开时本来就 100% 的不再打扰
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
  const hasAnnotations = annotations.length > 0

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
            <MenuItem onSelect={addCurrentBookmark}>
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
            {hasAnnotations && (
              <>
                <MenuSeparator />
                <MenuItem onSelect={exportNotes}>
                  <BookDown size={15} /> 导出批注为笔记
                </MenuItem>
              </>
            )}
          </MenuContent>
        </DropdownMenu>

        <IconBtn label="添加书签" className="hidden sm:grid" onClick={addCurrentBookmark}><BookmarkPlus size={18} /></IconBtn>
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
        {hasAnnotations && (
          <IconBtn label="导出批注为笔记" className="hidden sm:grid" onClick={exportNotes}>
            <BookDown size={18} />
          </IconBtn>
        )}

        {/* 排版设置（弹层） */}
        <div className="relative">
          <IconBtn label="排版设置" active={showSettings} onClick={() => setShowSettings((v) => !v)}><Settings2 size={18} /></IconBtn>
          {showSettings && (
            <ReaderSettingsPanel
              doc={doc}
              settings={settings}
              updateSettings={updateSettings}
              onClose={() => setShowSettings(false)}
              onResetLayout={resetReaderLayout}
            />
          )}
        </div>

        <span className="hidden md:block w-px h-5 bg-outline/80 mx-0.5" aria-hidden />
        <IconBtn
          label={readerPanels.leftCollapsed ? '展开目录栏' : '收起目录栏'}
          active={!readerPanels.leftCollapsed}
          className="hidden lg:grid"
          onClick={() => toggleReaderPanel('left')}
        >
          <PanelLeft size={18} />
        </IconBtn>
        <IconBtn
          label={readerPanels.rightCollapsed ? '展开批注栏' : '收起批注栏'}
          active={!readerPanels.rightCollapsed}
          className="hidden xl:grid"
          onClick={() => toggleReaderPanel('right')}
        >
          <PanelRight size={18} />
        </IconBtn>
        <IconBtn label="目录与高亮" className="lg:hidden" active={mobilePanel === 'toc'} onClick={() => setMobilePanel('toc')}><List size={18} /></IconBtn>
        <IconBtn label="批注与反链" className="xl:hidden" active={mobilePanel === 'anns'} onClick={() => setMobilePanel('anns')}><MessageSquareText size={18} /></IconBtn>
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
              onProgress={onProgress}
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
              onProgress={onProgress}
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
              onProgress={onProgress}
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
              {HL_COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={`高亮-${c}`}
                  title={`高亮-${c}`}
                  onClick={() => void createAnnotation(c)}
                  className={`w-7 h-7 rounded-full hl-${c} border border-outline/60 hover:scale-110 transition-transform cursor-pointer`}
                />
              ))}
              <span className="w-px h-5 bg-outline mx-1" />
              <button
                aria-label="复制选中文本"
                title="复制选中文本"
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
            docId={docId}
            anchorFor={anchorFor}
          />
        </aside>
      </div>

      {/* 批注 → 任务弹窗：勾选内容进笔记区，标题自己输入 */}
      <Dialog
        open={task.seed != null}
        onOpenChange={(v) => !v && task.close()}
        title="从批注创建任务"
        description="勾选内容已放入任务笔记；任务标题自己起。"
      >
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="block text-[12px] font-medium text-on-surface-2 mb-1">任务标题</span>
            <input
              autoFocus
              value={task.title}
              onChange={(e) => task.setTitle(e.target.value)}
              placeholder="输入任务标题…"
              className="w-full h-10 px-3 rounded-[10px] bg-surface-2 border border-outline text-[14px] outline-none focus:border-primary/60"
            />
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-on-surface-2 mb-1">笔记内容（已预填勾选内容，可改）</span>
            <textarea
              value={task.notes}
              onChange={(e) => task.setNotes(e.target.value)}
              rows={4}
              className="w-full rounded-[10px] bg-surface-2 border border-outline px-3 py-2 text-[13px] outline-none focus:border-primary/60 resize-none leading-relaxed"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={task.close}>取消</Button>
            <Button
              variant="primary"
              disabled={!task.title.trim()}
              onClick={() => void task.submit()}
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
          onToTask={task.open}
          onDelete={removeAnnotation}
          onRecolor={recolor}
          onComment={comment}
          docId={docId}
          anchorFor={anchorFor}
        />
      </Sheet>
    </div>
  )
}
