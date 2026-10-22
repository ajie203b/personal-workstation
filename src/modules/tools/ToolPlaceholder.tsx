import type { LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router'
import { BackButton } from '@/shared/ui/BackButton'

/** 工具页开发中的统一占位（子代理实现完成后替换掉各自的页面） */
export function ToolPlaceholder({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) {
  const navigate = useNavigate()
  return (
    <div className="mx-auto w-full max-w-3xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <BackButton text="工具" label="返回工具" onClick={() => navigate('/tools')} className="-mt-1 w-fit" />
      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-[12px] bg-primary-soft text-primary shrink-0">
          <Icon size={21} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[20px] md:text-[22px] font-bold leading-7">{title}</h1>
          <p className="text-[12.5px] text-on-surface-2 mt-0.5 leading-relaxed">{hint}</p>
        </div>
      </header>
      <section className="card p-6 text-center text-[13px] text-on-surface-2">这个工具正在开发中，敬请期待。</section>
    </div>
  )
}
