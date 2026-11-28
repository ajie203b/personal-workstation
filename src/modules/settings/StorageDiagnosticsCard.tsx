import { useCallback, useEffect, useState } from 'react'
import { HardDrive, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { useUi } from '@/stores/ui'
import {
  cleanLegacyAiTables,
  cleanOrphanBlobs,
  purgeDocTrash,
  scanStorageBreakdown,
  type StorageBreakdown,
} from '@/lib/storageDiagnostics'

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export function StorageDiagnosticsCard({ onChanged }: { onChanged?: () => void }) {
  const toast = useUi((s) => s.toast)
  const [data, setData] = useState<StorageBreakdown | null>(null)
  const [scanning, setScanning] = useState(false)
  const [confirmTrash, setConfirmTrash] = useState(false)
  const orphanBtn = useAsyncButton({ successHoldMs: 900 })
  const trashBtn = useAsyncButton({ successHoldMs: 900 })
  const legacyBtn = useAsyncButton({ successHoldMs: 900 })

  const scan = useCallback(async () => {
    setScanning(true)
    try {
      setData(await scanStorageBreakdown())
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    void scan()
  }, [scan])

  const segments = data
    ? [
        { key: 'docs', label: '文档本体', count: `${data.activeDocCount} 篇`, bytes: data.activeBlobBytes, color: 'bg-primary' },
        { key: 'trash', label: '回收站文档', count: `${data.trashDocCount} 篇`, bytes: data.trashBlobBytes, color: 'bg-p1' },
        { key: 'orphan', label: '孤儿附件', count: `${data.orphanBlobCount} 个`, bytes: data.orphanBlobBytes, color: 'bg-danger' },
        { key: 'index', label: '全文索引', count: `${data.docTextCount} 篇`, bytes: data.docTextBytes, color: 'bg-p2' },
        { key: 'fanqie', label: '番茄书架', count: `${data.fanqieBookCount} 本 / ${data.fanqieChapterCount} 章`, bytes: data.fanqieBytes, color: 'bg-ok' },
        { key: 'math', label: '手写计算', count: `${data.mathNoteCount} 页`, bytes: data.mathNoteBytes, color: 'bg-on-surface-2/70' },
      ]
    : []

  const denom = Math.max(1, data?.totalBytes ?? 0)

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <HardDrive size={15} className="text-primary shrink-0" />
          <h2 className="text-[14px] font-semibold">存储空间诊断</h2>
        </div>
        <button
          type="button"
          disabled={scanning}
          onClick={() => void scan()}
          className="inline-flex items-center gap-1 text-[12px] text-on-surface-2 hover:text-primary cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={12.5} className={scanning ? 'animate-spin' : ''} /> 刷新
        </button>
      </div>
      <p className="text-[12.5px] text-on-surface-2 mb-3 leading-relaxed">
        按模块透视本机 IndexedDB 占用，安全清理未被引用的孤儿附件、回收站或旧版残表。
      </p>

      {!data ? (
        <p className="text-[12.5px] text-on-surface-2 py-3">正在统计各模块空间占用…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="h-2 w-full rounded-full bg-surface-3 overflow-hidden flex">
            {segments.map((seg) =>
              seg.bytes > 0 ? (
                <span
                  key={seg.key}
                  title={`${seg.label}：${formatBytes(seg.bytes)}`}
                  className={seg.color}
                  style={{ width: `${Math.max(2, (seg.bytes / denom) * 100)}%` }}
                />
              ) : null,
            )}
          </div>

          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[12px]">
            {segments.map((seg) => (
              <li
                key={seg.key}
                className="flex items-center justify-between gap-2 rounded-[10px] bg-surface-2/70 border border-outline/60 px-2.5 py-1.5"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`size-2 rounded-full shrink-0 ${seg.color}`} aria-hidden />
                  <span className="truncate font-medium">{seg.label}</span>
                  <span className="text-[11px] text-on-surface-2 shrink-0">{seg.count}</span>
                </span>
                <span className="tabular-nums text-on-surface-2 shrink-0">{formatBytes(seg.bytes)}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              state={orphanBtn.state}
              disabled={data.orphanBlobCount === 0}
              onClick={() => {
                void orphanBtn.run(async () => {
                  const r = await cleanOrphanBlobs()
                  await scan()
                  onChanged?.()
                  toast(r.count ? `已清理 ${r.count} 个孤儿附件，释放 ${formatBytes(r.bytes)}` : '没有可清理的孤儿附件')
                }).catch(() => toast('清理孤儿附件失败'))
              }}
            >
              <Sparkles size={14} /> 清理孤儿附件{data.orphanBlobCount > 0 ? ` (${data.orphanBlobCount})` : ''}
            </Button>

            <Button
              variant="outline"
              size="sm"
              state={trashBtn.state}
              disabled={data.trashDocCount === 0}
              onClick={() => setConfirmTrash(true)}
            >
              <Trash2 size={14} /> 清空回收站{data.trashDocCount > 0 ? ` (${data.trashDocCount})` : ''}
            </Button>

            {data.legacyAiCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                state={legacyBtn.state}
                onClick={() => {
                  void legacyBtn.run(async () => {
                    const n = await cleanLegacyAiTables()
                    await scan()
                    onChanged?.()
                    toast(`已清理 ${n} 条旧版 AI 残余记录`)
                  }).catch(() => toast('清理旧残表失败'))
                }}
              >
                <Trash2 size={14} /> 清理旧 AI 残表 ({data.legacyAiCount})
              </Button>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={confirmTrash}
        onOpenChange={setConfirmTrash}
        title="彻底清空回收站"
        description={`将永久删除回收站中的 ${data?.trashDocCount ?? 0} 篇文档并释放约 ${formatBytes(data?.trashBlobBytes ?? 0)} 空间，此操作不可撤销。`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmTrash(false)}>取消</Button>
          <Button
            variant="destructive"
            state={trashBtn.state}
            onClick={() => {
              void trashBtn.run(async () => {
                const r = await purgeDocTrash()
                setConfirmTrash(false)
                await scan()
                onChanged?.()
                toast(`已彻底清空 ${r.count} 篇回收站文档，释放 ${formatBytes(r.bytes)}`)
              }).catch(() => toast('清空回收站失败'))
            }}
          >
            确认清空
          </Button>
        </div>
      </Dialog>
    </section>
  )
}
