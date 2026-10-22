import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ArrowRight, Command, Plus, Sparkles, X } from 'lucide-react'
import { Button } from './ui/Button'
import { cn } from '@/lib/cn'
import { placeCard, type RectLike } from './spotlightPlace'

const DONE_KEY = 'ws-onboarded-v2'

interface Step {
  /** 高亮目标：多候选择第一个可见的（手机/桌面各有一个锚点） */
  target?: string
  title: string
  body: string
  /** 卡片首选位置；放不下会自动翻面 */
  place?: 'above' | 'below'
  titleIcon?: 'command' | 'plus' | 'spark'
}

const STEPS: Step[] = [
  {
    target: '[data-tour="add"]',
    title: '点「＋」加任务',
    body: '手机上它在右下角、桌面在日期行右侧。一句话就行：「明天14:00 交报告 P1 #工作」，日期、时间、优先级、标签会自动分好。',
    place: 'below',
    titleIcon: 'plus',
  },
  {
    target: '[data-tour="nav-tasks"]',
    title: '「任务清单」管全部',
    body: '今日 / 近期 / 随时 / 将来四档，各管一段时间；完成的任务自动进「日志」归档，手机在底部、桌面在侧栏都能进。',
    place: 'above',
    titleIcon: 'spark',
  },
  {
    target: '[data-tour="nav-docs"]',
    title: '文档工作站与全局搜索',
    body: 'PDF / EPUB / Markdown 读进文档库，划词批注、批注一键转任务。桌面按 ⌘K 全局搜任务和文档，按 N 直接新建。',
    place: 'above',
    titleIcon: 'command',
  },
]

/** 找到当前步骤的目标元素矩形：多候选取第一个可见的（0×0 的隐藏元素不算） */
function findTarget(selector: string | undefined): RectLike | null {
  if (!selector) return null
  const nodes = Array.from(document.querySelectorAll(selector)) as HTMLElement[]
  for (const n of nodes) {
    const r = n.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) {
      return { top: r.top, left: r.left, width: r.width, height: r.height }
    }
  }
  return null
}

/**
 * 首次打开的聚光灯引导：每一步都圈住真实控件（加任务按钮 / 任务清单 / 文档工作站），
 * 卡片带箭头指向目标、位置按实测自适应屏幕。只在第一次打开时出现，可随时跳过。
 */
export function Spotlight() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [step, setStep] = useState<number | null>(null)
  const [rect, setRect] = useState<RectLike | null>(null)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const [cardSize, setCardSize] = useState({ width: 0, height: 0 })
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (localStorage.getItem(DONE_KEY) === '1') return
    const t = window.setTimeout(() => {
      // 引导要有确定的语境：先回今日页，目标控件才在场
      if (pathname !== '/today') navigate('/today', { replace: true })
      setStep(0)
    }, 700)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const current = step != null ? STEPS[step] : null

  // 目标可能还没渲染 / 会随滚动与旋转移动，持续量
  useEffect(() => {
    if (!current) return
    const measure = () => {
      setRect(findTarget(current.target))
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    }
    measure()
    // 目标（如 FAB、懒加载的底栏）可能晚一拍才挂上，多量几次
    const retry = window.setInterval(measure, 400)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.clearInterval(retry)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [current])

  // 卡片真实尺寸（内容多少决定高度，别再用固定值估）
  useLayoutEffect(() => {
    if (!current || !cardRef.current) return
    const r = cardRef.current.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) setCardSize({ width: r.width, height: r.height })
  }, [step, current])

  const placement = useMemo(() => {
    const fallback = {
      width: cardSize.width || Math.min(340, viewport.width - 24),
      height: cardSize.height || 200,
    }
    return placeCard(rect, fallback, viewport, current?.place ?? 'below')
  }, [rect, cardSize, viewport, current])

  const finish = () => {
    localStorage.setItem(DONE_KEY, '1')
    setStep(null)
  }

  if (!current) return null

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="新手引导">
      {/* 遮罩：有目标时 box-shadow 挖洞 + 脉冲环，没目标就整屏压暗 */}
      {rect ? (
        <>
          <div
            className="absolute spot-ring pointer-events-none"
            style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}
          />
          <div
            className="absolute spot-pulse pointer-events-none"
            style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}
      <div className="absolute inset-0" onClick={finish} />

      <div
        ref={cardRef}
        className={cn(
          'absolute rounded-[16px] bg-surface border border-outline shadow-2xl p-4 flex flex-col gap-2.5 pop',
          'w-[min(340px,calc(100vw-24px))]',
        )}
        style={{ top: placement.top, left: placement.left }}
      >
        {/* 箭头：恒指向目标（无目标时不画） */}
        {placement.side && placement.arrowX != null && (
          <span
            className={cn('absolute w-3 h-3 rotate-45 bg-surface border-outline', placement.side === 'below' ? '-top-[7px] border-l border-t' : '-bottom-[7px] border-r border-b')}
            style={{ left: placement.arrowX - 6 }}
            aria-hidden
          />
        )}
        <div className="flex items-start gap-2">
          <span className="grid place-items-center w-7 h-7 rounded-[9px] bg-primary-soft text-primary shrink-0">
            {current.titleIcon === 'command' ? <Command size={15} /> : current.titleIcon === 'plus' ? <Plus size={15} /> : <Sparkles size={15} />}
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
