import { useEffect, useRef, useState } from 'react'
import { Inbox, Check } from 'lucide-react'
import type { Task } from '@/db/db'
import { useTasksUi } from '@/stores/tasks'
import { toggleTaskWithUndo } from './taskActions'
import { TaskItem } from './TaskItem'
import { EmptyState } from '@/shared/ui/EmptyState'
import { useFlipList } from '@/lib/useFlipList'
import { haptic } from '@/lib/haptics'
import { cn } from '@/lib/cn'

interface Props {
  tasks: Task[]
  emptyTitle: string
  emptyHint?: string
  /** 键盘导航作用域 id，避免多列表互相抢焦点 */
  scope: string
}

const NAV_DIR: Record<string, 1 | -1> = { ArrowDown: 1, ArrowUp: -1, j: 1, k: -1 }

/**
 * 列表视图 + 键盘流：
 * ↑↓/J K 移动选择，空格/X 勾选完成，Enter 打开详情。
 * 监听挂在 window 上并按作用域过滤——挂在 ul 上时，焦点不在列表内（刚进页面、
 * 点过卡片后又落回 body）按键事件根本不会流经 ul，键盘流会整条失效。
 */
export function TaskList({ tasks, emptyTitle, emptyHint, scope }: Props) {
  const { focusId, setFocusId, openDetail } = useTasksUi()
  const containerRef = useRef<HTMLUListElement>(null)
  // 按键处理读最新数据，避免把 tasks 塞进依赖导致每帧重绑监听
  const latest = useRef({ tasks, focusId })
  latest.current = { tasks, focusId }

  useEffect(() => {
    if (!focusId) return
    document.getElementById(`task-${focusId}`)?.scrollIntoView({ block: 'nearest' })
  }, [focusId])

  useEffect(() => {
    // 列表内容变化后，聚焦项可能已不在列表中
    if (focusId && !tasks.some((t) => t.id === focusId)) setFocusId(null)
  }, [tasks, focusId, setFocusId])

  // 完成/删除后兄弟卡片滑到新位置，而不是瞬跳
  useFlipList(containerRef, tasks)

  useEffect(() => {
    /** 移动选中项；未选中时方向键都落到第一条 */
    const move = (dir: 1 | -1) => {
      const { tasks: list, focusId: current } = latest.current
      if (!list.length) return
      const idx = list.findIndex((t) => t.id === current)
      const next = idx === -1 ? 0 : dir > 0 ? Math.min(idx + 1, list.length - 1) : Math.max(idx - 1, 0)
      setFocusId(list[next].id)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
      const { tasks: list, focusId: current } = latest.current
      if (!list.length) return
      const target = e.target as HTMLElement | null
      const inList = !!containerRef.current?.contains(target)
      // 焦点在 body（刚打开页面）时只接方向键；输入框、弹层、菜单内的按键一律不劫持
      if (!inList && target !== document.body) return

      const dir = NAV_DIR[e.key]
      if (dir) {
        e.preventDefault()
        move(dir)
        return
      }
      if (!inList) return
      const idx = list.findIndex((t) => t.id === current)
      if (idx === -1) return
      if (e.key === ' ' || e.key === 'x' || e.key === 'X') {
        e.preventDefault()
        void toggleTaskWithUndo(list[idx])
      } else if (e.key === 'Enter') {
        e.preventDefault()
        openDetail(list[idx].id)
      }
    }

    // 快速添加框里按 ↓ 交棒给列表
    const onEnterList = (ev: Event) => {
      const dir = (ev as CustomEvent<{ dir?: 1 | -1 }>).detail?.dir ?? 1
      move(dir)
      containerRef.current?.focus({ preventScroll: true })
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('ws:list-enter', onEnterList)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('ws:list-enter', onEnterList)
    }
  }, [setFocusId, openDetail])

  if (tasks.length === 0) {
    return <EmptyState icon={Inbox} title={emptyTitle} hint={emptyHint ?? '按 N 或 / 快速添加，例如「明天14:00 交报告 P1 #工作」'} />
  }

  return (
    <ul
      ref={containerRef}
      scope-data={scope}
      tabIndex={0}
      aria-label="任务列表（方向键选择，空格完成，回车详情）"
      // 点击卡片后把焦点收回列表，后续方向键/空格继续可用
      onClickCapture={() => containerRef.current?.focus({ preventScroll: true })}
      // 入场不再用 nth-child 级联（删项后位置错位，会把卡片挪回旧坐标），
      // 补位统一交给 FLIP
      className={cn('flex flex-col gap-2 rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-primary/30')}
    >
      {tasks.map((t) => (
        <li key={t.id}>
          <SwipeRow onComplete={() => void toggleTaskWithUndo(t)} disabled={t.status === 'done'}>
            <TaskItem task={t} focused={focusId === t.id} flip />
          </SwipeRow>
        </li>
      ))}
    </ul>
  )
}

/**
 * 手机端横向滑动完成（P1）：右滑露出绿色对勾底色，过阈值松手即完成，否则回弹。
 * 仅触摸设备启用；纵向滚动/点击/看板拖拽不受影响——只有横向意图明确时才接管。
 */
function SwipeRow({ children, onComplete, disabled }: { children: React.ReactNode; onComplete: () => void; disabled?: boolean }) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef({ x: 0, y: 0, t: 0, active: false })
  const moved = useRef(false)

  const enabled = () =>
    !disabled &&
    typeof window !== 'undefined' &&
    window.matchMedia('(pointer: coarse)').matches

  const onDown = (e: React.PointerEvent) => {
    if (!enabled()) return
    start.current = { x: e.clientX, y: e.clientY, t: performance.now(), active: true }
    moved.current = false
  }
  const onMove = (e: React.PointerEvent) => {
    if (!start.current.active) return
    const rawX = e.clientX - start.current.x
    const rawY = e.clientY - start.current.y
    if (!moved.current) {
      // 只认向右的横向意图（+容差），否则交还给纵向滚动
      if (rawX < 8 || rawX < Math.abs(rawY)) return
      moved.current = true
      setDragging(true)
    }
    setDx(Math.max(0, Math.min(rawX * 0.9, 104)))
  }
  const onUp = (e: React.PointerEvent) => {
    if (!start.current.active) return
    start.current.active = false
    setDragging(false)
    if (!moved.current) {
      setDx(0)
      return
    }
    const rawX = e.clientX - start.current.x
    const velocity = rawX / Math.max(1, performance.now() - start.current.t)
    if (rawX > 72 || velocity > 0.5) {
      haptic('light')
      onComplete()
    }
    setDx(0)
  }

  return (
    <div className="swipe-row rounded-[16px]">
      <span
        aria-hidden
        className="swipe-underlay rounded-[16px]"
        style={{ background: 'color-mix(in srgb, var(--ok) 88%, #000)' }}
      >
        <span />
        <span className="inline-flex items-center gap-1">
          <Check size={15} /> 完成
        </span>
      </span>
      <div
        className="swipe-content rounded-[16px]"
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          transition: dragging ? 'none' : 'transform var(--dur-1) var(--ease-standard)',
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClickCapture={(e) => {
          // 刚滑完就吞掉紧随其后的 click，避免误开详情
          if (moved.current) {
            moved.current = false
            e.preventDefault()
            e.stopPropagation()
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}
