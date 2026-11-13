import { useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/core'
import {
  CheckSquare, Code, GitBranch, Heading1, Heading2, Heading3, Heading4,
  List, ListOrdered, Minus, Quote, Sigma, Table2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SlashTriggerState {
  query: string
  range: { from: number; to: number }
}

export interface SlashCommandItem {
  id: string
  label: string
  hint: string
  keywords: string[]
  icon: LucideIcon
}

export const SLASH_COMMANDS: SlashCommandItem[] = [
  { id: 'h1', label: '一级标题', hint: 'H1', keywords: ['h1', 'heading', 'biaoti', '标题'], icon: Heading1 },
  { id: 'h2', label: '二级标题', hint: 'H2', keywords: ['h2', 'heading', '标题'], icon: Heading2 },
  { id: 'h3', label: '三级标题', hint: 'H3', keywords: ['h3', 'heading', '标题'], icon: Heading3 },
  { id: 'h4', label: '四级标题', hint: 'H4', keywords: ['h4', 'heading', '标题'], icon: Heading4 },
  { id: 'task', label: '待办清单', hint: '- [ ]', keywords: ['todo', 'task', 'check', '待办', '清单'], icon: CheckSquare },
  { id: 'bullet', label: '无序列表', hint: '- ', keywords: ['ul', 'list', 'bullet', '列表'], icon: List },
  { id: 'ordered', label: '有序列表', hint: '1. ', keywords: ['ol', 'ordered', 'number', '编号'], icon: ListOrdered },
  { id: 'quote', label: '引用块', hint: '> ', keywords: ['quote', 'blockquote', '引用'], icon: Quote },
  { id: 'table', label: '表格 (3×3)', hint: 'Table', keywords: ['table', 'grid', 'biaoge', '表格'], icon: Table2 },
  { id: 'mathBlock', label: '公式块', hint: '$$', keywords: ['math', 'latex', 'formula', '公式'], icon: Sigma },
  { id: 'inlineMath', label: '行内公式', hint: '$...$', keywords: ['inline', 'math', '公式'], icon: Sigma },
  { id: 'code', label: '代码块', hint: '```', keywords: ['code', 'fence', '代码'], icon: Code },
  { id: 'mermaid', label: 'Mermaid 图表', hint: 'Diagram', keywords: ['mermaid', 'diagram', 'chart', 'flow', '流程图'], icon: GitBranch },
  { id: 'hr', label: '分割线', hint: '---', keywords: ['hr', 'divider', '分割'], icon: Minus },
]

export function detectSlashTrigger(editor: Editor): SlashTriggerState | null {
  const { selection } = editor.state
  if (!selection.empty) return null
  const { $from } = selection
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\ufffc', '\ufffc')
  const match = textBefore.match(/(?:^|\s)\/([^\s/\ufffc]*)$/)
  if (!match) return null
  const slashLen = match[1].length + 1
  return {
    query: match[1].toLowerCase(),
    range: { from: $from.pos - slashLen, to: $from.pos },
  }
}

export function filterSlashCommands(items: readonly SlashCommandItem[], query: string): SlashCommandItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...items]
  return items.filter(
    (item) =>
      item.id.toLowerCase().includes(q)
      || item.label.toLowerCase().includes(q)
      || item.keywords.some((k) => k.toLowerCase().includes(q)),
  )
}

export function SlashCommandMenu({
  editor,
  trigger,
  allowedIds,
  onExecute,
  onDismiss,
}: {
  editor: Editor
  trigger: SlashTriggerState | null
  allowedIds?: Set<string>
  onExecute: (id: string, range: { from: number; to: number }) => void
  onDismiss: () => void
}) {
  const [activeIdx, setActiveIdx] = useState(0)

  const items = useMemo(() => {
    const base = allowedIds ? SLASH_COMMANDS.filter((c) => allowedIds.has(c.id)) : SLASH_COMMANDS
    return filterSlashCommands(base, trigger?.query ?? '')
  }, [allowedIds, trigger?.query])

  useEffect(() => {
    setActiveIdx(0)
  }, [trigger?.query, items.length])

  useEffect(() => {
    if (!trigger || !items.length) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setActiveIdx((i) => (i + 1) % items.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setActiveIdx((i) => (i - 1 + items.length) % items.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        const picked = items[Math.min(activeIdx, items.length - 1)]
        if (picked) onExecute(picked.id, trigger.range)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onDismiss()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [trigger, items, activeIdx, onExecute, onDismiss])

  const pos = useMemo(() => {
    if (!trigger) return null
    try {
      const coords = editor.view.coordsAtPos(trigger.range.to)
      const below = coords.bottom + 260 < window.innerHeight
      return {
        left: Math.min(Math.max(coords.left, 16), Math.max(16, window.innerWidth - 236)),
        top: below ? coords.bottom + 6 : Math.max(12, coords.top - 252),
      }
    } catch {
      return null
    }
  }, [editor, trigger])

  if (!trigger || !pos || !items.length) return null

  return (
    <div
      role="listbox"
      aria-label="斜杠命令"
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 w-56 max-h-60 overflow-y-auto rounded-[12px] border border-outline bg-surface p-1 shadow-[var(--shadow-pop)]"
    >
      {items.map((item, idx) => {
        const Icon = item.icon
        const active = idx === activeIdx
        return (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={active}
            onMouseDown={(e) => {
              e.preventDefault()
              onExecute(item.id, trigger.range)
            }}
            onMouseEnter={() => setActiveIdx(idx)}
            className={cn(
              'w-full flex items-center gap-2.5 h-8 px-2.5 rounded-[8px] text-[12.5px] text-left cursor-pointer transition-colors',
              active ? 'bg-primary-soft text-primary' : 'text-on-surface hover:bg-surface-3',
            )}
          >
            <Icon size={14} className="shrink-0" />
            <span className="flex-1 truncate">{item.label}</span>
            <span className="text-[10.5px] font-mono text-on-surface-2/80">{item.hint}</span>
          </button>
        )
      })}
    </div>
  )
}
