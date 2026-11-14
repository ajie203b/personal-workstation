import type { Editor } from '@tiptap/core'

export function executeSlashCommand(editor: Editor, id: string, range: { from: number; to: number }): void {
  const chain = editor.chain().focus().deleteRange(range)
  switch (id) {
    case 'h1':
      chain.setHeading({ level: 1 }).run()
      break
    case 'h2':
      chain.setHeading({ level: 2 }).run()
      break
    case 'h3':
      chain.setHeading({ level: 3 }).run()
      break
    case 'h4':
      chain.setHeading({ level: 4 }).run()
      break
    case 'h5':
      chain.setHeading({ level: 5 }).run()
      break
    case 'h6':
      chain.setHeading({ level: 6 }).run()
      break
    case 'task':
      chain.toggleTaskList().run()
      break
    case 'bullet':
      chain.toggleBulletList().run()
      break
    case 'ordered':
      chain.toggleOrderedList().run()
      break
    case 'quote':
      chain.toggleBlockquote().run()
      break
    case 'table':
      chain.insertGfmTable({ rows: 3, cols: 3 }).run()
      break
    case 'mathBlock':
      chain.insertMathBlock('').run()
      break
    case 'inlineMath':
      chain.insertInlineMath('').run()
      break
    case 'code':
      chain.toggleCodeBlock().run()
      break
    case 'mermaid':
      chain
        .setCodeBlock({ language: 'mermaid' })
        .insertContent('flowchart TD\n  A[开始] --> B[处理]')
        .run()
      break
    case 'hr':
      chain.setHorizontalRule().run()
      break
  }
}

export function scrollEditorToHeading(container: HTMLElement | null, headingIndex: number): void {
  if (!container) return
  const headings = container.querySelectorAll('.tiptap h1, .tiptap h2, .tiptap h3, .tiptap h4, .tiptap h5, .tiptap h6')
  const el = headings[headingIndex] as HTMLElement | undefined
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
