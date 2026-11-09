import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Markdown } from 'tiptap-markdown'
import { Bold, Check, Code, Heading2, Heading3, Highlighter, Italic, List, ListOrdered, Quote, Redo2, Undo2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { MarkdownContent, splitMdBlocks } from './MdReader'
import { MarkdownWordCount } from './MarkdownWordCount'
import { HL_COLORS, HighlightMark, type HlColor } from './mdHighlight'

const TOOL_BTN = 'grid place-items-center w-7 h-7 rounded-[8px] text-on-surface-2 hover:bg-surface-3 hover:text-on-surface transition-colors cursor-pointer'
const TOOL_ON = 'bg-primary-soft text-primary'
const HL_LABEL: Record<HlColor, string> = { yellow: '黄色', green: '绿色', blue: '蓝色', red: '红色' }

const getMd = (editor: Editor | null) => (editor?.storage as { markdown?: { getMarkdown: () => string } } | undefined)?.markdown?.getMarkdown() ?? ''
const join = (blocks: { source: string }[]) => blocks.map(b => b.source).join('\n\n')

function ToolBtn({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} className={cn(TOOL_BTN, active && TOOL_ON)} onClick={onClick}>{children}</button>
}

/** 单个普通块的富文本编辑：与写文档同款 TipTap，更新即回传 markdown。 */
function BlockTipTap({ source, onUpdate, onDone }: { source: string; onUpdate: (md: string) => void; onDone: () => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: true }),
      HighlightMark,
      Markdown.configure({ html: false, breaks: true, transformPastedText: true, transformCopiedText: true }),
    ],
    content: source,
    onUpdate: ({ editor }) => onUpdate(getMd(editor)),
    editorProps: { attributes: { class: 'md-body outline-none min-h-[3rem] px-2 py-1', spellcheck: 'false' } },
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])

  if (!editor) return null
  return <div className="rounded-lg border border-primary/50 bg-surface shadow-sm">
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-outline/60 overflow-x-auto">
      <ToolBtn label="撤销" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={14} /></ToolBtn>
      <ToolBtn label="重做" onClick={() => editor.chain().focus().redo().run()}><Redo2 size={14} /></ToolBtn>
      <span className="w-px h-4 bg-outline mx-1" />
      <ToolBtn label="二级标题" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={14} /></ToolBtn>
      <ToolBtn label="三级标题" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={14} /></ToolBtn>
      <ToolBtn label="加粗" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={14} /></ToolBtn>
      <ToolBtn label="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={14} /></ToolBtn>
      <ToolBtn label="高亮（黄色）" active={editor.isActive('hl')} onClick={() => editor.chain().focus().toggleMark('hl', { color: 'yellow' }).run()}><Highlighter size={14} /></ToolBtn>
      <span className="w-px h-4 bg-outline mx-1" />
      <ToolBtn label="无序列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={14} /></ToolBtn>
      <ToolBtn label="有序列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={14} /></ToolBtn>
      <ToolBtn label="引用" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={14} /></ToolBtn>
      <ToolBtn label="代码块" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code size={14} /></ToolBtn>
      <button type="button" aria-label="完成块编辑" title="完成（Esc）" className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[12px] text-primary hover:bg-primary-soft cursor-pointer" onClick={onDone}><Check size={14} />完成</button>
    </div>
    <BubbleMenu editor={editor} options={{ placement: 'top', offset: 8 }} shouldShow={({ state }) => state.selection.from !== state.selection.to && state.doc.textBetween(state.selection.from, state.selection.to, '\n').trim().length > 0}>
      <div className="pop flex items-center gap-1 p-1.5">
        {HL_COLORS.map(c => <button key={c} type="button" aria-label={`高亮：${HL_LABEL[c]}`} title={HL_LABEL[c]} onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().toggleMark('hl', { color: c }).run()} className={`w-6 h-6 rounded-full hl-${c} border border-outline/60 cursor-pointer`} />)}
      </div>
    </BubbleMenu>
    <EditorContent editor={editor} />
  </div>
}

/**
 * 资源管理器编辑态：默认阅读式富文本（块级），表格/公式/图表/HTML 以渲染预览呈现、
 * 仅通过块源码编辑，保证保存不丢内容；另提供整篇源码切换作为兜底。
 */
export function LocalRichEditor({ markdown, onChange, renderImage }: {
  markdown: string
  onChange: (md: string) => void
  renderImage?: (src: string | undefined, alt: string | undefined) => ReactNode
}) {
  const [mode, setMode] = useState<'rich' | 'source'>('rich')
  const [blocks, setBlocks] = useState(() => splitMdBlocks(markdown))
  const blocksRef = useRef(blocks)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [sourceIndex, setSourceIndex] = useState<number | null>(null)

  const updateBlocks = useCallback((next: { source: string; complex: boolean }[]) => { blocksRef.current = next; setBlocks(next) }, [])

  // 外部 reload / 首次灌入：仅当与当前块拼接结果不同才重切，避免自身回传触发重建
  useEffect(() => {
    if (join(blocksRef.current) === markdown) return
    updateBlocks(splitMdBlocks(markdown))
    setEditingIndex(null)
    setSourceIndex(null)
  }, [markdown, updateBlocks])

  const updateBlock = useCallback((i: number, source: string) => {
    const next = blocksRef.current.map((b, idx) => idx === i ? { ...b, source } : b)
    updateBlocks(next)
    onChange(join(next))
  }, [onChange, updateBlocks])

  return <div className="flex-1 min-h-0 flex flex-col">
    <div className="shrink-0 flex items-center gap-2 px-4 md:px-8 py-1.5 border-b border-outline/60">
      <button
        type="button"
        aria-label="切换源码模式"
        className="rounded-lg border border-outline px-2.5 py-1 text-[12px] text-on-surface-2 hover:bg-surface-2 cursor-pointer"
        onClick={() => setMode(m => m === 'rich' ? 'source' : 'rich')}
      >
        {mode === 'rich' ? '源码' : '富文本'}
      </button>
      <span className="text-[11px] text-on-surface-2">{mode === 'rich' ? '点击段落富文本编辑；表格 / 公式 / 图表点「源码」修改，保存不丢内容' : '整篇 Markdown 源码'}</span>
    </div>
    {mode === 'source' ? (
      <textarea
        value={markdown}
        onChange={e => onChange(e.target.value)}
        className="flex-1 min-h-0 w-full resize-none bg-surface px-6 md:px-12 py-8 font-mono text-[13.5px] leading-7 text-on-surface outline-none"
        spellCheck={false}
        autoFocus
        aria-label="编辑 Markdown 原文"
      />
    ) : (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="reader-prose mx-auto py-8 min-w-0" style={{ ['--reader-width' as string]: '90%' }}>
          <div className="md-body flex flex-col gap-2">
            {blocks.map((b, i) => (
              <div key={i} className="relative">
                {editingIndex === i && !b.complex ? (
                  <BlockTipTap source={b.source} onUpdate={md => updateBlock(i, md)} onDone={() => setEditingIndex(null)} />
                ) : sourceIndex === i ? (
                  <div className="rounded-lg border border-primary/50 bg-surface shadow-sm">
                    <textarea
                      value={b.source}
                      onChange={e => updateBlock(i, e.target.value)}
                      className="w-full resize-y bg-surface px-3 py-2 font-mono text-[12.5px] leading-6 text-on-surface outline-none rounded-t-lg"
                      rows={Math.min(16, Math.max(3, b.source.split('\n').length + 1))}
                      spellCheck={false}
                      autoFocus
                      aria-label="编辑块源码"
                    />
                    <div className="flex justify-end px-2 py-1 border-t border-outline/60">
                      <button type="button" className="inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[12px] text-primary hover:bg-primary-soft cursor-pointer" onClick={() => setSourceIndex(null)}><Check size={14} />完成</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className="cursor-text rounded-lg px-2 py-1 hover:bg-surface-2/70 transition-colors"
                      title={b.complex ? '点击编辑源码' : '点击富文本编辑'}
                      onClick={() => b.complex ? setSourceIndex(i) : setEditingIndex(i)}
                    >
                      <MarkdownContent source={b.source} onLink={() => {}} renderImage={renderImage} />
                    </div>
                    {b.complex && <button type="button" aria-label="编辑块源码" className="absolute top-1 right-1 rounded-md border border-outline bg-surface px-1.5 py-0.5 text-[11px] text-on-surface-2 hover:bg-surface-2 cursor-pointer" onClick={() => setSourceIndex(i)}>源码</button>}
                  </>
                )}
              </div>
            ))}
            {!blocks.length && <button type="button" className="self-start rounded-lg border border-outline px-3 py-1.5 text-[13px] text-on-surface-2 hover:bg-surface-2 cursor-pointer" onClick={() => { updateBlocks([{ source: '', complex: false }]); setEditingIndex(0) }}>开始书写</button>}
          </div>
        </div>
      </div>
    )}
    <MarkdownWordCount markdown={markdown} />
  </div>
}
