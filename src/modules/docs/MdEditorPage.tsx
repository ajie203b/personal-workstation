import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { BubbleMenu, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Markdown } from 'tiptap-markdown'
import {
  ArrowLeft, Bold, Code, Heading2, Heading3, Highlighter, ImagePlus, Italic, List, ListOrdered, ListPlus, Quote, Redo2, Save, Undo2,
} from 'lucide-react'
import { db, type Doc } from '@/db/db'
import { addTask } from '@/db/tasks'
import { useUi } from '@/stores/ui'
import { Button } from '@/shared/ui/Button'
import { uid } from '@/lib/id'
import { fileToDataUrl } from '@/lib/image'
import { cn } from '@/lib/cn'
import { HL_COLORS, HighlightMark, type HlColor } from './mdHighlight'

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
  const seedingRef = useRef(false)
  const savedHashRef = useRef<string | null>(null)
  const saveRef = useRef<(() => Promise<void>) | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const insertImagesRef = useRef<(files: File[]) => void>(() => {})

  // 载入待编辑文档
  useEffect(() => {
    if (!docId) {
      setTitle('无标题文档')
      setReady(true)
      return
    }
    void (async () => {
      const doc = await db.docs.get(docId)
      if (!doc || doc.kind !== 'md') {
        toast('文档不存在或不是 Markdown')
        navigate('/docs')
        return
      }
      const blob = await db.blobs.get(doc.hash)
      const md = (await blob?.blob.text()) ?? ''
      setExisting(doc)
      setTitle(doc.title)
      setContentSeed(md)
      setReady(true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  const editor = useEditor({
    extensions: [
      StarterKit,
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
    onUpdate: () => {
      if (!seedingRef.current) setDirty(true)
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
    if (editor && contentSeed != null) {
      seedingRef.current = true
      editor.commands.setContent(contentSeed)
      seedingRef.current = false
      setDirty(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // Ctrl/Cmd+S 保存 + 路由离开守卫
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

  const save = useCallback(async () => {
    if (!editor || saving) return
    const md = (editor.storage as { markdown?: { getMarkdown: () => string } }).markdown?.getMarkdown() ?? ''
    if (!md.trim()) {
      toast('内容为空')
      return
    }
    setSaving(true)
    try {
      const now = Date.now()
      if (existing) {
        await db.blobs.put({ hash: existing.hash, blob: new Blob([md], { type: 'text/markdown' }) })
        await db.docs.update(existing.id, { title: title.trim() || existing.title, size: md.length, lastOpenedAt: now })
        toast('已保存')
      } else {
        const hash = `md-${uid()}`
        const doc: Doc = {
          id: uid(),
          hash,
          title: title.trim() || '无标题文档',
          kind: 'md',
          size: md.length,
          addedAt: now,
          lastOpenedAt: now,
        }
        await db.transaction('rw', db.docs, db.blobs, async () => {
          await db.blobs.put({ hash, blob: new Blob([md], { type: 'text/markdown' }) })
          await db.docs.add(doc)
        })
        savedHashRef.current = hash
        setExisting(doc)
        toast('文档已创建')
        // 建完立刻切到「编辑这篇」的路由：否则留在 /docs/new 上再按一次保存，
        // existing 还是空，会再新建一篇一模一样的文档（连按两下就是两篇）
        navigate(`/docs/edit/${doc.id}`, { replace: true })
      }
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }, [editor, existing, title, toast, navigate, saving])
  saveRef.current = save

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
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
          onClick={() => navigate('/docs')}
          className="grid place-items-center w-10 h-10 rounded-[12px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors"
        >
          <ArrowLeft size={19} />
        </button>
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); setDirty(true) }}
          placeholder="文档标题"
          className="flex-1 min-w-0 bg-transparent outline-none text-[15px] font-semibold"
        />
        <span
          className={cn('text-[11px] sm:text-[11.5px] tabular-nums shrink-0', dirty || !existing ? 'text-p1' : 'text-on-surface-2')}
          aria-live="polite"
        >
          {saving ? '保存中…' : dirty || !existing ? '未保存' : '已保存'}
        </span>
        <Button variant="primary" size="sm" disabled={saving} onClick={() => void save()}>
          <Save size={14} /> {saving ? '保存中' : '保存'}
        </Button>
      </header>

      {/* 工具栏 */}
      {editor && (
        <div className="shrink-0 flex items-center gap-0.5 px-3 md:px-6 py-1.5 border-b border-outline/60 overflow-x-auto md:overflow-visible md:flex-wrap">
          <ToolBtn label="撤销" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={15} /></ToolBtn>
          <ToolBtn label="重做" onClick={() => editor.chain().focus().redo().run()}><Redo2 size={15} /></ToolBtn>
          <span className="w-px h-5 bg-outline mx-1" />
          <ToolBtn label="二级标题" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={15} /></ToolBtn>
          <ToolBtn label="三级标题" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={15} /></ToolBtn>
          <ToolBtn label="加粗" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></ToolBtn>
          <ToolBtn label="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></ToolBtn>
          <ToolBtn label="高亮（黄色）" active={editor.isActive('hl')} onClick={() => editor.chain().focus().toggleMark('hl', { color: 'yellow' }).run()}><Highlighter size={15} /></ToolBtn>
          <span className="w-px h-5 bg-outline mx-1" />
          <ToolBtn label="无序列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></ToolBtn>
          <ToolBtn label="有序列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} /></ToolBtn>
          <ToolBtn label="引用" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={15} /></ToolBtn>
          <ToolBtn label="代码块" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code size={15} /></ToolBtn>
          <span className="w-px h-5 bg-outline mx-1" />
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
          <span className="ml-auto text-[11px] text-on-surface-2 pr-1 shrink-0 hidden md:inline">选中文字可高亮或一键转任务</span>
        </div>
      )}

      {/* 选中文字后的浮条：四色高亮 + 转任务 */}
      {editor && (
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 120, placement: 'top' }}
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

      {/* 编辑区：全屏书写 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="w-full px-5 md:px-12 py-8">
          {ready && editor ? (
            <EditorContent editor={editor} />
          ) : (
            <p className="text-[13px] text-on-surface-2">载入中…</p>
          )}
        </div>
      </div>
    </div>
  )
}
