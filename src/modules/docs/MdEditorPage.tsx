import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import {
  ArrowLeft, Bold, Code, Heading2, Heading3, Italic, List, ListOrdered, Quote, Redo2, Save, Undo2,
} from 'lucide-react'
import { db, type Doc } from '@/db/db'
import { useUi } from '@/stores/ui'
import { Button } from '@/shared/ui/Button'
import { uid } from '@/lib/id'
import { cn } from '@/lib/cn'

const TOOLBAR_BTN = 'grid place-items-center w-8 h-8 rounded-[10px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer'
const TOOLBAR_ON = 'bg-primary-soft text-primary'

/** MD 编辑器（M2.5 · TipTap）：新建 / 编辑 Markdown 文档，保存为本地文档 */
export function MdEditorPage() {
  const { docId } = useParams()
  const navigate = useNavigate()
  const toast = useUi((s) => s.toast)
  const [existing, setExisting] = useState<Doc | null>(null)
  const [title, setTitle] = useState('')
  const [ready, setReady] = useState(false)
  const [contentSeed, setContentSeed] = useState<string | null>(null)
  const savedHashRef = useRef<string | null>(null)
  const saveRef = useRef<(() => Promise<void>) | null>(null)

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
      Markdown.configure({
        html: false,
        breaks: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'md-body outline-none min-h-full pb-24',
        spellcheck: 'false',
      },
    },
  })

  // 内容就绪后一次性灌入（避免编辑器重建）
  useEffect(() => {
    if (editor && contentSeed != null) {
      editor.commands.setContent(contentSeed)
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

  const save = useCallback(async () => {
    if (!editor) return
    const md = (editor.storage as { markdown?: { getMarkdown: () => string } }).markdown?.getMarkdown() ?? ''
    if (!md.trim()) {
      toast('内容为空')
      return
    }
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
      toast('文档已创建')
    }
  }, [editor, existing, title, toast])
  saveRef.current = save

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  return (
    <div className="h-full flex flex-col bg-surface">
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
          onChange={(e) => setTitle(e.target.value)}
          placeholder="文档标题"
          className="flex-1 min-w-0 bg-transparent outline-none text-[15px] font-semibold"
        />
        <Button variant="primary" size="sm" onClick={() => void save()}>
          <Save size={14} /> 保存
        </Button>
      </header>

      {/* 工具栏 */}
      {editor && (
        <div className="shrink-0 flex items-center gap-0.5 px-3 md:px-6 py-1.5 border-b border-outline/60 overflow-x-auto">
          <button aria-label="撤销" className={TOOLBAR_BTN} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={15} /></button>
          <button aria-label="重做" className={TOOLBAR_BTN} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={15} /></button>
          <span className="w-px h-5 bg-outline mx-1" />
          <button
            aria-label="二级标题"
            className={cn(TOOLBAR_BTN, editor.isActive('heading', { level: 2 }) && TOOLBAR_ON)}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          ><Heading2 size={15} /></button>
          <button
            aria-label="三级标题"
            className={cn(TOOLBAR_BTN, editor.isActive('heading', { level: 3 }) && TOOLBAR_ON)}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          ><Heading3 size={15} /></button>
          <button
            aria-label="加粗"
            className={cn(TOOLBAR_BTN, editor.isActive('bold') && TOOLBAR_ON)}
            onClick={() => editor.chain().focus().toggleBold().run()}
          ><Bold size={15} /></button>
          <button
            aria-label="斜体"
            className={cn(TOOLBAR_BTN, editor.isActive('italic') && TOOLBAR_ON)}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          ><Italic size={15} /></button>
          <span className="w-px h-5 bg-outline mx-1" />
          <button
            aria-label="无序列表"
            className={cn(TOOLBAR_BTN, editor.isActive('bulletList') && TOOLBAR_ON)}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          ><List size={15} /></button>
          <button
            aria-label="有序列表"
            className={cn(TOOLBAR_BTN, editor.isActive('orderedList') && TOOLBAR_ON)}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          ><ListOrdered size={15} /></button>
          <button
            aria-label="引用"
            className={cn(TOOLBAR_BTN, editor.isActive('blockquote') && TOOLBAR_ON)}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          ><Quote size={15} /></button>
          <button
            aria-label="代码块"
            className={cn(TOOLBAR_BTN, editor.isActive('codeBlock') && TOOLBAR_ON)}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          ><Code size={15} /></button>
          <span className="ml-auto text-[11px] text-on-surface-2 pr-1 shrink-0">Markdown 自动序列化</span>
        </div>
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
