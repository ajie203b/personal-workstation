import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import {
  ArrowLeft, BookmarkPlus, Copy, Crop, Highlighter, List, ListPlus,
  MessageSquareText, BookDown, PanelRight, Settings2, Trash2, LocateFixed, Plus, X,
} from 'lucide-react'
import type { Annotation, Doc, DocSettings, Task } from '@/db/db'
import { DOC_KIND_LABEL, type ReadingPosition } from '@/db/db'
import { db } from '@/db/db'
import {
  addAnnotation, addBookmark, deleteAnnotation, deleteBookmark,
  getDocBlob, getPosition, saveDocSettings, touchDoc, updateAnnotation,
} from '@/db/docs'
import { useAnnotations, useDoc, useDocBacklinks } from '@/db/hooks'
import { useDocTabs } from '@/stores/tabs'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { Segmented } from '@/shared/ui/Segmented'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { Sheet } from '@/shared/ui/Sheet'
import { MdReader, parseMdBlocks } from './MdReader'
import { PdfReader, type TocItem } from './PdfReader'
import { FlowReader } from './FlowReader'
import { parseFlowDoc, type FlowDoc } from './flowDoc'
import { exportAnnotationsToDoc } from './exportAnnotations'

const FLOW_KINDS: readonly Doc['kind'][] = ['epub', 'docx', 'pptx', 'txt']

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
  const [content, setContent] = useState<
    { kind: 'pdf'; data: ArrayBuffer } | { kind: 'md'; md: string } | { kind: 'flow'; data: FlowDoc } | null
  >(null)
  const [settings, setSettings] = useState<DocSettings>(DEFAULT_SETTINGS)
  const [progressPct, setProgressPct] = useState(0)
  const [currentLocator, setCurrentLocator] = useState('') // p3 / b7 / f2
  const [toc, setToc] = useState<TocItem[]>([])
  const [numPages, setNumPages] = useState(0)
  const [jump, setJump] = useState<{ anchor: string; hl?: string; ts: number } | null>(null)
  const [initialTarget, setInitialTarget] = useState<
    { page: number; offsetRatio: number } | { blockIdx: number; ratio: number } | { segIdx: number; ratio: number } | null
  >(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [shotMode, setShotMode] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
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

  // 载入文档内容（依赖 doc.id 原始值，避免 liveQuery 对象身份变化引发重载循环）
  const docContentId = doc?.id
  const docHash = doc?.hash
  const docKind = doc?.kind
  const flowRef = useRef<FlowDoc | null>(null)
  useEffect(() => {
    if (!docContentId || !docHash || !docKind) return
    let alive = true
    setContent(null)
    flowRef.current?.dispose?.()
    flowRef.current = null
    void (async () => {
      const blob = await getDocBlob(docHash)
      if (!blob || !alive) return
      await touchDoc(docContentId)
      if (docKind === 'pdf') {
        // PDF 由 PdfReader 自行加载 Blob（避免双份 ArrayBuffer 占用内存）
        setContent({ kind: 'pdf', data: new ArrayBuffer(0) })
      } else if (FLOW_KINDS.includes(docKind)) {
        // EPUB/DOCX/PPTX/TXT：解析为流式段落
        try {
          const flow = await parseFlowDoc(docKind, blob)
          if (!alive) { flow.dispose?.(); return }
          flowRef.current = flow
          setToc(flow.segments.map((s, i) => ({ level: 0, title: s.title ?? `第 ${i + 1} 段`, page: i + 1 })))
          setContent({ kind: 'flow', data: flow })
        } catch {
          if (alive) setContent(null)
        }
      } else {
        setContent({ kind: 'md', md: await blob.text() })
      }
    })()
    return () => {
      alive = false
    }
  }, [docContentId, docHash, docKind])

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
  }, [doc?.kind])

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

  const addCurrentBookmark = useCallback(async () => {
    if (!doc) return
    const unitLabel = doc.kind === 'pdf'
      ? `第 ${currentLocator.replace('p', '') || 1} 页`
      : doc.kind === 'md'
        ? `第 ${Number(currentLocator.replace('b', '0')) + 1} 段`
        : `第 ${Number(currentLocator.replace('f', '0')) + 1} ${doc.kind === 'pptx' ? '片' : doc.kind === 'epub' ? '章' : '节'}`
    await addBookmark(doc.hash, unitLabel, currentLocator || (doc.kind === 'pdf' ? 'p1' : doc.kind === 'md' ? 'b0' : 'f0'))
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
    <div className="h-full flex flex-col bg-surface">
      {/* 顶栏 */}
      <header className="glass relative z-30 shrink-0 flex items-center gap-2 h-14 px-3 md:px-4 border-b border-outline/70">
        <button
          onClick={() => navigate('/docs')}
          aria-label="返回文档库"
          className="grid place-items-center w-10 h-10 rounded-[12px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors"
        >
          <ArrowLeft size={19} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold truncate leading-tight">{doc.title}</p>
          <p className="text-[11px] text-on-surface-2 leading-tight">
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
        <IconBtn label="添加书签" onClick={() => void addCurrentBookmark()}><BookmarkPlus size={18} /></IconBtn>
        {doc.kind === 'pdf' && (
          <IconBtn label={shotMode ? '退出截图模式' : '区域截图批注（拖拽框选）'} active={shotMode} onClick={() => setShotMode((v) => !v)}>
            <Crop size={18} />
          </IconBtn>
        )}
        {annotations.length > 0 && (
          <IconBtn label="导出批注为笔记" onClick={() => void exportAnnotationsToDoc(doc).then((id) => {
            toast('批注笔记已生成')
            navigate(`/docs/${id}`)
          })}>
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
                <Stepper label="字号" value={`${settings.fontSize}px`} onMinus={() => updateSettings({ fontSize: Math.max(14, settings.fontSize - 1) })} onPlus={() => updateSettings({ fontSize: Math.min(24, settings.fontSize + 1) })} />
                <Stepper label="行距" value={settings.leading.toFixed(2)} onMinus={() => updateSettings({ leading: Math.max(1.6, Math.round((settings.leading - 0.1) * 10) / 10) })} onPlus={() => updateSettings({ leading: Math.min(2.2, Math.round((settings.leading + 0.1) * 10) / 10) })} />
                <div>
                  <p className="text-[12px] font-medium text-on-surface-2 mb-1.5">页宽</p>
                  <Segmented
                    size="sm"
                    value={String(settings.widthPct)}
                    onChange={(v) => updateSettings({ widthPct: Number(v) })}
                    options={[
                      { value: '62', label: '窄' },
                      { value: '72', label: '中' },
                      { value: '88', label: '宽' },
                    ]}
                  />
                </div>
                <p className="text-[11px] text-on-surface-2">按文档记忆，下次打开保持</p>
              </div>
            </>
          )}
        </div>

        <IconBtn label="目录与高亮" className="lg:hidden" onClick={() => setMobilePanel('toc')}><List size={18} /></IconBtn>
        <IconBtn label="批注与反链" className="hidden" onClick={() => setMobilePanel('anns')}><MessageSquareText size={18} /></IconBtn>
        <IconBtn label="批注面板" className="hidden lg:grid" onClick={() => setRightTab(rightTab === 'anns' ? 'backlinks' : 'anns')}><PanelRight size={18} /></IconBtn>
      </header>

      {/* 多标签栏（M2.5）：打开过多个文档时显示 */}
      <TabBar docId={docId} onJump={(id) => navigate(`/docs/${id}`)} />

      {/* 三栏工作区 */}
      <div className="flex-1 flex min-h-0">
        {/* 左：目录 + 高亮 */}
        <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-outline/70 bg-surface-2/40">
          <PanelTabs value={leftTab} onChange={setLeftTab} left="目录" right="高亮" />
          <TocContent
            doc={doc}
            toc={toc}
            annotations={annotations}
            leftTab={leftTab}
            onJump={doJump}
            onDeleteBookmark={(id) => void deleteBookmark(id)}
          />
        </aside>

        {/* 中：阅读画布 */}
        <div className="flex-1 min-w-0 relative min-h-[60vh]">
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
            />
          )}
          {!content && (
            <div className="h-full grid place-items-center text-on-surface-2 text-[13px]">正在载入文档…</div>
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
        <aside className="hidden lg:flex flex-col w-80 shrink-0 border-l border-outline/70 bg-surface-2/40">
        <PanelTabs value={rightTab} onChange={setRightTab} left="批注" right="反链" />
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

      {/* 移动端抽屉 */}
      <Sheet open={mobilePanel === 'toc'} onOpenChange={(v) => !v && setMobilePanel(null)} title="目录与高亮">
        <PanelTabs value={leftTab} onChange={setLeftTab} left="目录" right="高亮" />
        <TocContent
          doc={doc}
          toc={toc}
          annotations={annotations}
          leftTab={leftTab}
          onJump={(a) => {
            doJump(a)
            setMobilePanel(null)
          }}
          onDeleteBookmark={(id) => void deleteBookmark(id)}
        />
      </Sheet>
      <Sheet open={mobilePanel === 'anns'} onOpenChange={(v) => !v && setMobilePanel(null)} title="批注与反链">
        <PanelTabs value={rightTab} onChange={setRightTab} left="批注" right="反链" />
        <RightContent
          annotations={annotations}
          backlinks={backlinks}
          rightTab={rightTab}
          onJump={(a) => {
            doJump(a)
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
      className={`grid place-items-center w-10 h-10 rounded-[12px] transition-colors cursor-pointer ${active ? 'bg-primary-soft text-primary' : 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface'} ${className}`}
    >
      {children}
    </button>
  )
}

function PanelTabs<V extends string>({ value, onChange, left, right }: { value: V; onChange: (v: V) => void; left: string; right: string }) {
  const first = left === '目录' ? 'toc' : 'anns'
  const second = left === '目录' ? 'marks' : 'backlinks'
  return (
    <div className="px-3 pt-3 pb-1 shrink-0">
      <Segmented
        className="w-full [&>button]:flex-1"
        value={value}
        onChange={onChange}
        options={[
          { value: first as V, label: left },
          { value: second as V, label: right },
        ]}
      />
    </div>
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

function TocContent({
  doc, toc, annotations, leftTab, onJump, onDeleteBookmark,
}: {
  doc: Doc
  toc: TocItem[]
  annotations: Annotation[]
  leftTab: 'toc' | 'marks'
  onJump: (anchor: string, hl?: string) => void
  onDeleteBookmark: (id: string) => void
}) {
  // 书签 live query
  const marks = useLiveQueryBookmarks(doc.hash)

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-4 min-h-0">
      {leftTab === 'toc' ? (
        doc.kind === 'pdf' ? (
          toc.length > 0 ? (
            <nav className="py-1">
              {toc.map((item, i) => (
                <button
                  key={i}
                  onClick={() => onJump(`p${item.page}`)}
                  className="w-full text-left px-2.5 py-2 rounded-[10px] hover:bg-surface-3 transition-colors cursor-pointer"
                  style={{ paddingLeft: 10 + item.level * 14 }}
                >
                  <span className="text-[13px] leading-snug line-clamp-2">{item.title}</span>
                  <span className="ml-1.5 text-[11px] text-on-surface-2">{item.page}</span>
                </button>
              ))}
            </nav>
          ) : (
            <p className="text-[12px] text-on-surface-2 px-3 py-6 text-center">此 PDF 没有书签大纲</p>
          )
        ) : FLOW_KINDS.includes(doc.kind) ? (
          toc.length > 1 ? (
            <nav className="py-1">
              {toc.map((item, i) => (
                <button
                  key={i}
                  onClick={() => onJump(`f${item.page - 1}`)}
                  className="w-full text-left px-2.5 py-2 rounded-[10px] hover:bg-surface-3 transition-colors cursor-pointer"
                >
                  <span className="text-[13px] leading-snug line-clamp-2">{item.title}</span>
                  <span className="ml-1.5 text-[11px] text-on-surface-2">{item.page}</span>
                </button>
              ))}
            </nav>
          ) : (
            <p className="text-[12px] text-on-surface-2 px-3 py-6 text-center">此文档没有章节结构</p>
          )
        ) : (
          <MdToc doc={doc} onJump={onJump} />
        )
      ) : (
        <div className="py-1">
          {annotations.length === 0 && (
            <p className="text-[12px] text-on-surface-2 px-3 py-6 text-center">划选正文即可添加高亮</p>
          )}
          {annotations.map((a) => (
            <button
              key={a.id}
              onClick={() => onJump(annotationAnchor(doc, a), a.id)}
              className="w-full text-left px-2.5 py-2 rounded-[10px] hover:bg-surface-3 transition-colors flex gap-2 cursor-pointer"
            >
              <span className={`shrink-0 mt-0.5 w-2.5 h-2.5 rounded-full ${a.color === 'yellow' ? 'bg-yellow-400' : a.color === 'green' ? 'bg-green-400' : a.color === 'blue' ? 'bg-blue-400' : 'bg-red-400'}`} />
              <span className="text-[13px] leading-snug line-clamp-3">{a.text}</span>
            </button>
          ))}
        </div>
      )}

      {/* 书签区 */}
      {marks.length > 0 && (
        <div className="mt-3 border-t border-outline pt-2">
          <p className="text-[11px] font-medium text-on-surface-2 px-2.5 py-1">书签</p>
          {marks.map((b) => (
            <div key={b.id} className="group flex items-center gap-1 px-2.5 py-1.5 rounded-[10px] hover:bg-surface-3">
              <button className="flex-1 text-left text-[13px] cursor-pointer" onClick={() => onJump(b.anchor)}>
                {b.label}
              </button>
              <button aria-label="删除书签" onClick={() => onDeleteBookmark(b.id)} className="opacity-0 group-hover:opacity-100 text-on-surface-2 hover:text-danger cursor-pointer">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** MD 目录：解析块标题 */
function MdToc({ doc, onJump }: { doc: Doc; onJump: (anchor: string, hl?: string) => void }) {
  const [headings, setHeadings] = useState<{ level: number; text: string; blockIdx: number }[]>([])
  const [total, setTotal] = useState(0)
  useEffect(() => {
    void import('@/db/docs').then(async ({ getDocBlob }) => {
      const blob = await getDocBlob(doc.hash)
      if (!blob) return
      const { headings, total } = parseMdBlocks(await blob.text())
      setHeadings(headings)
      setTotal(total)
    })
  }, [doc.hash])
  void total

  if (!headings.length) {
    return <p className="text-[12px] text-on-surface-2 px-3 py-6 text-center">此文档没有标题结构</p>
  }
  return (
    <nav className="py-1">
      {headings.map((h, i) => (
        <button
          key={i}
          onClick={() => onJump(`b${h.blockIdx}`)}
          className="w-full text-left px-2.5 py-2 rounded-[10px] hover:bg-surface-3 transition-colors cursor-pointer"
          style={{ paddingLeft: 10 + (h.level - 1) * 14 }}
        >
          <span className={`text-[13px] leading-snug line-clamp-2 ${h.level === 1 ? 'font-semibold' : ''}`}>{h.text}</span>
        </button>
      ))}
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
      <div className="flex-1 overflow-y-auto px-3 pb-4 min-h-0">
        <p className="text-[11px] text-on-surface-2 px-1 pt-2 pb-1.5">
          {backlinks.length > 0 ? `${backlinks.length} 个任务引用了本文档` : '暂无任务引用本文档'}
        </p>
        {backlinks.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              window.location.hash = `#/tasks?tier=${t.tier}&focus=${t.id}`
            }}
            className="w-full text-left card card-hover px-3 py-2.5 mb-2 cursor-pointer"
          >
            <p className="text-[13px] font-medium line-clamp-2">{t.title}</p>
            <p className="text-[11px] text-on-surface-2 mt-0.5">
              {t.tier === 'today' ? '今日' : t.tier === 'upcoming' ? '近期' : t.tier === 'anytime' ? '随时' : '将来'} · {t.status === 'doing' ? '进行中' : '待办'}
            </p>
          </button>
        ))}
        {docId && backlinks.length === 0 && (
          <p className="text-[12px] text-on-surface-2 leading-relaxed px-1">
            在批注上点「转任务」，或从任务详情挂载本文档，反向链接会显示在这里。
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 pb-4 min-h-0">
      {annotations.length === 0 && (
        <div className="text-center py-10 px-4">
          <div className="grid place-items-center w-12 h-12 rounded-full bg-surface-3/70 text-on-surface-2 mx-auto mb-3">
            <Highlighter size={20} />
          </div>
          <p className="text-[13px] font-medium">还没有批注</p>
          <p className="text-[12px] text-on-surface-2 mt-1 leading-relaxed">划选正文 → 选颜色高亮 → 高亮可加评论、一键转任务</p>
        </div>
      )}
      {annotations.map((a) => (
        <div key={a.id} className="card px-3 py-2.5 mb-2">
          {a.kind === 'shot' && a.img && (
            <img src={a.img} alt="区域截图" className="w-full rounded-[10px] border border-outline mb-2 cursor-zoom-in" onClick={() => onJump(anchorFor(a), a.id)} />
          )}
          <div className="flex items-start gap-2">
            <span className={`shrink-0 mt-1 w-2.5 h-2.5 rounded-full ${a.kind === 'shot' ? 'bg-primary' : a.color === 'yellow' ? 'bg-yellow-400' : a.color === 'green' ? 'bg-green-400' : a.color === 'blue' ? 'bg-blue-400' : 'bg-red-400'}`} />
            <p className="flex-1 text-[13px] leading-snug text-on-surface">{a.text}</p>
          </div>
          {a.comment && !editing && <p className="text-[12px] text-on-surface-2 mt-1.5 pl-[18px]">{a.comment}</p>}
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
              className="mt-1.5 w-full rounded-[10px] bg-surface border border-outline px-2.5 py-1.5 text-[13px] outline-none focus:border-primary/60 resize-none"
            />
          ) : null}
          <div className="flex items-center gap-0.5 mt-1.5 -ml-1">
            {a.kind !== 'shot' && COLORS.map((c) => (
              <button
                key={c}
                aria-label={`改为${c}`}
                onClick={() => onRecolor(a.id, c)}
                className={`w-5 h-5 rounded-full hl-${c} border ${a.color === c ? 'border-on-surface' : 'border-outline/50'} cursor-pointer`}
              />
            ))}
            {a.kind !== 'shot' && <span className="w-px h-4 bg-outline mx-1" />}
            <MiniBtn label="评论" onClick={() => setEditing(editing === a.id ? null : a.id)}><MessageSquareText size={13} /></MiniBtn>
            <MiniBtn label="定位" onClick={() => onJump(anchorFor(a), a.id)}><LocateFixed size={13} /></MiniBtn>
            <MiniBtn label="转任务" onClick={() => onToTask(a)}><Plus size={13} /></MiniBtn>
            <MiniBtn label="删除" danger onClick={() => onDelete(a.id)}><Trash2 size={13} /></MiniBtn>
            <span className="ml-auto text-[11px] text-on-surface-2 pr-1">
              {new Date(a.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
            </span>
          </div>
        </div>
      ))}
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
      [] as { id: string; label: string; anchor: string; createdAt: number }[],
    ) ?? []
  )
}
