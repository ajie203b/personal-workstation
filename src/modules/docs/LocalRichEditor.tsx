import { useLayoutEffect, useRef, useState, type ReactNode, type MutableRefObject } from 'react'
import { Node, type Editor, type JSONContent } from '@tiptap/core'
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react'
import { DOMParser as ProseMirrorParser } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Markdown } from 'tiptap-markdown'
import { Bold, Code, Highlighter, Italic, List, ListOrdered, Quote, Redo2, Undo2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { MarkdownContent, splitMdBlocks } from './MdReader'
import { MarkdownWordCount } from './MarkdownWordCount'
import { HighlightMark } from './mdHighlight'
import { captureLocalPosition, restoreLocalPosition, type LocalScrollPosition } from './localScrollPosition'

type RenderImage = (src: string | undefined, alt: string | undefined) => ReactNode
type MarkdownStorage = { getMarkdown: () => string; parser: { parse: (markdown: string) => string } }
const storage = (editor: Editor) => (editor.storage as unknown as { markdown: MarkdownStorage }).markdown

function MarkdownBlockView({ node, updateAttributes, extension }: NodeViewProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const source: string = node.attrs.source
  const renderImage: RenderImage | undefined = extension.options.renderImage
  const reference = /^ {0,3}\[[^\]]+\]:/.test(source)
  return <NodeViewWrapper contentEditable={false} className="relative group">
    {reference ? <p className="text-xs text-on-surface-2 break-all">{source}</p> : <MarkdownContent source={source + extension.options.getDefinitions()} onLink={() => {}} renderImage={renderImage} />}
    <button type="button" aria-label="编辑块源码" className="absolute right-0 top-0 px-2 py-1 rounded border border-outline bg-surface text-xs text-on-surface-2" onClick={() => setDraft(source)}>编辑源码</button>
    <Dialog open={draft !== null} onOpenChange={open => { if (!open) setDraft(null) }} title="编辑 Markdown 源码">
      <textarea aria-label="Markdown 块源码" className="w-full min-h-36 border border-outline rounded p-2 font-mono text-sm" value={draft ?? ''} onChange={e => setDraft(e.target.value)} />
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={() => setDraft(null)}>取消</Button>
        <Button variant="primary" onClick={() => { updateAttributes({ source: draft ?? '' }); setDraft(null) }}>应用</Button>
      </div>
    </Dialog>
  </NodeViewWrapper>
}

const MarkdownBlock = Node.create<{ renderImage?: RenderImage; getDefinitions: () => string }>({
  name: 'markdownBlock',
  group: 'block',
  atom: true,
  addOptions: () => ({ getDefinitions: () => '' }),
  addAttributes: () => ({ source: { default: '', parseHTML: el => el.getAttribute('data-markdown-source') ?? '', renderHTML: attrs => ({ 'data-markdown-source': attrs.source }) } }),
  parseHTML: () => [{ tag: 'div[data-markdown-source]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', HTMLAttributes],
  addNodeView: () => ReactNodeViewRenderer(MarkdownBlockView),
  addStorage: () => ({
    markdown: {
      serialize: (state: { write: (value: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { source: string } }) => {
        state.write(node.attrs.source)
        state.closeBlock(node)
      },
    },
  }),
})

function loadMarkdown(editor: Editor, markdown: string, definitions: MutableRefObject<string>) {
  const blocks = splitMdBlocks(markdown)
  definitions.current = blocks.filter(b => /^ {0,3}\[[^\]]+\]:/.test(b.source)).map(b => b.source).join('\n\n')
  let prefix = 'KAIROSMARKDOWNBLOCK'
  while (markdown.includes(prefix)) prefix += 'X'
  const raw = new Map<string, string>()
  const prepared = blocks.map(({ source, complex }, index) => {
    if (!complex) return source
    const key = prefix + index
    raw.set(key, source)
    return key
  }).join('\n\n')
  const template = document.createElement('template')
  template.innerHTML = storage(editor).parser.parse(prepared)
  const parsed = ProseMirrorParser.fromSchema(editor.schema).parse(template.content)
  const content: JSONContent[] = []
  parsed.forEach(node => {
    const source = node.type.name === 'paragraph' ? raw.get(node.textContent) : undefined
    content.push(source === undefined ? node.toJSON() : { type: MarkdownBlock.name, attrs: { source } })
  })
  editor.commands.setContent({ type: 'doc', content }, { emitUpdate: false })
}

function ToolBtn({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} aria-pressed={active}
    className={cn('grid place-items-center w-8 h-8 shrink-0 rounded-lg text-on-surface-2 hover:bg-surface-3', active && 'bg-primary-soft text-primary')}
    onClick={onClick}>{children}</button>
}

export function LocalRichEditor({ markdown, onChange, renderImage, scrollRef, initialPosition }: {
  markdown: string
  onChange: (md: string) => void
  renderImage?: RenderImage
  scrollRef: MutableRefObject<HTMLElement | null>
  initialPosition?: LocalScrollPosition
}) {
  const [mode, setMode] = useState<'rich' | 'source'>('rich')
  const [fontSize, setFontSize] = useState(17)
  const loaded = useRef<string>()
  const editingPosition = useRef(initialPosition)
  const imageRenderer = useRef(renderImage)
  imageRenderer.current = renderImage
  const definitionsRef = useRef('')
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Image.configure({ inline: true, allowBase64: true }),
      HighlightMark,
      MarkdownBlock.configure({ renderImage: (src, alt) => imageRenderer.current?.(src, alt) ?? <img src={src} alt={alt} />, getDefinitions: () => '\n\n' + definitionsRef.current }),
      Markdown.configure({ html: false, breaks: false, transformPastedText: true, transformCopiedText: true }),
    ],
    content: '',
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor }) => {
      const next = storage(editor).getMarkdown()
      loaded.current = next
      onChange(next)
    },
    editorProps: { attributes: { class: 'md-body outline-none min-h-[55vh]', spellcheck: 'false', 'aria-label': 'Markdown 编辑区' } },
  })

  useLayoutEffect(() => {
    if (!editor || mode !== 'rich' || loaded.current === markdown) return
    let active = true
    queueMicrotask(() => {
      if (!active || editor.isDestroyed) return
      loadMarkdown(editor, markdown, definitionsRef)
      loaded.current = markdown
    })
    return () => { active = false }
  }, [editor, markdown, mode])

  useLayoutEffect(() => {
    const position = editingPosition.current
    if (!position || (mode === 'rich' && !editor)) return
    const id = requestAnimationFrame(() => {
      const view = scrollRef.current
      if (view) restoreLocalPosition(view, position, mode === 'rich' ? view.querySelector('.tiptap') : null)
      editingPosition.current = undefined
    })
    return () => cancelAnimationFrame(id)
  }, [mode, editor, scrollRef])

  function toggleMode() {
    const view = scrollRef.current
    if (view) editingPosition.current = captureLocalPosition(view)
    setMode(mode === 'rich' ? 'source' : 'rich')
  }

  return <div className="flex-1 min-h-0 flex flex-col">
    <div className="shrink-0 flex flex-wrap items-center gap-1 px-3 py-1.5 border-b border-outline/60" role="toolbar" aria-label="文档编辑工具">
      <Button size="sm" aria-label="切换源码模式" onClick={toggleMode}>{mode === 'rich' ? '源码' : '富文本'}</Button>
      {mode === 'rich' && editor && <>
        <ToolBtn label="撤销" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={15} /></ToolBtn>
        <ToolBtn label="重做" onClick={() => editor.chain().focus().redo().run()}><Redo2 size={15} /></ToolBtn>
        <select aria-label="标题级别" className="bg-surface border border-outline rounded-md px-1.5 h-8 text-sm"
          value={[1, 2, 3, 4, 5, 6].find(level => editor.isActive('heading', { level })) ?? 0}
          onChange={e => {
            const level = Number(e.target.value) as 0 | 1 | 2 | 3 | 4 | 5 | 6
            if (level) editor.chain().focus().setHeading({ level }).run()
            else editor.chain().focus().setParagraph().run()
          }}>
          <option value={0}>正文</option>{[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={level}>标题 {level}</option>)}
        </select>
        <ToolBtn label="加粗" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></ToolBtn>
        <ToolBtn label="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></ToolBtn>
        <ToolBtn label="高亮" active={editor.isActive('hl')} onClick={() => editor.chain().focus().toggleMark('hl').run()}><Highlighter size={15} /></ToolBtn>
        <ToolBtn label="无序列表" onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></ToolBtn>
        <ToolBtn label="有序列表" onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} /></ToolBtn>
        <ToolBtn label="引用" onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={15} /></ToolBtn>
        <ToolBtn label="代码块" onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code size={15} /></ToolBtn>
      </>}
      <label className="ml-auto flex items-center gap-1 text-xs text-on-surface-2">显示字号
        <select aria-label="显示字号" className="bg-surface border border-outline rounded-md px-1.5 h-8" value={fontSize} onChange={e => setFontSize(Number(e.target.value))}>
          {[14, 16, 17, 18, 20, 24, 28, 32].map(px => <option key={px}>{px}</option>)}
        </select>
      </label>
    </div>
    {mode === 'source' ? <textarea ref={el => { scrollRef.current = el }} value={markdown} onChange={e => onChange(e.target.value)}
      className="flex-1 min-h-0 w-full resize-none bg-surface px-6 md:px-12 py-8 font-mono leading-7 outline-none" style={{ fontSize }} spellCheck={false} aria-label="编辑 Markdown 原文" />
      : <div ref={el => { scrollRef.current = el }} className="flex-1 min-h-0 overflow-y-auto">
        <div className="reader-prose mx-auto py-8 min-w-0" style={{ ['--reader-width' as string]: '90%', fontSize }}><EditorContent editor={editor} /></div>
      </div>}
    <MarkdownWordCount markdown={markdown} />
  </div>
}
