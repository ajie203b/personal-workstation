import { Link } from 'react-router'
import { IconToolArticle, IconToolDownload, IconToolIdPhoto, IconToolNovel, IconToolOcr, IconToolPdf, IconToolQr, type AppIcon } from '@/shared/icons'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { IntelligenceCard } from '@/modules/intelligence/IntelligenceCard'
import { useFanqie } from '@/stores/fanqie'
import { cn } from '@/lib/cn'
import { usePressTilt } from '@/lib/usePressTilt'

/**
 * 工具页（v2.2 起配置化）：模型智能排名永远置顶，下面是小工具入口。
 * 小工具卡一律 1:1（与番茄小说卡同尺寸，见 MEMORY 排版约束），
 * 新增工具在 TOOL_CARDS 里加一项即可。图标用 @/shared/icons 的
 * Material Symbols 体系（与导航/功能卡一致）。
 */
interface ToolCard {
  to: string
  icon: AppIcon
  title: string
  sub: string
  /** 右上角徽标文案；不填不显示 */
  badge?: string
}

const TOOL_CARDS: ToolCard[] = [
  { to: '/tools/fanqie', icon: IconToolNovel, title: '番茄小说', sub: '下载到本地书架' },
  { to: '/tools/media', icon: IconToolDownload, title: '无水印下载', sub: '视频、图集解析', badge: '抖音 / B站' },
  { to: '/tools/qrcode', icon: IconToolQr, title: '二维码', sub: '生成与扫码' },
  { to: '/tools/pdf', icon: IconToolPdf, title: 'PDF 工具箱', sub: '合并、签名、水印' },
  { to: '/tools/article', icon: IconToolArticle, title: '文章离线', sub: '网页转文档 / EPUB' },
  { to: '/tools/idphoto', icon: IconToolIdPhoto, title: '证件照', sub: '换底色、排版打印' },
  { to: '/tools/ocr', icon: IconToolOcr, title: '本地 OCR', sub: '拍照取字，不上传' },
]

export function ToolsPage() {
  const localBooks = useLiveQuery(() => db.fanqieBooks.count(), []) ?? 0
  const job = useFanqie((s) => s.job)
  const tilt = usePressTilt<HTMLAnchorElement>()

  const fanqieBadge = job?.phase === 'running'
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
          {TOOL_CARDS.map((t) => (
            <Link
              key={t.to}
              ref={t.to === '/tools/fanqie' ? tilt.ref : undefined}
              {...(t.to === '/tools/fanqie' ? tilt.tiltProps : {})}
              to={t.to}
              aria-label={t.title}
              className={cn(
                'tilt-card press card card-hover relative aspect-square w-full max-w-[190px] rounded-[16px] p-4',
                'flex flex-col overflow-hidden select-none',
              )}
            >
              <span className="grid place-items-center w-11 h-11 rounded-[13px] bg-primary-soft text-primary shrink-0">
                <t.icon size={22} />
              </span>
              {t.to === '/tools/fanqie' ? (
                <span
                  className={cn(
                    'absolute top-4 right-3.5 max-w-[calc(100%-4.5rem)] truncate text-[10.5px] tabular-nums',
                    job?.phase === 'running' ? 'text-primary font-medium' : 'text-on-surface-2',
                  )}
                >
                  {fanqieBadge}
                </span>
              ) : t.badge ? (
                <span className="absolute top-4 right-3.5 truncate text-[10.5px] text-on-surface-2 tabular-nums">
                  {t.badge}
                </span>
              ) : null}
              <span className="mt-auto min-w-0">
                <span className="block text-[15px] font-semibold leading-5">{t.title}</span>
                <span className="block text-[11.5px] text-on-surface-2 mt-1 truncate">{t.sub}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
