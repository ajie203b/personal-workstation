import { Link } from 'react-router'
import { BookOpen } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { IntelligenceCard } from '@/modules/intelligence/IntelligenceCard'
import { useFanqie } from '@/stores/fanqie'
import { cn } from '@/lib/cn'
import { usePressTilt } from '@/lib/usePressTilt'

/**
 * 工具页（v2.2）：模型智能排名永远置顶，下面是小工具入口。
 * 榜单不再提供换位置/隐藏选项；工具卡只露一眼能扫完的信息，
 * 具体链接、章节、导出都放到详情页。
 */
export function ToolsPage() {
  const localBooks = useLiveQuery(() => db.fanqieBooks.count(), []) ?? 0
  const job = useFanqie((s) => s.job)
  const tilt = usePressTilt<HTMLAnchorElement>()

  const badge = job?.phase === 'running'
    ? `下载中 ${job.done}/${job.total}`
    : job?.phase === 'paused'
      ? '已暂停'
      : job?.phase === 'error'
        ? '下载中断'
        : localBooks > 0
          ? `本地 ${localBooks} 本`
          : 'TXT / EPUB'

  return (
    <div className="mx-auto w-full max-w-5xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-5 cascade">
      <div className="hidden md:block">
        <h1 className="text-[22px] font-bold leading-8">工具</h1>
        <p className="text-[13px] text-on-surface-2 mt-0.5">模型榜单与小工具</p>
      </div>

      <IntelligenceCard />

      <section className="flex flex-col gap-2">
        <h2 className="text-[13px] font-semibold text-on-surface-2 px-1">小工具</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <Link
            ref={tilt.ref}
            {...tilt.tiltProps}
            to="/tools/fanqie"
            aria-label="打开番茄小说下载器"
            className={cn(
              'tilt-card press card card-hover relative aspect-square w-full max-w-[190px] rounded-[16px] p-4',
              'flex flex-col overflow-hidden select-none',
            )}
          >
            <span className="grid place-items-center w-11 h-11 rounded-[13px] bg-danger/10 text-danger shrink-0">
              <BookOpen size={21} strokeWidth={2} />
            </span>
            <span
              className={cn(
                'absolute top-4 right-3.5 max-w-[calc(100%-4.5rem)] truncate text-[10.5px] tabular-nums',
                job?.phase === 'running' ? 'text-primary font-medium' : 'text-on-surface-2',
              )}
            >
              {badge}
            </span>
            <span className="mt-auto min-w-0">
              <span className="block text-[15px] font-semibold leading-5">番茄小说</span>
              <span className="block text-[11.5px] text-on-surface-2 mt-1 truncate">下载到本地书架</span>
            </span>
          </Link>
        </div>
      </section>
    </div>
  )
}
