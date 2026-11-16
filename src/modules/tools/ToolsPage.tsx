import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { IconToolArticle, IconToolDownload, IconToolIdPhoto, IconToolMath, IconToolNovel, IconToolOcr, IconToolPdf, IconToolQr, IconToolReport, type AppIcon } from '@/shared/icons'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { IntelligenceCard } from '@/modules/intelligence/IntelligenceCard'
import { useFanqie } from '@/stores/fanqie'
import { cn } from '@/lib/cn'
import { arraySwap, rectSwappingStrategy } from '@dnd-kit/sortable'
import { DragSort, DragSortItem } from '@/shared/ui/DragSort'
import { orderTools } from './toolOrder'
import { useUi } from '@/stores/ui'
import { isNative, isTauri } from '@/lib/native'

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
  { to: '/tools/archive', icon: IconToolNovel, title: '安娜的档案', sub: '站内找书与导入阅读', badge: 'EPUB / PDF' },
  { to: '/tools/media', icon: IconToolDownload, title: '无水印下载', sub: '视频、图集解析', badge: '抖音 / B站' },
  { to: '/tools/qrcode', icon: IconToolQr, title: '二维码', sub: '生成与扫码' },
  { to: '/tools/pdf', icon: IconToolPdf, title: 'PDF 工具箱', sub: '合并、签名、水印' },
  { to: '/tools/article', icon: IconToolArticle, title: '文章离线', sub: '网页转文档 / EPUB' },
  { to: '/tools/idphoto', icon: IconToolIdPhoto, title: '证件照', sub: '换底色、排版打印' },
  { to: '/tools/ocr', icon: IconToolOcr, title: '本地 OCR', sub: '拍照取字，不上传' },
  { to: '/tools/math-notes', icon: IconToolMath, title: '手写计算', sub: '写下算式，自动出答案', badge: '离线' },
  { to: '/tools/njust-report', icon: IconToolReport, title: 'NJUST 报告排版', sub: 'txt / md / docx → Word' },
]

export function ToolsPage() {
  const localBooks = useLiveQuery(() => db.fanqieBooks.count(), []) ?? 0
  const job = useFanqie((s) => s.job)
  const savedOrder = useLiveQuery(() => db.settings.get('toolOrder'), [])
  // 拖拽落位先改本地顺序，再后台落库：否则会先弹回旧位置、等 liveQuery 回来才跳过去
  const [localOrder, setLocalOrder] = useState<string[] | null>(null)
  const supportedTools = isTauri() || isNative() ? TOOL_CARDS : TOOL_CARDS.filter(({ to }) => to !== '/tools/archive')
  const tools = orderTools(supportedTools, localOrder ?? savedOrder?.value)
  useEffect(() => {
    if (!localOrder) return
    const saved = Array.isArray(savedOrder?.value) ? savedOrder.value as string[] : null
    if (saved && saved.length === localOrder.length && saved.every((id, i) => id === localOrder[i])) {
      setLocalOrder(null)
    }
  }, [savedOrder, localOrder])
  const moveTool = (active: string, over: string) => {
    const ids = tools.map(t => t.to)
    const from = ids.indexOf(active)
    const to = ids.indexOf(over)
    if (from < 0 || to < 0) return
    const next = arraySwap(ids, from, to)
    setLocalOrder(next)
    void db.settings.put({ key: 'toolOrder', value: next })
      .catch(() => {
        setLocalOrder(null)
        useUi.getState().toast('排序保存失败，请重试')
      })
  }

  const fanqieBadge = job?.phase === 'running'
    ? `下载中 ${job.done}/${job.total}`
    : job?.phase === 'paused'
      ? '已暂停'
      : job?.phase === 'error'
        ? '下载中断'
        : localBooks > 0
          ? `本地 ${localBooks} 本`
          : 'TXT / EPUB'

  const toolCard = (t: ToolCard, overlay = false) => (
    <Link
      to={t.to}
      draggable={false}
      tabIndex={overlay ? -1 : undefined}
      aria-label={t.title}
      className="chrome-button press card flex relative w-full min-h-[76px] items-center gap-2.5 px-3 py-2 select-none"
    >
      <span className="grid place-items-center size-9 rounded-[10px] bg-primary-soft text-primary shrink-0"><t.icon size={20} /></span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold leading-5">{t.title}</span>
        <span className={cn('block text-xs mt-0.5 truncate', t.to === '/tools/fanqie' && job?.phase === 'running' ? 'text-primary' : 'text-on-surface-2')}>
          {t.to === '/tools/fanqie' && (job || localBooks) ? fanqieBadge : t.sub}
        </span>
      </span>
    </Link>
  )

  return (
    <div className="mx-auto w-full max-w-5xl px-4 md:px-8 pt-4 md:pt-6 pb-24 md:pb-14 flex flex-col gap-5">
      <h1 className="hidden md:block text-[28px] font-semibold leading-tight tracking-tight">工具</h1>

      <IntelligenceCard />

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[13px] font-semibold text-on-surface-2">小工具</h2>
          <span className="text-[11px] text-on-surface-2">长按拖动排序</span>
        </div>
        <DragSort ids={tools.map(t => t.to)} strategy={rectSwappingStrategy} onMove={moveTool}
          renderOverlay={id => {
            const tool = tools.find(t => t.to === id)
            return tool ? <div aria-hidden="true" className="h-full overflow-hidden rounded-[14px] shadow-xl ring-1 ring-primary/15">{toolCard(tool, true)}</div> : null
          }}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {tools.map((t) => (
            <DragSortItem key={t.to} id={t.to} className="w-full min-w-0">
            {toolCard(t)}
            </DragSortItem>
          ))}
        </div>
        </DragSort>
      </section>
    </div>
  )
}
