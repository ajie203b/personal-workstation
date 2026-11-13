import { Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/lib/cn'
import type { QrHistoryRow } from '@/db/db'
import { QR_KIND_LABEL } from './qrTemplates'

export function QrHistoryList({
  history,
  onSelect,
  onRemove,
}: {
  history: QrHistoryRow[]
  onSelect: (row: QrHistoryRow) => void
  onRemove: (id: string) => void
}) {
  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13.5px] font-semibold">历史</h2>
        <span className="text-[11.5px] text-on-surface-2 tabular-nums">最近 {history.length} 条</span>
      </div>
      {history.length === 0 ? (
        <p className="text-[12px] text-on-surface-2 mt-2 leading-relaxed">
          生成和扫码都会记在这里（只存本机），点条目可以回填复用。
        </p>
      ) : (
        <ul className="mt-1.5 flex flex-col divide-y divide-outline">
          {history.map((row) => (
            <li key={row.id} className="flex items-center gap-1.5 py-1.5">
              <button
                type="button"
                onClick={() => onSelect(row)}
                className="min-w-0 flex-1 text-left rounded-[8px] px-1.5 py-1 hover:bg-surface-2 transition-colors cursor-pointer"
                title="回填内容"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'text-[10.5px] px-1.5 py-0.5 rounded-full font-medium shrink-0',
                      row.action === 'generate' ? 'bg-primary-soft text-primary' : 'bg-surface-3 text-on-surface-2',
                    )}
                  >
                    {row.action === 'generate' ? `生成·${QR_KIND_LABEL[row.kind ?? 'text']}` : '扫码'}
                  </span>
                  <p className="text-[12.5px] leading-5 truncate min-w-0">{row.content}</p>
                </div>
                <p className="text-[11px] text-on-surface-2 tabular-nums mt-0.5">
                  {new Date(row.createdAt).toLocaleString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </button>
              <Button
                onClick={() => onRemove(row.id)}
                variant="ghost"
                size="icon"
                aria-label="删除这条历史"
                title="删除"
                className="shrink-0"
              >
                <Trash2 size={15} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
