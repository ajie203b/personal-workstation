import { useState } from 'react'
import { useNavigate } from 'react-router'
import { BookOpen, ChevronRight, Highlighter, ListPlus, X } from 'lucide-react'
import { useRecentDocs } from '@/db/hooks'

const DISMISS_KEY = 'ws-docs-guide-dismissed'

/**
 * 首次使用的三步引导：导入文档 → 划词批注 → 批注转任务。
 *
 * 只在「这一台设备还没导入过任何文档」时出现，点任意一步都直接去文档库；
 * 有文档之后就不再打扰（也可以点右上角收起来，选择写进 localStorage）。
 * 之前手机首页空态留白很多、却没有任何「下一步做什么」的提示，新用户不知道该往哪走。
 */
export function GettingStarted() {
  const navigate = useNavigate()
  const recent = useRecentDocs(1)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')

  if (dismissed || recent.length > 0) return null

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  const steps = [
    { icon: BookOpen, title: '导入文档', hint: 'PDF / EPUB / DOCX / Markdown 都能读' },
    { icon: Highlighter, title: '划词批注', hint: '选中文字，浮条里点颜色' },
    { icon: ListPlus, title: '批注转任务', hint: '批注一键变成待办' },
  ]

  return (
    <section className="mt-2 mb-1 rounded-[14px] border border-outline/70 bg-surface-2/50 px-3 py-2 md:py-2.5">
      <div className="flex items-center gap-2">
        <p className="text-[12px] font-medium text-on-surface-2">三步把读到的变成要做的</p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="收起引导"
          title="不用了"
          className="ml-auto shrink-0 w-6 h-6 grid place-items-center rounded-md text-on-surface-2/70 hover:bg-surface-3 hover:text-on-surface cursor-pointer"
        >
          <X size={12} />
        </button>
      </div>
      {/* 手机：只留一行三步（首屏高度要留给专注控件）；桌面：带说明的三栏 */}
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        {steps.map((s, i) => (
          <button
            key={s.title}
            type="button"
            onClick={() => navigate('/docs')}
            className="group text-left rounded-[10px] px-1.5 py-1 md:px-2 md:py-2 hover:bg-surface-3 transition-colors cursor-pointer min-w-0"
          >
            <span className="flex items-center gap-1 text-[11px] text-on-surface-2 tabular-nums">
              <span className="w-4 h-4 rounded-full bg-primary-soft text-primary grid place-items-center text-[10px] font-semibold shrink-0">
                {i + 1}
              </span>
              <s.icon size={12} className="shrink-0 md:hidden" />
              <ChevronRight size={11} className="ml-auto opacity-0 group-hover:opacity-60 hidden md:block" />
            </span>
            <span className="block mt-0.5 text-[12px] md:text-[12.5px] font-medium truncate">{s.title}</span>
            <span className="hidden md:block mt-0.5 text-[10.5px] leading-snug text-on-surface-2 line-clamp-2">{s.hint}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
