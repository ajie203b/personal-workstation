import { Sparkles } from 'lucide-react'
import { IntelligenceCard } from '@/modules/intelligence/IntelligenceCard'
import { useUi } from '@/stores/ui'
import { Button } from '@/shared/ui/Button'

/**
 * 工具页（v2.2）：目前就放一张模型智能排名快照。
 *
 * 这张榜原来挤在今日页的侧栏里，和「今天要做的事」抢注意力；
 * 单独开一页放它，后面要加别的工具（换算、抽签、字数…）也有地方落脚。
 * 位置本身仍受设置里的「模型智能排名」控制 —— 如果被改到别的页，
 * 这里给一句说明和一个搬回来的按钮，而不是白着一整页。
 */
export function ToolsPage() {
  const placement = useUi((s) => s.intelPlacement)
  const setPlacement = useUi((s) => s.setIntelPlacement)

  return (
    <div className="mx-auto w-full max-w-5xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <div className="hidden md:block">
        <h1 className="text-[22px] font-bold leading-8">工具</h1>
        <p className="text-[13px] text-on-surface-2 mt-0.5">模型智能排名快照</p>
      </div>

      {placement === 'tools' ? (
        <IntelligenceCard />
      ) : (
        <div className="card p-6 flex flex-col items-center text-center gap-2">
          <span className="grid place-items-center w-11 h-11 rounded-full bg-surface-3 text-on-surface-2">
            <Sparkles size={19} />
          </span>
          <p className="text-[14px] font-medium mt-1">榜单现在不在这一页</p>
          <p className="text-[12.5px] text-on-surface-2 leading-relaxed max-w-[300px]">
            你把它放到了{placement === 'today' ? '今日页' : placement === 'stats' ? '统计页' : '隐藏'}。
            想搬回来点一下就行。
          </p>
          <Button size="sm" variant="primary" className="mt-1" onClick={() => setPlacement('tools')}>
            放回工具页
          </Button>
        </div>
      )}
    </div>
  )
}
