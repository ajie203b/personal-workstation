import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Command, Sparkles, X } from 'lucide-react'
import { Button } from './ui/Button'
import { cn } from '@/lib/cn'

const DONE_KEY = 'ws-onboarded-v1'

interface Step {
  /** 高亮的目标元素选择器；没有就居中显示一张说明卡 */
  target?: string
  title: string
  body: string
  /** 卡片相对目标的位置 */
  place?: 'below' | 'above' | 'center'
  /** 标题前用 ⌘ 图标（说明快捷键那一步） */
  titleIcon?: boolean
}

const STEPS: Step[] = [
  {
    target: '#quick-add-input, #fab-add',
    title: '从这儿加任务',
    body: '点它，一句话就能记下来：写「明天14:00 交报告 P1 #工作」，日期、时间、优先级、标签会自动分好。手机上也可以长按桌面图标选「快速添加」。',
    place: 'below',
  },
  {
    target: '#quick-add-input, #fab-add',
    title: '自然语言就够了',
    body: '「每周一三五 健身」「每月15号 交房租」「3点半复诊」都认得；只写时间不写日期时，会取「今天之后最近的那个点」。',
    place: 'below',
  },
  {
    title: '⌘K 找任何东西',
    titleIcon: true,
    body: '任务、文档、批注全文都在里面；按 N 直接新建任务，按 ? 看全部快捷键。',
  },
]

/**
 * 首次打开的聚光灯引导（ui-motion 61）：直接指向真实控件，不在中间放说明框。
 * 只在第一次打开时出现，可随时跳过；跳过或走完都记进 localStorage。
 */
export function Spotlight() {
  const [step, setStep] = useState<number | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (localStorage.getItem(DONE_KEY) === '1') return
    const t = window.setTimeout(() => setStep(0), 700)
    return () => window.clearTimeout(t)
  }, [])

  const current = step != null ? STEPS[step] : null

  // 目标可能还没渲染（懒加载 / 切换视图），每步都重新量一次
  useEffect(() => {
    if (!current) return
    const measure = () => {
      if (!current.target) { setRect(null); return }
      // 选择器是「a, b」这种多候选时，取第一个真正可见的：
      // 桌面端 #quick-add-input 在、手机端它在 hidden 容器里，量出来会是 0×0，
      // 圈一个左上角的小方框比不圈还糟
      const nodes = Array.from(document.querySelectorAll(current.target)) as HTMLElement[]
      const el = nodes.find((n) => {
        const r = n.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      })
      setRect(el ? el.getBoundingClientRect() : null)
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [current])

  const finish = () => {
    localStorage.setItem(DONE_KEY, '1')
    setStep(null)
  }

  const cardStyle = useMemo(() => {
    if (!rect) return undefined
    const gap = 14
    const width = Math.min(340, window.innerWidth - 24)
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)
    // 估计卡片高度，用来判断「放下面会不会被屏幕切掉」
    const CARD_H = 200
    const belowTop = rect.bottom + gap
    const preferBelow = current?.place !== 'above'
    let top = preferBelow ? belowTop : rect.top - CARD_H - gap
    if (top + CARD_H > window.innerHeight - 12 || top < 12) {
      // 下面放不下就翻到上方；上方也放不下就贴着顶部
      const above = rect.top - CARD_H - gap
      top = above >= 12 ? above : Math.max(12, window.innerHeight - CARD_H - 12)
    }
    return { top, left, width }
  }, [rect, current])

  if (!current) return null

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="新手引导">
      {/* 遮罩：有目标时靠 box-shadow 挖洞，没目标就整屏压暗 */}
      {rect ? (
        <div
          className="absolute spot-ring pointer-events-none"
          style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}
      <div className="absolute inset-0" onClick={finish} />

      <div
        className={cn(
          'absolute rounded-[16px] bg-surface border border-outline shadow-2xl p-4 flex flex-col gap-2.5 pop',
          !rect && 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(360px,90vw)]',
        )}
        style={cardStyle}
      >
        <div className="flex items-start gap-2">
          <span className="grid place-items-center w-7 h-7 rounded-[9px] bg-primary-soft text-primary shrink-0">
            {current.titleIcon ? <Command size={15} /> : <Sparkles size={15} />}
          </span>
          <h3 className="text-[15px] font-semibold leading-6 flex-1">{current.title}</h3>
          <button
            type="button"
            aria-label="跳过引导"
            onClick={finish}
            className="shrink-0 w-7 h-7 grid place-items-center rounded-lg text-on-surface-2 hover:bg-surface-3 cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
        <p className="text-[13px] leading-relaxed text-on-surface-2">{current.body}</p>
        <div className="flex items-center gap-2 pt-0.5">
          <span className="text-[11.5px] text-on-surface-2 tabular-nums">{(step ?? 0) + 1} / {STEPS.length}</span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={finish}>跳过</Button>
            {step != null && step < STEPS.length - 1 ? (
              <Button size="sm" variant="primary" onClick={() => setStep(step + 1)}>
                下一步 <ArrowRight size={13} />
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={finish}>开始使用</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
