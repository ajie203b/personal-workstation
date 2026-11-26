import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useBlocker, useNavigate, useParams } from 'react-router'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
// v3 把 BubbleMenu / FloatingMenu 挪到子路径，定位也从 tippy 换成 Floating UI
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Markdown } from 'tiptap-markdown'
import { readDocumentText } from '@/lib/readDocumentText'
import {
  ArrowLeft, Bold, CheckSquare, Code, Code2, Eye, Focus, Highlighter, ImagePlus,
  Italic, List, ListOrdered, ListPlus, ListTree, Quote, Redo2, Save, Search, Share2,
  MoreHorizontal, Sigma, Strikethrough, Table2, Undo2,
} from 'lucide-react'
import { db, type Doc } from '@/db/db'
import { addTask } from '@/db/tasks'
import { getPosition, repairHtmlKind, saveDocSettings, saveMarkdownDoc } from '@/db/docs'
import { DEFAULT_SETTINGS } from './reader/useReadingPosition'
import { shareMarkdown } from '@/lib/shareDoc'
import { useDocumentPrintTitle } from '@/lib/printDocument'
import { useUi } from '@/stores/ui'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { fileToDataUrl } from '@/lib/image'
import { cn } from '@/lib/cn'
import { guardNavigation, registerUnsavedGuard } from '@/lib/unsavedGuard'
import { EditorFindExtension } from './editor/editorFind'
import { EditorFindReplaceBar } from './editor/EditorFindReplaceBar'
import { EditorFocusExtension } from './editor/editorFocus'
import { MdOutlinePanel } from './editor/MdOutlinePanel'
import { InlineMath, MathBlock, MermaidCodeBlock } from './editor/mdMath'
import { MD_TABLE_EXTENSIONS, isCursorInTable } from './editor/mdTable'
import { SlashCommandMenu, detectSlashTrigger, type SlashTriggerState } from './editor/SlashCommandMenu'
import { SelectMenu } from '@/shared/ui/SelectMenu'
import { executeSlashCommand, scrollEditorToHeading } from './editor/typoraCommands'
import { useEditorFindReplace } from './editor/useEditorFindReplace'
import { HL_COLORS, HighlightMark, type HlColor } from './mdHighlight'
import { MarkdownWordCount } from './MarkdownWordCount'
import { clearMdDraft, mdDraftKey, readMdDraft, writeMdDraft, type MdDraft } from './mdDraft'

function formatDraftTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const TOOLBAR_BTN = 'grid place-items-center shrink-0 w-11 h-11 md:w-7 md:h-7 rounded-[10px] md:rounded-[7px] text-on-surface-2 hover:bg-surface-3 transition-colors cursor-pointer'
const TOOLBAR_ON = 'bg-primary-soft text-primary'
const HL_LABEL: Record<HlColor, string> = { yellow: '黄色', green: '绿色', blue: '蓝色', red: '红色' }

function ToolBtn({ label, active, onClick, className, children }: {
  label: string
  active?: boolean
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      data-tip={label}
      className={cn(TOOLBAR_BTN, 'tip', active && TOOLBAR_ON, className)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** MD 编辑器（M2.5 · TipTap）：新建 / 编辑 Markdown 文档，保存为本地文档 */
export function MdEditorPage() {
  const { docId } = useParams()
  const navigate = useNavigate()
  const toast = useUi((s) => s.toast)
  const [existing, setExisting] = useState<Doc | null>(null)
  const [title, setTitle] = useState('')
  useDocumentPrintTitle(title || existing?.title)
  const [ready, setReady] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [contentSeed, setContentSeed] = useState<string | null>(null)
  const [countMarkdown, setCountMarkdown] = useState('')
  const [draftCandidate, setDraftCandidate] = useState<MdDraft | null>(null)
  const [moreTools, setMoreTools] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [sourceMode, setSourceMode] = useState(false)
  const [sourceText, setSourceText] = useState('')
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [typewriterMode, setTypewriterMode] = useState(false)
  const [editorWidthPct, setEditorWidthPct] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('ws-md-editor-width'))
      return Number.isFinite(saved) && saved >= 50 && saved <= 100 ? saved : DEFAULT_SETTINGS.widthPct
    } catch {
      return DEFAULT_SETTINGS.widthPct
    }
  })
  const [slashTrigger, setSlashTrigger] = useState<SlashTriggerState | null>(null)
  const [docTick, setDocTick] = useState(0)

  const draftKey = mdDraftKey(docId)
  const seedingRef = useRef(false)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const sourceModeRef = useRef(false)
  sourceModeRef.current = sourceMode
  const sourceTextRef = useRef('')
  sourceTextRef.current = sourceText
  const titleRef = useRef(title)
  titleRef.current = title
  const baseHashRef = useRef(existing?.hash)
  baseHashRef.current = existing?.hash
  const editSeqRef = useRef(0)
  const loadedDocIdRef = useRef<string | null>(null)
  const pendingLeaveRef = useRef<{ proceed: () => void; reset?: () => void } | null>(null)
  const saveRef = useRef<((opts?: { silent?: boolean; navigateOnCreate?: boolean }) => Promise<boolean>) | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const editorPageRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null)
  const insertImagesRef = useRef<(files: File[]) => void>(() => {})

  useEffect(() => {
    const viewport = window.visualViewport
    const page = editorPageRef.current
    if (!page || !viewport) return
    const resize = () => page.style.setProperty('--editor-viewport-height', `${viewport.height}px`)
    resize()
    viewport.addEventListener('resize', resize)
    return () => viewport.removeEventListener('resize', resize)
  }, [])

  // 载入待编辑文档 + 检测本地未保存草稿
  useEffect(() => {
    let cancelled = false
    setDraftCandidate(null)
    if (!docId) {
      loadedDocIdRef.current = null
      setExisting(null)
      setTitle('无标题文档')
      setContentSeed('')
      setCountMarkdown('')
      dirtyRef.current = false
      setDirty(false)
      editSeqRef.current = 0
      const draft = readMdDraft(mdDraftKey(undefined))
      if (draft && (draft.markdown.trim() || (draft.title.trim() && draft.title !== '无标题文档'))) {
        setDraftCandidate(draft)
      }
      setReady(true)
      return () => { cancelled = true }
    }
    if (loadedDocIdRef.current === docId) {
      return () => { cancelled = true }
    }
    setReady(false)
    void (async () => {
      const doc = await db.docs.get(docId)
      if (cancelled) return
      if (doc?.kind === 'html' && !doc.deletedAt) {
        navigate(`/docs/${doc.id}`, { replace: true })
        return
      }
      if (!doc || doc.deletedAt || doc.kind !== 'md') {
        toast('文档不存在或不是 Markdown')
        navigate('/docs')
        return
      }
      const blob = await db.blobs.get(doc.hash)
      if (blob && await repairHtmlKind(doc, blob.blob)) {
        if (!cancelled) navigate(`/docs/${doc.id}`, { replace: true })
        return
      }
      const [md, pos] = await Promise.all([
        blob ? readDocumentText(blob.blob) : Promise.resolve(''),
        getPosition(doc.hash),
      ])
      if (cancelled) return
      loadedDocIdRef.current = doc.id
      setExisting(doc)
      if (pos?.settings?.widthPct) setEditorWidthPct(pos.settings.widthPct)
      setTitle(doc.title)
      setContentSeed(md)
      setCountMarkdown(md)
      dirtyRef.current = false
      setDirty(false)
      editSeqRef.current = 0
      const draft = readMdDraft(mdDraftKey(docId))
      if (draft) {
        if (draft.markdown !== md || draft.title !== doc.title) {
          setDraftCandidate(draft)
        } else {
          clearMdDraft(mdDraftKey(docId))
        }
      }
      setReady(true)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      MermaidCodeBlock,
      TaskList,
      TaskItem.configure({ nested: true }),
      ...MD_TABLE_EXTENSIONS,
      InlineMath,
      MathBlock,
      EditorFindExtension,
      EditorFocusExtension.configure({ scrollRef: bodyScrollRef }),
      // 图片走 data URL 存进正文：本地优先、导出/同步都自带，不依赖图床
      Image.configure({ inline: false, allowBase64: true }),
      HighlightMark,
      Markdown.configure({
        html: false,
        breaks: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: '',
    onUpdate: ({ editor }) => {
      setDocTick((t) => t + 1)
      setSlashTrigger(detectSlashTrigger(editor))
      if (!seedingRef.current) {
        editSeqRef.current += 1
        dirtyRef.current = true
        setDirty(true)
        setCountMarkdown((editor.storage as { markdown?: { getMarkdown: () => string } }).markdown?.getMarkdown() ?? '')
      }
    },
    onSelectionUpdate: ({ editor }) => {
      setDocTick((t) => t + 1)
      setSlashTrigger(detectSlashTrigger(editor))
    },
    editorProps: {
      attributes: {
        class: 'md-body outline-none min-h-full pb-24',
        spellcheck: 'false',
      },
      // 粘贴 / 拖入图片：转 data URL 后插进正文
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
        if (!files.length) return false
        event.preventDefault()
        insertImagesRef.current(files)
        return true
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'))
        if (!files.length) return false
        event.preventDefault()
        insertImagesRef.current(files)
        return true
      },
    },
  })

  const marks = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive('bold') ?? false,
      italic: editor?.isActive('italic') ?? false,
      strike: editor?.isActive('strike') ?? false,
      highlight: editor?.isActive('hl') ?? false,
    }),
  })

  // 内容就绪后一次性灌入（避免编辑器重建）
  useEffect(() => {
    if (ready && editor && contentSeed != null) {
      seedingRef.current = true
      editor.commands.setContent(contentSeed)
      seedingRef.current = false
      setSourceText(contentSeed)
      dirtyRef.current = false
      setDirty(false)
    }
  }, [ready, editor, contentSeed])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.commands.setTyporaModes({ focusMode, typewriterMode })
  }, [editor, focusMode, typewriterMode])

  // Ctrl/Cmd+S 保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void saveRef.current?.() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const insertImages = useCallback(
    async (files: File[]) => {
      if (!editor) return
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue
        try {
          const src = await fileToDataUrl(file)
          editor.chain().focus().insertContent([
            { type: 'image', attrs: { src, alt: file.name.replace(/\.[^.]+$/, '') } },
            { type: 'paragraph' },
          ]).run()
        } catch {
          toast('图片插入失败')
        }
      }
    },
    [editor, toast],
  )
  insertImagesRef.current = (files) => void insertImages(files)

  const getLiveMarkdown = useCallback(() => {
    if (sourceModeRef.current) return sourceTextRef.current
    return (editor?.storage as { markdown?: { getMarkdown: () => string } } | undefined)?.markdown?.getMarkdown() ?? ''
  }, [editor])

  const handleSourceChange = useCallback((next: string) => {
    editSeqRef.current += 1
    dirtyRef.current = true
    setDirty(true)
    sourceTextRef.current = next
    setSourceText(next)
    setCountMarkdown(next)
  }, [])

  const findReplace = useEditorFindReplace({
    editor,
    docTick,
    sourceMode,
    sourceText,
    onSourceChange: handleSourceChange,
    textareaRef: sourceTextareaRef,
    containerRef: bodyScrollRef,
  })

  const toggleSourceMode = useCallback(() => {
    if (!editor) return
    if (!sourceModeRef.current) {
      const md = (editor.storage as { markdown?: { getMarkdown: () => string } }).markdown?.getMarkdown() ?? ''
      setSourceText(md)
      setCountMarkdown(md)
      setSourceMode(true)
      setSlashTrigger(null)
    } else {
      seedingRef.current = true
      editor.commands.setContent(sourceTextRef.current)
      seedingRef.current = false
      setSourceMode(false)
      setDocTick((t) => t + 1)
    }
  }, [editor])

  const save = useCallback(
    async (opts?: { silent?: boolean; navigateOnCreate?: boolean }): Promise<boolean> => {
      if (!editor || savingRef.current) return false
      const md = getLiveMarkdown()
      if (!existing && !md.trim()) {
        if (!opts?.silent) toast('内容为空')
        return false
      }
      const seqAtStart = editSeqRef.current
      savingRef.current = true
      setSaving(true)
      setSaveFailed(false)
      try {
        // 保存统一走 saveMarkdownDoc：内容变了就换 hash，同步才会把新正文当成新本体上传
        // （旧实现在这里复用 existing.hash，远端 sync.json 里的 hash 一直没变，正文永远停在第一版）
        const saved = await saveMarkdownDoc({ doc: existing, title, markdown: md })
        loadedDocIdRef.current = saved.id
        setExisting(saved)
        if (existing) {
          if (editSeqRef.current === seqAtStart) setTitle(saved.title)
          if (!opts?.silent) toast('已保存')
        } else {
          if (!opts?.silent) toast('文档已创建')
        }
        clearMdDraft(mdDraftKey(saved.id))
        clearMdDraft(draftKey)
        if (editSeqRef.current === seqAtStart) {
          dirtyRef.current = false
          setDirty(false)
        } else if (dirtyRef.current) {
          writeMdDraft(draftKey, {
            title: titleRef.current,
            markdown: getLiveMarkdown(),
            savedAt: Date.now(),
            baseHash: saved.hash,
          })
        }
        if (!docId && opts?.navigateOnCreate !== false && !pendingLeaveRef.current && !dirtyRef.current) {
          navigate(`/docs/edit/${saved.id}`, { replace: true, state: { createdDocId: saved.id } })
        }
        return true
      } catch {
        setSaveFailed(true)
        if (!opts?.silent) toast('保存失败，请重试')
        return false
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    [editor, existing, title, toast, navigate, docId, draftKey, getLiveMarkdown],
  )
  saveRef.current = save

  const flushDraft = useCallback(() => {
    if (!dirtyRef.current) return
    writeMdDraft(draftKey, {
      title: titleRef.current,
      markdown: getLiveMarkdown(),
      savedAt: Date.now(),
      baseHash: baseHashRef.current,
    })
  }, [draftKey, getLiveMarkdown])

  // 500ms 写本地草稿，正文停笔 1800ms 后自动保存到文档库。
  useEffect(() => {
    if (!ready || !dirty) return
    const draftTimer = window.setTimeout(flushDraft, 500)
    const autoTimer = (existing || countMarkdown.trim()) && !leaveOpen
      ? window.setTimeout(() => {
          void saveRef.current?.({ silent: true })
        }, 1800)
      : null
    return () => {
      window.clearTimeout(draftTimer)
      if (autoTimer != null) window.clearTimeout(autoTimer)
    }
  }, [ready, dirty, title, countMarkdown, existing, leaveOpen, flushDraft])

  const restoreDraft = useCallback(() => {
    if (!draftCandidate || !editor) return
    seedingRef.current = true
    editor.commands.setContent(draftCandidate.markdown)
    seedingRef.current = false
    setSourceText(draftCandidate.markdown)
    editSeqRef.current += 1
    setTitle(draftCandidate.title)
    setCountMarkdown(draftCandidate.markdown)
    dirtyRef.current = true
    setDirty(true)
    setDraftCandidate(null)
  }, [draftCandidate, editor])

  const discardDraft = useCallback(() => {
    clearMdDraft(draftKey)
    setDraftCandidate(null)
  }, [draftKey])

  // 仅在存在未保存更改时阻止关闭/刷新标签页
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      flushDraft()
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    window.addEventListener('pagehide', flushDraft)
    return () => {
      flushDraft()
      window.removeEventListener('beforeunload', onUnload)
      window.removeEventListener('pagehide', flushDraft)
    }
  }, [flushDraft])

  // 应用内路由离开守卫
  const requestLeave = useCallback((proceed: () => void, reset?: () => void) => {
    pendingLeaveRef.current = { proceed, reset }
    setLeaveOpen(true)
  }, [])

  useEffect(() => {
    return registerUnsavedGuard((proceed) => {
      if (!dirtyRef.current) return false
      if (!pendingLeaveRef.current) requestLeave(proceed)
      return true
    }, navigate)
  }, [navigate, requestLeave])

  const blocker = useBlocker(({ historyAction }) => historyAction === 'POP' && dirtyRef.current)
  useEffect(() => {
    if (blocker.state === 'blocked') requestLeave(blocker.proceed, blocker.reset)
  }, [blocker, requestLeave])

  const closeLeave = () => {
    pendingLeaveRef.current?.reset?.()
    pendingLeaveRef.current = null
    setLeaveOpen(false)
  }

  const proceedLeave = () => {
    const pending = pendingLeaveRef.current
    pendingLeaveRef.current = null
    setLeaveOpen(false)
    pending?.proceed()
  }

  return (
    <div
      ref={editorPageRef}
      className="h-full max-md:max-h-[var(--editor-viewport-height,100%)] flex flex-col bg-surface"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      {/* 顶栏 */}
      <header className="glass shrink-0 flex items-center gap-2 h-14 px-3 md:px-4 border-b border-outline/70">
        <button
          aria-label="返回文档库"
          onClick={() => guardNavigation(() => navigate('/docs'))}
          className="grid place-items-center w-10 h-10 rounded-[12px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors"
        >
          <ArrowLeft size={19} />
        </button>
        <input
          value={title}
          onChange={(e) => { editSeqRef.current += 1; dirtyRef.current = true; titleRef.current = e.target.value; setTitle(e.target.value); setDirty(true) }}
          placeholder="文档标题"
          className="flex-1 min-w-0 bg-transparent outline-none text-[15px] font-semibold"
        />
        <span
          className={cn('text-[11px] sm:text-[11.5px] tabular-nums shrink-0', dirty ? 'text-p1' : 'text-on-surface-2')}
          aria-live="polite"
        >
          {saving ? '保存中…' : saveFailed ? '保存失败' : dirty ? '已编辑' : existing ? '已保存' : '新文档'}
        </span>
        <Button
          size="sm"
          aria-label="切换到阅读模式"
          onClick={() => {
            void (async () => {
              if (!loadedDocIdRef.current || dirtyRef.current) {
                const ok = await save({ navigateOnCreate: false })
                if (!ok) return
              }
              const targetId = loadedDocIdRef.current ?? existing?.id
              if (targetId) navigate(`/docs/${targetId}`)
            })()
          }}
        >
          <Eye size={14} /> <span className="hidden sm:inline">阅读</span>
        </Button>
        <Button
          size="sm"
          aria-label="分享 / 导出 Markdown"
          onClick={() => {
            const md = getLiveMarkdown()
            if (!md.trim()) { toast('内容为空'); return }
            void shareMarkdown(title, md).then((msg) => { if (msg) toast(msg) }).catch(() => toast('分享失败，请重试'))
          }}
        >
          <Share2 size={14} /> <span className="hidden sm:inline">分享</span>
        </Button>
      </header>

      {/* 本地草稿恢复提示 */}
      {ready && draftCandidate && (
        <div
          role="status"
          className="shrink-0 flex flex-wrap items-center gap-2 px-3 md:px-6 py-2 bg-primary-soft/60 border-b border-outline/70 text-[12.5px]"
        >
          <span className="text-on-surface flex-1 min-w-0 truncate">
            发现 {formatDraftTime(draftCandidate.savedAt)} 的未保存本地草稿
            {draftCandidate.title ? `《${draftCandidate.title}》` : ''}，是否恢复？
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button variant="primary" size="sm" onClick={restoreDraft}>恢复草稿</Button>
            <Button variant="outline" size="sm" onClick={discardDraft}>丢弃</Button>
          </div>
        </div>
      )}

      {/* 工具栏 */}
      {editor && (
        <div className="max-md:order-last shrink-0 flex flex-col bg-surface border-outline/60 max-md:border-t md:border-b" role="toolbar" aria-label="文档编辑工具">
          <div className="flex items-center gap-0.5 px-3 py-1 md:px-4 md:py-1 overflow-x-auto lg:overflow-visible lg:justify-center md:w-full">
            {!sourceMode && (
              <>
                <ToolBtn label="撤销" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={14} /></ToolBtn>
                <ToolBtn label="重做" className={cn(!moreTools && 'max-md:hidden')} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={14} /></ToolBtn>
                <span aria-hidden className="hidden md:block w-px h-3.5 bg-outline/60 mx-1 shrink-0" />
                <SelectMenu ariaLabel="段落格式" title="段落格式"
                  value={editor.isActive('heading') ? String(editor.getAttributes('heading').level) : 'paragraph'}
                  options={[{ value: 'paragraph', label: '正文' }, ...[1, 2, 3, 4, 5, 6].map(level => ({ value: String(level), label: `${level} 级标题` }))]}
                  triggerClassName="h-11 md:h-7 shrink-0 border-transparent bg-transparent px-2 md:px-1.5 md:text-[12px] md:rounded-[7px]"
                  onChange={(value) => {
                    const chain = editor.chain().focus()
                    if (value === 'paragraph') chain.setParagraph().run()
                    else chain.setHeading({ level: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 }).run()
                  }}
                />
                <ToolBtn label="加粗" active={marks?.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={14} /></ToolBtn>
                <ToolBtn label="斜体" active={marks?.italic} className={cn(!moreTools && 'max-md:hidden')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={14} /></ToolBtn>
                <ToolBtn label="删除线" active={marks?.strike} className={cn(!moreTools && 'max-md:hidden')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={14} /></ToolBtn>
                <ToolBtn label="高亮（黄色）" active={marks?.highlight} className={cn(!moreTools && 'max-md:hidden')} onClick={() => editor.chain().focus().toggleMark('hl', { color: 'yellow' }).run()}><Highlighter size={14} /></ToolBtn>
                <span aria-hidden className="hidden md:block w-px h-3.5 bg-outline/60 mx-1 shrink-0" />
                <ToolBtn label="无序列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={14} /></ToolBtn>
                <ToolBtn label="有序列表" active={editor.isActive('orderedList')} className={cn(!moreTools && 'max-md:hidden')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={14} /></ToolBtn>
                <ToolBtn label="待办清单" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}><CheckSquare size={14} /></ToolBtn>
                <ToolBtn label="引用" active={editor.isActive('blockquote')} className={cn(!moreTools && 'max-md:hidden')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={14} /></ToolBtn>
                <ToolBtn label="代码块" active={editor.isActive('codeBlock')} className={cn(!moreTools && 'max-md:hidden')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code size={14} /></ToolBtn>
                <ToolBtn label="插入表格 (3×3)" active={isCursorInTable(editor.state)} className={cn(!moreTools && 'max-md:hidden')} onClick={() => editor.chain().focus().insertGfmTable({ rows: 3, cols: 3 }).run()}><Table2 size={14} /></ToolBtn>
                <ToolBtn label="行内公式 ($...$)" className={cn(!moreTools && 'max-md:hidden')} onClick={() => editor.chain().focus().insertInlineMath('').run()}><span className="text-[12px] font-mono font-semibold">$</span></ToolBtn>
                <ToolBtn label="公式块 ($$...$$)" className={cn(!moreTools && 'max-md:hidden')} onClick={() => editor.chain().focus().insertMathBlock('').run()}><Sigma size={14} /></ToolBtn>
                <ToolBtn label="插入图片（也可直接粘贴或拖入）" className={cn(!moreTools && 'max-md:hidden')} onClick={() => imageInputRef.current?.click()}><ImagePlus size={14} /></ToolBtn>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) void insertImages(Array.from(e.target.files))
                    e.target.value = ''
                  }}
                />
                <span aria-hidden className="hidden md:block w-px h-3.5 bg-outline/60 mx-1 shrink-0" />
              </>
            )}
            {!sourceMode && (
              <button type="button" aria-label="更多编辑工具" aria-expanded={moreTools} onMouseDown={(e) => e.preventDefault()} onClick={() => setMoreTools((value) => !value)} className={cn(TOOLBAR_BTN, 'md:hidden', moreTools && TOOLBAR_ON)}>
                <MoreHorizontal size={19} />
              </button>
            )}
            <div className={cn('items-center gap-0.5 shrink-0', (moreTools || sourceMode) ? 'flex' : 'hidden md:flex')}>
              {saveFailed && <ToolBtn label="重试保存" onClick={() => void save()}><Save size={14} /></ToolBtn>}

              <ToolBtn label="查找与替换 (Ctrl+F / Ctrl+H)" active={findReplace.open} onClick={() => findReplace.openFind(true)}>
                <Search size={14} />
              </ToolBtn>
              <ToolBtn label={outlineOpen ? '收起实时大纲' : '展开实时大纲'} active={outlineOpen} onClick={() => setOutlineOpen((v) => !v)}>
                <ListTree size={14} />
              </ToolBtn>
              {!sourceMode && (
                <>
                  <ToolBtn label={focusMode ? '关闭专注模式' : '专注模式（突出当前段）'} active={focusMode} onClick={() => setFocusMode((v) => !v)}>
                    <Focus size={14} />
                  </ToolBtn>
                  <button
                    type="button"
                    aria-label={typewriterMode ? '关闭打字机居中' : '打字机模式（光标行居中）'}
                    title="打字机模式（光标保持在屏幕中部）"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setTypewriterMode((v) => !v)}
                    className={cn(
                      'h-11 md:h-7 px-2 md:px-1.5 rounded-[8px] md:rounded-[7px] text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap',
                      typewriterMode ? 'bg-primary-soft text-primary' : 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface',
                    )}
                  >
                    打字机
                  </button>
                </>
              )}
              <ToolBtn label="切换源码模式" active={sourceMode} onClick={toggleSourceMode}>
                <Code2 size={14} />
              </ToolBtn>
              <div className="hidden md:block">
                <SelectMenu
                  ariaLabel="编辑区宽度"
                  title="编辑区版心宽度"
                  value={
                    editorWidthPct <= 68 ? '62'
                    : editorWidthPct <= 86 ? '80'
                    : editorWidthPct < 98 ? '92'
                    : '100'
                  }
                  options={[
                    { value: '62', label: '窄栏 62%' },
                    { value: '80', label: '标准 80%' },
                    { value: '92', label: '宽敞 92%' },
                    { value: '100', label: '铺满 100%' },
                  ]}
                  triggerClassName="h-7 shrink-0 border-transparent bg-transparent px-1.5 text-[12px] rounded-[7px]"
                  onChange={(v) => {
                    const pct = Number(v)
                    setEditorWidthPct(pct)
                    try { localStorage.setItem('ws-md-editor-width', String(pct)) } catch { /* ignore */ }
                    if (existing?.hash) {
                      void getPosition(existing.hash).then((pos) => {
                        const base = pos?.settings ?? DEFAULT_SETTINGS
                        return saveDocSettings(existing.hash, { ...base, widthPct: pct })
                      })
                    }
                  }}
                />
              </div>
            </div>
          </div>

          {!sourceMode && isCursorInTable(editor.state) && (
            <div
              role="group"
              aria-label="表格操作"
              className="flex items-center gap-1 px-3 py-1 border-t border-outline/40 bg-surface-2/50 text-xs overflow-x-auto md:w-full md:justify-center"
              onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault() }}
            >
              {([
                ['退出表格', 'exitGfmTable'],
                ['上方插行', 'addTableRowBefore'], ['下方插行', 'addTableRowAfter'], ['删除行', 'deleteTableRow'],
                ['左侧插列', 'addTableColumnBefore'], ['右侧插列', 'addTableColumnAfter'], ['删除列', 'deleteTableColumn'],
                ['删除表格', 'deleteGfmTable'],
              ] as const).map(([label, command]) => (
                <button key={command} type="button" onClick={() => editor.chain().focus()[command]().run()}
                  className={cn('h-11 min-w-11 md:h-7 md:min-w-0 shrink-0 whitespace-nowrap px-2 rounded-lg cursor-pointer hover:bg-surface-3',
                    command === 'deleteGfmTable' && 'text-danger hover:bg-danger/10')}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <EditorFindReplaceBar
        open={findReplace.open}
        focusTick={findReplace.focusTick}
        showReplace={findReplace.showReplace}
        onToggleReplace={() => findReplace.setShowReplace((v) => !v)}
        query={findReplace.query}
        replaceText={findReplace.replaceText}
        caseSensitive={findReplace.caseSensitive}
        active={findReplace.active}
        total={findReplace.total}
        onQueryChange={findReplace.setQuery}
        onReplaceTextChange={findReplace.setReplaceText}
        onToggleCase={findReplace.toggleCase}
        onNext={findReplace.onNext}
        onPrev={findReplace.onPrev}
        onReplaceCurrent={findReplace.onReplaceCurrent}
        onReplaceAll={findReplace.onReplaceAll}
        onClose={findReplace.closeFind}
      />

      {/* 选中文字后的浮条：四色高亮 + 转任务 */}
      {editor && !sourceMode && (
        <BubbleMenu
          editor={editor}
          options={{ placement: 'top', offset: 8 }}
          shouldShow={({ state }) => {
            const { from, to } = state.selection
            return from !== to && state.doc.textBetween(from, to, '\n').trim().length > 0
          }}
        >
          <div className="pop flex items-center gap-1 p-1.5" style={{ animation: 'scale-in var(--dur-1) var(--ease-emph)' }}>
            {HL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`高亮：${HL_LABEL[c]}`}
                title={`高亮：${HL_LABEL[c]}`}
                data-tip={`${HL_LABEL[c]}高亮`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().toggleMark('hl', { color: c }).run()}
                className={`tip w-7 h-7 rounded-full hl-${c} border border-outline/60 hover:scale-110 transition-transform cursor-pointer`}
              />
            ))}
            <span className="w-px h-5 bg-outline mx-1" />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const { from, to } = editor.state.selection
                const text = editor.state.doc.textBetween(from, to, '\n').trim()
                if (!text) return
                const taskTitle = text.split('\n')[0].slice(0, 60)
                void addTask({
                  title: taskTitle,
                  tier: 'anytime',
                  tags: ['文档'],
                  notes: `来自文档《${title.trim() || '无标题文档'}》：\n${text}`,
                }).then(() => toast('已转为任务'))
              }}
              className="inline-flex items-center gap-1.5 h-7 px-2 rounded-lg text-[12px] text-primary hover:bg-primary-soft cursor-pointer"
            >
              <ListPlus size={14} /> 转任务
            </button>
          </div>
        </BubbleMenu>
      )}

      {/* 编辑区：可选实时大纲 + 全屏书写 */}
      <div className="flex-1 flex min-h-0">
        {outlineOpen && (
          <MdOutlinePanel
            markdown={countMarkdown}
            onClose={() => setOutlineOpen(false)}
            onSelectHeading={(headingIndex) => {
              if (!sourceMode) {
                scrollEditorToHeading(bodyScrollRef.current, headingIndex)
                return
              }
              const ta = sourceTextareaRef.current
              if (!ta) return
              const regex = /^ {0,3}#{1,6}\s.*$/gm
              let m: RegExpExecArray | null
              let count = 0
              while ((m = regex.exec(sourceTextRef.current)) !== null) {
                if (count === headingIndex) {
                  ta.focus()
                  ta.setSelectionRange(m.index, m.index + m[0].length)
                  break
                }
                count++
              }
            }}
          />
        )}

        <div
          ref={bodyScrollRef}
          className={cn('flex-1 overflow-y-auto min-h-0', focusMode && !sourceMode && 'typora-focus-mode')}
        >
          <div
            className="reader-prose mx-auto py-8 min-h-full"
            style={{ ['--reader-width' as string]: `${editorWidthPct}%` }}
          >
            {ready && editor ? (
              sourceMode ? (
                <textarea
                  ref={sourceTextareaRef}
                  value={sourceText}
                  onChange={(e) => handleSourceChange(e.target.value)}
                  aria-label="Markdown 源码编辑器"
                  placeholder="在此直接编辑 Markdown 源码…"
                  spellCheck={false}
                  className="w-full min-h-[65dvh] bg-transparent font-mono text-[13.5px] leading-[1.75] text-on-surface outline-none resize-none"
                />
              ) : (
                <>
                  <EditorContent editor={editor} />
                  <SlashCommandMenu
                    editor={editor}
                    trigger={slashTrigger}
                    onExecute={(id, range) => {
                      executeSlashCommand(editor, id, range)
                      setSlashTrigger(null)
                    }}
                    onDismiss={() => setSlashTrigger(null)}
                  />
                </>
              )
            ) : (
              <p className="text-[13px] text-on-surface-2">载入中…</p>
            )}
          </div>
        </div>
      </div>
      <MarkdownWordCount markdown={countMarkdown} />

      <Dialog
        open={leaveOpen}
        onOpenChange={(open) => {
          if (!open) closeLeave()
        }}
        title="有未保存的修改"
        description="离开当前文档前，是否先保存你的更改？"
      >
        <div className="flex flex-wrap justify-end gap-2 mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={closeLeave}
          >
            继续编辑
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              clearMdDraft(draftKey)
              dirtyRef.current = false
              setDirty(false)
              proceedLeave()
            }}
          >
            放弃修改
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={saving}
            onClick={() => {
              void (async () => {
                const ok = await save({ navigateOnCreate: false })
                if (ok && !dirtyRef.current) proceedLeave()
              })()
            }}
          >
            {saving ? '保存中…' : '保存并离开'}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
