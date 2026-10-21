import { useCallback, useEffect, useRef, useState } from 'react'
import { haptic } from '@/lib/haptics'
import { prefersReducedMotion } from '@/lib/motion'

export { prefersReducedMotion }

/**
 * 长按蓄力的计时内核：走满才执行，中途松手按比例倒退归零。
 * 只负责「按住 → 进度」，进度长什么样交给调用方（HoldToConfirm 画圆环，文档卡画绕框一周）。
 * 键盘 Enter/Space 与系统要求减弱动效时走 onFallback，不把防误触做成防不了。
 */
export function useHoldToConfirm({
  holdMs = 1500,
  onComplete,
  onFallback,
}: {
  holdMs?: number
  onComplete: () => void
  onFallback: () => void
}) {
  const [progress, setProgress] = useState(0)
  const [nudging, setNudging] = useState(false)
  const progressRef = useRef(0)
  const holding = useRef(false)
  const startTs = useRef(0)
  const forwardRaf = useRef(0)
  const backRaf = useRef(0)
  const timers = useRef<number[]>([])
  // 调用方每次渲染都可能换一个新函数，用 ref 兜住，避免因此重启蓄力循环
  const done = useRef(onComplete)
  done.current = onComplete

  const stopLoops = useCallback(() => {
    cancelAnimationFrame(forwardRaf.current)
    cancelAnimationFrame(backRaf.current)
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])

  useEffect(() => stopLoops, [stopLoops])

  const put = (v: number) => {
    progressRef.current = v
    setProgress(v)
  }

  const finish = useCallback(() => {
    holding.current = false
    stopLoops()
    put(1)
    setNudging(true)
    haptic('success')
    timers.current.push(window.setTimeout(() => setNudging(false), 280))
    timers.current.push(window.setTimeout(() => {
      put(0)
      done.current()
    }, 320))
  }, [stopLoops])

  const runForward = useCallback(() => {
    cancelAnimationFrame(backRaf.current)
    startTs.current = performance.now() - progressRef.current * holdMs
    const tick = (t: number) => {
      if (!holding.current) return
      const p = Math.min(1, (t - startTs.current) / holdMs)
      put(p)
      if (p >= 1) finish()
      else forwardRaf.current = requestAnimationFrame(tick)
    }
    forwardRaf.current = requestAnimationFrame(tick)
  }, [finish, holdMs])

  const runBackward = useCallback(() => {
    cancelAnimationFrame(forwardRaf.current)
    holding.current = false
    let cur = progressRef.current
    const tick = () => {
      cur -= 0.07
      if (cur <= 0) {
        put(0)
        return
      }
      put(cur)
      backRaf.current = requestAnimationFrame(tick)
    }
    backRaf.current = requestAnimationFrame(tick)
  }, [])

  const bind = {
    onPointerDown: (e: React.PointerEvent) => {
      // 只 preventDefault 指针事件，不碰兼容性 mouse 事件：
      // adb / 自动化工具注入的是 mouse 序列，若一并取消会让按住完全无响应
      if (e.cancelable && e.nativeEvent.pointerType !== 'mouse') e.preventDefault()
      if (prefersReducedMotion()) {
        onFallback()
        return
      }
      holding.current = true
      haptic('medium')
      runForward()
    },
    onPointerUp: runBackward,
    onPointerLeave: runBackward,
    onPointerCancel: runBackward,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onFallback()
      }
    },
  }

  return { progress, nudging, bind }
}
