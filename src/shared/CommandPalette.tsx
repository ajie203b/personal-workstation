import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router'
import {
  CalendarCheck, FileText, ListTodo, Moon, Plus, Search, Settings2, Sun,
} from 'lucide-react'
import { db } from '@/db/db'
import { useUi, togglePalette } from '@/stores/ui'
import { useTasksUi } from '@/stores/tasks'
import { cn } from '@/lib/cn'

interface PaletteItem {
  id: string
  group: '动作' | '任务' | '文档' | '全文'
  label: string
  hint?: string
  icon: React.ReactNode
  run: () => void
}

/** ⌘K 命令面板（方案 2.4/4.x）：跨模块统一检索直达 + 快捷动作 */
export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  const setOpen = useUi((s) => s.setPaletteOpen)
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const tasks = useLiveQuery(
    () => (open ? db.tasks.filter((t) => t.status !== 'done').toArray() : Promise.resolve([] as import('@/db/db').Task[])),
    [open],
    [] as import('@/db/db').Task[],
  ) as import('@/db/db').Task[]
  const docs = useLiveQuery(
    () => (open ? db.docs.toArray() : Promise.resolve([] as import('@/db/db').Doc[])),
    [open],
    [] as import('@/db/db').Doc[],
  ) as import('@/db/db').Doc[]

  // 全文命中（v1.3.1）：查询 ≥2 字符时检索 docText，直达命中页/章
  const kw = query.trim().toLowerCase()
  const fulltextHits = useLiveQuery(
    async () => {
      if (!open || kw.length < 2) return [] as { docId: string; kind: string; title: string; count: number; seg?: number; unit: string }[]
      const rows = await db.docText.toArray()
      const docByHash = new Map((await db.docs.toArray()).map((d) => [d.hash, d]))
      const out: { docId: string; kind: string; title: string; count: number; seg?: number; unit: string }[] = []
      for (const r of rows) {
        const lower = r.text.toLowerCase()
        let count = 0
        let pos = lower.indexOf(kw)
        if (pos === -1) continue
        let firstSeg: number | undefined
        if (r.segments?.length) {
          let acc = 0
          for (let i = 0; i < r.segments.length; i++) {
            acc += r.segments[i].length + 1
            if (firstSeg == null && acc > pos) firstSeg = i + 1
          }
        }
        while (pos !== -1 && count < 999) { count++; pos = lower.indexOf(kw, pos + kw.length) }
        const doc = docByHash.get(r.hash)
        if (!doc) continue
        out.push({
          docId: doc.id,
          kind: doc.kind,
          title: doc.title,
          count,
          seg: firstSeg,
          unit: doc.kind === 'pdf' ? '页' : doc.kind === 'pptx' ? '片' : doc.kind === 'epub' ? '章' : '段',
        })
        if (out.length >= 6) break
      }
      return out.sort((a, b) => b.count - a.count)
    },
    [open, kw],
    [] as { docId: string; kind: string; title: string; count: number; seg?: number; unit: string }[],
  )

  const items = useMemo<PaletteItem[]>(() => {
    const openTask = (id: string, tier: string) => {
      useTasksUi.getState().openDetail(id)
      navigate(`/tasks?tier=${tier}`)
    }
    const actions: PaletteItem[] = [
      { id: 'a-new-task', group: '动作', label: '新建任务', hint: 'N', icon: <Plus size={15} />, run: () => { navigate('/tasks'); setTimeout(() => window.dispatchEvent(new CustomEvent('ws:focus-quickadd')), 150) } },
      { id: 'a-new-doc', group: '动作', label: '写文档', hint: 'MD 编辑器', icon: <FileText size={15} />, run: () => navigate('/docs/new') },
      { id: 'a-today', group: '动作', label: '今日', icon: <CalendarCheck size={15} />, run: () => navigate('/today') },
      { id: 'a-tasks', group: '动作', label: '任务清单', icon: <ListTodo size={15} />, run: () => navigate('/tasks') },
      { id: 'a-docs', group: '动作', label: '文档工作站', icon: <FileText size={15} />, run: () => navigate('/docs') },
      { id: 'a-settings', group: '动作', label: '设置', icon: <Settings2 size={15} />, run: () => navigate('/settings') },
      {
        id: 'a-theme', group: '动作',
        label: theme === 'dark' ? '切换到浅色主题' : theme === 'light' ? '切换到深色主题' : '切换主题（当前跟随系统）',
        icon: theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />,
        run: () => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark'),
      },
    ]
    const taskItems: PaletteItem[] = (tasks ?? []).slice(0, 40).map((t) => ({
      id: `t-${t.id}`, group: '任务', label: t.title, hint: t.tier === 'today' ? '今日' : t.tier === 'upcoming' ? '近期' : t.tier === 'anytime' ? '随时' : '将来',
      icon: <ListTodo size={15} />, run: () => openTask(t.id, t.tier),
    }))
    const docItems: PaletteItem[] = (docs ?? []).slice(0, 40).map((d) => ({
      id: `d-${d.id}`, group: '文档', label: d.title, hint: d.kind.toUpperCase(),
      icon: <FileText size={15} />, run: () => navigate(`/docs/${d.id}`),
    }))
    const fulltextItems: PaletteItem[] = (kw.length >= 2 ? fulltextHits : []).map((h) => ({
      id: `ft-${h.docId}`,
      group: '全文' as const,
      label: h.title,
      hint: `${h.count} 处命中${h.seg ? ` · 第${h.seg}${h.unit}` : ''}`,
      icon: <Search size={15} />,
      run: () => navigate(h.seg && h.kind === 'pdf' ? `/docs/${h.docId}?p=p${h.seg}` : `/docs/${h.docId}`),
    }))
    return [...actions, ...taskItems, ...docItems, ...fulltextItems]
  }, [tasks, docs, fulltextHits, kw, theme, navigate, setTheme])

  // 拼音搜索：惰性加载 pinyin-pro
  const [pinyinFn, setPinyinFn] = useState<((s: string) => string) | null>(null)
  useEffect(() => {
    if (query.trim() && !pinyinFn) {
      import('pinyin-pro').then((m) => setPinyinFn(() => m.pinyin)).catch(() => {})
    }
  }, [query])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      const byGroup = (g: string, n: number) => items.filter((i) => i.group === g).slice(0, n)
      return [...byGroup('动作', 6), ...byGroup('任务', 4), ...byGroup('文档', 4)]
    }
    // 拼音匹配：把中文标题转拼音后比对
    const match = (text: string) => {
      if (text.toLowerCase().includes(q)) return true
      if (pinyinFn) {
        const py = (pinyinFn as (s: string, o?: object) => string)(text, { toneType: 'none' }).replace(/\s/g, '').toLowerCase()
        if (py.includes(q)) return true
        const initials = (pinyinFn as (s: string, o?: object) => string)(text, { pattern: 'first', toneType: 'none' }).replace(/\s/g, '').toLowerCase()
        if (initials.includes(q)) return true
      }
      return false
    }
    return items.filter((i) => i.group === '全文' || match(i.label) || (i.hint ?? '').toLowerCase().includes(q)).slice(0, 24)
  }, [items, query, pinyinFn])

  // 打开时重置
  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => { setCursor(0) }, [query])

  // 键盘：↑↓/Enter/Esc
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[cursor]
      if (item) {
        setOpen(false)
        item.run()
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // 选中项滚动到可见
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  let flatIdx = -1
  const groups: { name: PaletteItem['group']; items: PaletteItem[] }[] = []
  for (const item of filtered) {
    let g = groups.find((x) => x.name === item.group)
    if (!g) {
      g = { name: item.group, items: [] }
      groups.push(g)
    }
    g.items.push(item)
  }

  return (
    <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="pop absolute left-1/2 top-[14%] -translate-x-1/2 w-[min(600px,92vw)] overflow-hidden"
        style={{ animation: 'fade-up var(--dur-1) var(--ease-standard)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 h-13 py-3 border-b border-outline">
          <Search size={17} className="text-on-surface-2 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索任务、文档、全文，或输入动作…"
            className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-on-surface-2/70"
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {filtered.length === 0 && (
            <p className="text-center text-[13px] text-on-surface-2 py-8">没有匹配的结果</p>
          )}
          {groups.map((g) => (
            <div key={g.name} className="mb-1">
              <p className="text-[11px] text-on-surface-2 px-3 pt-2 pb-1 tracking-wide">{g.name}</p>
              {g.items.map((item) => {
                flatIdx++
                const idx = flatIdx
                return (
                  <button
                    key={item.id}
                    data-idx={idx}
                    onMouseEnter={() => setCursor(idx)}
                    onClick={() => { setOpen(false); item.run() }}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 h-10 rounded-[10px] text-left cursor-pointer transition-colors',
                      idx === cursor ? 'bg-primary-soft text-primary' : 'text-on-surface hover:bg-surface-3',
                    )}
                  >
                    <span className={cn('shrink-0', idx === cursor ? 'text-primary' : 'text-on-surface-2')}>{item.icon}</span>
                    <span className="text-[13px] truncate flex-1">{item.label}</span>
                    {item.hint && <span className="text-[11px] text-on-surface-2 shrink-0">{item.hint}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 px-4 py-2 border-t border-outline text-[11px] text-on-surface-2">
          <span><kbd className="kbd">↑↓</kbd> 选择</span>
          <span><kbd className="kbd">↵</kbd> 打开</span>
          <span className="ml-auto"><kbd className="kbd">Ctrl K</kbd> 呼出/关闭</span>
        </div>
      </div>
    </div>
  )
}

// 供 GlobalHotkeys 引用
export { togglePalette }
