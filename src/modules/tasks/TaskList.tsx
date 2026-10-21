import { useEffect, useRef, useState } from 'react'
import { Inbox, Check, Plus, Trash2 } from 'lucide-react'
import type { Task } from '@/db/db'
import { useTasksUi } from '@/stores/tasks'
import { useUi } from '@/stores/ui'
import { deleteTask, restoreTask } from '@/db/tasks'
import { toggleTaskWithUndo } from './taskActions'
import { TaskItem } from './TaskItem'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Button } from '@/shared/ui/Button'
import { useFlipList } from '@/lib/useFlipList'
import { haptic } from '@/lib/haptics'
import { isFutureTask } from '@/lib/date'
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
  const openAddSheet = useUi((s) => s.openAddSheet)
  const toast = useUi((s) => s.toast)
  // 左滑删除：软删除 + 4 秒撤销（与详情里的删除走同一条路径）
  const removeTask = async (t: Task) => {
    await deleteTask(t)
    toast('已删除任务', { label: '撤销', run: () => void restoreTask(t) })
  }
  const containerRef = useRef<HTMLUListElement>(null)
  // 按键处理读最新数据，避免把 tasks 塞进依赖导致每帧重绑监听
  const latest = useRef({ tasks, focusId })
  latest.current = { tasks, focusId }

  useEffect(() => {
    if (!focusId) return
    document.getElementById(`task-${focusId}`)?.scrollIntoView({ block: 'nearest' })
  }, [focusId])

  useEffect(() => {
    // 列表内容变化后，聚焦项可能已不在列表中。
    // tasks 为空时不要清：首次加载 liveQuery 还没回来，深链（?focus=）会被误清掉。
    if (focusId && tasks.length > 0 && !tasks.some((t) => t.id === focusId)) setFocusId(null)
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
    return (
      <EmptyState icon={Inbox} title={emptyTitle} hint={emptyHint ?? '按 N 或 / 快速添加，例如「明天14:00 交报告 P1 #工作」'}>
        <Button size="sm" variant="primary" onClick={() => openAddSheet({ tier: 'today', todayContext: true })}>
          <Plus size={15} /> 加第一个任务
        </Button>
      </EmptyState>
    )
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
          <SwipeRow onComplete={() => void toggleTaskWithUndo(t)} onDelete={() => void removeTask(t)} disabled={t.status === 'done' || isFutureTask(t)}>
            <TaskItem task={t} focused={focusId === t.id} flip />
          </SwipeRow>
        </li>
      ))}
    </ul>
  )
}

/**
 * 手机端横向手势：右滑完成、左滑删除（P1 + v2.2）。
 * - 右滑露出绿色对勾底色，过阈值松手即完成
 * - 左滑露出红色删除位，过阈值松手即删除，并给 4 秒撤销提示条
 * 仅触摸设备启用；纵向滚动、点击、看板拖拽都不受影响 —— 只有横向意图明确时才接管。
 */
function SwipeRow({ children, onComplete, onDelete, disabled }: { children: React.ReactNode; onComplete: () => void; onDelete: () => void; disabled?: boolean }) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const start = useRef({ x: 0, y: 0, t: 0, active: false })
  const moved = useRef(false)
  const armed = useRef(0)

  const enabled = () =>
    !disabled &&
    typeof window !== 'undefined' &&
    window.matchMedia('(pointer: coarse)').matches

  const onDown = (e: React.PointerEvent) => {
    if (!enabled()) return
    start.current = { x: e.clientX, y: e.clientY, t: performance.now(), active: true }
    moved.current = false
    armed.current = 0
  }
  const onMove = (e: React.PointerEvent) => {
    if (!start.current.active) return
    const rawX = e.clientX - start.current.x
    const rawY = e.clientY - start.current.y
    if (!moved.current) {
      // 横向意图明确才接管，否则交还给纵向滚动
      if (Math.abs(rawX) < 8 || Math.abs(rawX) < Math.abs(rawY)) return
      moved.current = true
      setDragging(true)
    }
    const val = rawX > 0 ? Math.min(rawX * 0.9, 104) : Math.max(rawX * 0.9, -104)
    setDx(val)
    // 越过阈值时给一次轻振：手感上的「咔哒」
    const dir = val > 0 ? 1 : -1
    const nowArmed = Math.abs(val) > 72 ? dir : 0
    if (nowArmed !== armed.current) {
      armed.current = nowArmed
      if (nowArmed) haptic('light')
    }
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
    const velocity = Math.abs(rawX) / Math.max(1, performance.now() - start.current.t)
    if (rawX > 72 || (rawX > 20 && velocity > 0.5)) {
      haptic('light')
      onComplete()
      setDx(0)
      return
    }
    if (rawX < -72 || (rawX < -20 && velocity > 0.5)) {
      haptic('warning')
      // 先滑到底再淡出，别一松手就弹回来（会让人以为没删掉）
      setDx(-window.innerWidth)
      setLeaving(true)
      window.setTimeout(onDelete, 200)
      return
    }
    setDx(0)
  }

  return (
    <div className={cn('swipe-row rounded-[16px]', leaving && 'pointer-events-none')}>
      {/* 底色：往右滑露出「完成」，往左滑露出「删除」 */}
      <span
        aria-hidden
        className="swipe-underlay rounded-[16px] justify-start gap-1"
        style={{ background: 'color-mix(in srgb, var(--ok) 88%, #000)', opacity: dx > 0 ? Math.min(1, dx / 72) : 0 }}
      >
        <Check size={15} /> 完成
      </span>
      <span
        aria-hidden
        className="swipe-underlay rounded-[16px] justify-end gap-1"
        style={{ background: 'color-mix(in srgb, var(--danger) 90%, #000)', opacity: dx < 0 ? Math.min(1, -dx / 72) : 0 }}
      >
        <Trash2 size={15} /> 删除
      </span>
      <div
        className="swipe-content rounded-[16px]"
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          transition: dragging ? 'none' : 'transform var(--dur-2) cubic-bezier(.34,1.32,.5,1), opacity 180ms linear',
          opacity: leaving ? 0 : 1,
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
