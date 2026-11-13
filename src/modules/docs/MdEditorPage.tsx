import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { EditorContent, useEditor } from '@tiptap/react'
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
  Sigma, Strikethrough, Table2, Undo2,
} from 'lucide-react'
import { db, type Doc } from '@/db/db'
import { addTask } from '@/db/tasks'
import { saveMarkdownDoc } from '@/db/docs'
import { shareMarkdown } from '@/lib/shareDoc'
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
import { executeSlashCommand, scrollEditorToHeading } from './editor/typoraCommands'
import { useEditorFindReplace } from './editor/useEditorFindReplace'
import { HL_COLORS, HighlightMark, type HlColor } from './mdHighlight'
import { MarkdownWordCount } from './MarkdownWordCount'
import { clearMdDraft, mdDraftKey, readMdDraft, writeMdDraft, type MdDraft } from './mdDraft'

function formatDraftTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const TOOLBAR_BTN = 'grid place-items-center w-8 h-8 rounded-[10px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer'
const TOOLBAR_ON = 'bg-primary-soft text-primary'
const HL_LABEL: Record<HlColor, string> = { yellow: '黄色', green: '绿色', blue: '蓝色', red: '红色' }

function ToolBtn({ label, active, onClick, children }: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-tip={label}
      className={cn(TOOLBAR_BTN, 'tip', active && TOOLBAR_ON)}
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
  const [ready, setReady] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [contentSeed, setContentSeed] = useState<string | null>(null)
  const [countMarkdown, setCountMarkdown] = useState('')
  const [draftCandidate, setDraftCandidate] = useState<MdDraft | null>(null)
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<number | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [sourceMode, setSourceMode] = useState(false)
  const [sourceText, setSourceText] = useState('')
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [typewriterMode, setTypewriterMode] = useState(false)
  const [slashTrigger, setSlashTrigger] = useState<SlashTriggerState | null>(null)
  const [docTick, setDocTick] = useState(0)

  const draftKey = mdDraftKey(docId)
  const seedingRef = useRef(false)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  const sourceModeRef = useRef(false)
  sourceModeRef.current = sourceMode
  const sourceTextRef = useRef('')
  sourceTextRef.current = sourceText
  const titleRef = useRef(title)
  titleRef.current = title
  const editSeqRef = useRef(0)
  const loadedDocIdRef = useRef<string | null>(null)
  const pendingLeaveRef = useRef<(() => void) | null>(null)
  const saveRef = useRef<((opts?: { silent?: boolean; navigateOnCreate?: boolean }) => Promise<boolean>) | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null)
  const insertImagesRef = useRef<(files: File[]) => void>(() => {})

  // 载入待编辑文档 + 检测本地未保存草稿
  useEffect(() => {
    let cancelled = false
    setDraftCandidate(null)
    setLastAutoSavedAt(null)
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
      if (!doc || doc.deletedAt || doc.kind !== 'md') {
        toast('文档不存在或不是 Markdown')
        navigate('/docs')
        return
      }
      const blob = await db.blobs.get(doc.hash)
      const md = blob ? await readDocumentText(blob.blob) : ''
      if (cancelled) return
      loadedDocIdRef.current = doc.id
      setExisting(doc)
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
      if (!editor || saving) return false
      const md = getLiveMarkdown()
      if (!md.trim()) {
        if (!opts?.silent) toast('内容为空')
        return false
      }
      const seqAtStart = editSeqRef.current
      setSaving(true)
      try {
        // 保存统一走 saveMarkdownDoc：内容变了就换 hash，同步才会把新正文当成新本体上传
        // （旧实现在这里复用 existing.hash，远端 sync.json 里的 hash 一直没变，正文永远停在第一版）
        const saved = await saveMarkdownDoc({ doc: existing, title, markdown: md })
        loadedDocIdRef.current = saved.id
        setExisting(saved)
        if (existing) {
          setTitle(saved.title)
          if (opts?.silent) {
            setLastAutoSavedAt(Date.now())
          } else {
            setLastAutoSavedAt(null)
            toast('已保存')
          }
        } else {
          clearMdDraft(mdDraftKey(undefined))
          if (!opts?.silent) toast('文档已创建')
          // 建完立刻切到「编辑这篇」的路由：否则留在 /docs/new 上再按一次保存，
          // existing 还是空，会再新建一篇一模一样的文档（连按两下就是两篇）
          if (opts?.navigateOnCreate !== false) {
            navigate(`/docs/edit/${saved.id}`, { replace: true })
          }
        }
        clearMdDraft(mdDraftKey(saved.id))
        clearMdDraft(draftKey)
        if (editSeqRef.current === seqAtStart) {
          dirtyRef.current = false
          setDirty(false)
        } else {
          const latestMd = getLiveMarkdown() || md
          writeMdDraft(mdDraftKey(saved.id), {
            title: titleRef.current,
            markdown: latestMd,
            savedAt: Date.now(),
            baseHash: saved.hash,
          })
        }
        return true
      } catch {
        if (!opts?.silent) toast('保存失败，请重试')
        return false
      } finally {
        setSaving(false)
      }
    },
    [editor, existing, title, toast, navigate, saving, draftKey, getLiveMarkdown],
  )
  saveRef.current = save

  // 500ms 本地草稿防丢 + 1800ms 已有文档静默自动保存
  useEffect(() => {
    if (!ready || !dirty) return
    const draftTimer = window.setTimeout(() => {
      if (!editor) return
      const md = getLiveMarkdown() || countMarkdown
      writeMdDraft(draftKey, {
        title: titleRef.current,
        markdown: md,
        savedAt: Date.now(),
        baseHash: existing?.hash,
      })
    }, 500)
    const autoTimer = existing
      ? window.setTimeout(() => {
          void saveRef.current?.({ silent: true })
        }, 1800)
      : null
    return () => {
      window.clearTimeout(draftTimer)
      if (autoTimer != null) window.clearTimeout(autoTimer)
    }
  }, [ready, dirty, title, countMarkdown, existing, draftKey, editor, getLiveMarkdown])

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
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  // 应用内路由离开守卫
  useEffect(() => {
    return registerUnsavedGuard((proceed) => {
      if (!dirtyRef.current) return false
      pendingLeaveRef.current = proceed
      setLeaveOpen(true)
      return true
    })
  }, [])

  return (
    <div
      className="h-full flex flex-col bg-surface"
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
          onChange={(e) => { editSeqRef.current += 1; dirtyRef.current = true; setTitle(e.target.value); setDirty(true) }}
          placeholder="文档标题"
          className="flex-1 min-w-0 bg-transparent outline-none text-[15px] font-semibold"
        />
        <span
          className={cn('text-[11px] sm:text-[11.5px] tabular-nums shrink-0', dirty ? 'text-p1' : 'text-on-surface-2')}
          aria-live="polite"
        >
          {saving
            ? '保存中…'
            : dirty
              ? '未保存'
              : !existing
                ? '新文档'
                : lastAutoSavedAt
                  ? `已自动保存 ${formatDraftTime(lastAutoSavedAt)}`
                  : '已保存'}
        </span>
        <Button variant="primary" size="sm" disabled={saving} onClick={() => void save()}>
          <Save size={14} /> {saving ? '保存中' : '保存'}
        </Button>
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
        <div className="shrink-0 flex flex-col border-b border-outline/60">
          <div className="flex items-center gap-0.5 px-3 md:px-6 py-1.5 overflow-x-auto md:overflow-visible md:flex-wrap">
            {!sourceMode && (
              <>
                <ToolBtn label="撤销" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={15} /></ToolBtn>
                <ToolBtn label="重做" onClick={() => editor.chain().focus().redo().run()}><Redo2 size={15} /></ToolBtn>
                <span className="w-px h-5 bg-outline mx-1" />
                <select
                  aria-label="段落级别"
                  value={([1, 2, 3, 4, 5, 6].find((l) => editor.isActive('heading', { level: l })) ?? 0)}
                  onChange={(e) => {
                    const lvl = Number(e.target.value)
                    if (lvl === 0) editor.chain().focus().setParagraph().run()
                    else editor.chain().focus().setHeading({ level: lvl as 1 | 2 | 3 | 4 | 5 | 6 }).run()
                  }}
                  className="h-8 px-2 rounded-[9px] bg-surface-2 border border-outline/70 text-[12px] text-on-surface outline-none cursor-pointer mr-0.5"
                >
                  <option value={0}>正文</option>
                  {[1, 2, 3, 4, 5, 6].map((l) => (
                    <option key={l} value={l}>H{l} 标题</option>
                  ))}
                </select>
                <ToolBtn label="加粗" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></ToolBtn>
                <ToolBtn label="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></ToolBtn>
                <ToolBtn label="删除线" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={15} /></ToolBtn>
                <ToolBtn label="高亮（黄色）" active={editor.isActive('hl')} onClick={() => editor.chain().focus().toggleMark('hl', { color: 'yellow' }).run()}><Highlighter size={15} /></ToolBtn>
                <span className="w-px h-5 bg-outline mx-1" />
                <ToolBtn label="无序列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></ToolBtn>
                <ToolBtn label="有序列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} /></ToolBtn>
                <ToolBtn label="待办清单" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}><CheckSquare size={15} /></ToolBtn>
                <ToolBtn label="引用" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={15} /></ToolBtn>
                <ToolBtn label="代码块" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code size={15} /></ToolBtn>
                <ToolBtn label="插入表格 (3×3)" active={isCursorInTable(editor.state)} onClick={() => editor.chain().focus().insertGfmTable({ rows: 3, cols: 3 }).run()}><Table2 size={15} /></ToolBtn>
                <ToolBtn label="行内公式 ($...$)" onClick={() => editor.chain().focus().insertInlineMath('').run()}><span className="text-[12px] font-mono font-semibold">$</span></ToolBtn>
                <ToolBtn label="公式块 ($$...$$)" onClick={() => editor.chain().focus().insertMathBlock('').run()}><Sigma size={15} /></ToolBtn>
                <ToolBtn label="插入图片（也可直接粘贴或拖入）" onClick={() => imageInputRef.current?.click()}><ImagePlus size={15} /></ToolBtn>
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
              </>
            )}

            <div className="ml-auto flex items-center gap-0.5 pl-2 shrink-0">
              <ToolBtn label="查找与替换 (Ctrl+F / Ctrl+H)" active={findReplace.open} onClick={() => findReplace.openFind(true)}>
                <Search size={15} />
              </ToolBtn>
              <ToolBtn label={outlineOpen ? '收起实时大纲' : '展开实时大纲'} active={outlineOpen} onClick={() => setOutlineOpen((v) => !v)}>
                <ListTree size={15} />
              </ToolBtn>
              {!sourceMode && (
                <>
                  <ToolBtn label={focusMode ? '关闭专注模式' : '专注模式（突出当前段）'} active={focusMode} onClick={() => setFocusMode((v) => !v)}>
                    <Focus size={15} />
                  </ToolBtn>
                  <button
                    type="button"
                    aria-label={typewriterMode ? '关闭打字机居中' : '打字机模式（光标行居中）'}
                    title="打字机模式（光标保持在屏幕中部）"
                    onClick={() => setTypewriterMode((v) => !v)}
                    className={cn(
                      'h-7 px-2 rounded-[8px] text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap',
                      typewriterMode ? 'bg-primary-soft text-primary' : 'text-on-surface-2 hover:bg-surface-3 hover:text-on-surface',
                    )}
                  >
                    打字机
                  </button>
                </>
              )}
              <ToolBtn label="切换源码模式" active={sourceMode} onClick={toggleSourceMode}>
                <Code2 size={15} />
              </ToolBtn>
            </div>
          </div>

          {!sourceMode && isCursorInTable(editor.state) && (
            <div className="flex items-center gap-1 px-3 md:px-6 py-1 border-t border-outline/40 bg-surface-2/50 text-[11px] overflow-x-auto">
              <span className="text-on-surface-2 mr-1">表格操作：</span>
              <button type="button" onClick={() => editor.chain().focus().addTableRowBefore().run()} className="h-6 px-2 rounded hover:bg-surface-3 cursor-pointer">+上行</button>
              <button type="button" onClick={() => editor.chain().focus().addTableRowAfter().run()} className="h-6 px-2 rounded hover:bg-surface-3 cursor-pointer">+下行</button>
              <button type="button" onClick={() => editor.chain().focus().deleteTableRow().run()} className="h-6 px-2 rounded hover:bg-surface-3 cursor-pointer">-删行</button>
              <span className="w-px h-3.5 bg-outline mx-1" />
              <button type="button" onClick={() => editor.chain().focus().addTableColumnBefore().run()} className="h-6 px-2 rounded hover:bg-surface-3 cursor-pointer">+左列</button>
              <button type="button" onClick={() => editor.chain().focus().addTableColumnAfter().run()} className="h-6 px-2 rounded hover:bg-surface-3 cursor-pointer">+右列</button>
              <button type="button" onClick={() => editor.chain().focus().deleteTableColumn().run()} className="h-6 px-2 rounded hover:bg-surface-3 cursor-pointer">-删列</button>
              <span className="w-px h-3.5 bg-outline mx-1" />
              <button type="button" onClick={() => editor.chain().focus().deleteGfmTable().run()} className="h-6 px-2 rounded text-danger hover:bg-danger/10 cursor-pointer">删表格</button>
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
          <div className="mx-auto w-full max-w-[820px] px-5 md:px-12 py-8 min-h-full">
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
          if (!open) {
            pendingLeaveRef.current = null
            setLeaveOpen(false)
          }
        }}
        title="有未保存的修改"
        description="离开当前文档前，是否先保存你的更改？"
      >
        <div className="flex flex-wrap justify-end gap-2 mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              pendingLeaveRef.current = null
              setLeaveOpen(false)
            }}
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
              setLeaveOpen(false)
              const proceed = pendingLeaveRef.current
              pendingLeaveRef.current = null
              proceed?.()
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
                if (!ok) return
                setLeaveOpen(false)
                const proceed = pendingLeaveRef.current
                pendingLeaveRef.current = null
                proceed?.()
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
