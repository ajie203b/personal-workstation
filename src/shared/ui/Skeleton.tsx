import { cn } from '@/lib/cn'

/**
 * 骨架屏（ui-motion「骨架屏扫光 Skeleton Shimmer」）。
 *
 * 形状跟着真实内容走 —— 卡片就是卡片的圆角与行高，不做「白屏 + 转圈」。
 * 扫光是一条 1.2s 的柔光从左侧扫到右侧、间隔 0.4s 再扫，靠 CSS 变量控制；
 * 减弱动效时 CSS 里会关掉动画，退化成静态灰块。
 */
export function Skeleton({ className }: { className?: string }) {
  return <span className={cn('block rounded-[8px] skeleton', className)} aria-hidden />
}

/** 文档库卡片骨架：与 DocCard 的排版对齐（图标 + 标题 + 元信息 + 进度条） */
export function DocCardSkeleton() {
  return (
    <div className="card relative overflow-hidden px-4 py-3.5 flex gap-3.5" aria-hidden>
      <Skeleton className="w-11 h-11 rounded-[12px] shrink-0" />
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex items-center gap-2 mt-1">
          <Skeleton className="h-1.5 flex-1 rounded-full" />
          <Skeleton className="h-3 w-7" />
        </div>
      </div>
    </div>
  )
}

/** 整页骨架：路由懒加载时顶替转圈，按「标题 + 卡片网格」的形状铺 */
export function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 md:px-8 pt-4 flex flex-col gap-4" aria-hidden>
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-4 w-64" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
        <DocCardSkeleton />
        <DocCardSkeleton />
        <DocCardSkeleton />
      </div>
    </div>
  )
}
