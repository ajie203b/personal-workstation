import { useState } from 'react'
import { Link } from 'react-router'
import { BookOpen, Highlighter, ListPlus, X } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'

const DISMISS_KEY = 'ws-docs-guide-dismissed'

/**
 * 首次使用的三步引导：导入文档 → 划词批注 → 批注转任务。
 *
 * 只在「这一台设备还没导入过任何文档」时出现；
 * 有文档之后就不再打扰（也可以点右上角收起来，选择写进 localStorage）。
 * 之前手机首页空态留白很多、却没有任何「下一步做什么」的提示，新用户不知道该往哪走。
 */
export function GettingStarted() {
  const documentCount = useLiveQuery(() => db.docs.count(), [])
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')

  if (dismissed || documentCount !== 0) return null

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
    <section className="card mt-2.5 mb-1 px-4 py-3 md:py-3.5">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">三步把阅读变成行动</h3>
        <Link to="/docs" className="ml-auto flex min-h-11 shrink-0 items-center rounded-md px-2 text-[13px] font-medium text-primary hover:bg-primary-soft">打开文档库</Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="跳过引导"
          className="shrink-0 size-11 grid place-items-center rounded-md text-on-surface-2 hover:bg-surface-3 hover:text-on-surface cursor-pointer"
        >
          <X size={12} />
        </button>
      </div>
      {/* 手机：只留一行三步（首屏高度要留给专注控件）；桌面：带说明的三栏 */}
      <ol className="mt-1.5 grid grid-cols-3 gap-1.5">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className="text-left px-1.5 py-1 md:px-2 md:py-2 min-w-0"
          >
            <span className="flex items-center gap-1 text-[11px] text-on-surface-2 tabular-nums">
              <span className="w-4 h-4 rounded-full bg-primary-soft text-primary grid place-items-center text-[11px] font-semibold shrink-0">
                {i + 1}
              </span>
              <s.icon size={14} aria-hidden className="shrink-0" />
            </span>
            <span className="block mt-0.5 text-[12px] md:text-[12.5px] font-medium truncate">{s.title}</span>
            <span className="hidden md:block mt-0.5 text-[12px] leading-snug text-on-surface-2 line-clamp-2">{s.hint}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
