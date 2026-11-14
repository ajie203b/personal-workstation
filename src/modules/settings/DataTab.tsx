import { useEffect, useRef, useState } from 'react'
import { Download, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useUi } from '@/stores/ui'
import { db } from '@/db/db'
import { exportAll, importAll } from '@/db/tasks'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { clearLegacySnapshots } from '@/lib/legacySnapshots'
import { fmtDateTime, todayStr } from '@/lib/date'
import { openSavedAction, saveBlob } from '@/lib/saveFile'
import { isNative } from '@/lib/native'
import { clearModelCache, modelCacheBytes } from '@/lib/modelCache'
import { cn } from '@/lib/cn'
import { NotifyCard } from './NotifyCard'

const LAST_BACKUP_KEY = 'lastManualBackupAt'
const BACKUP_REMIND_MS = 7 * 24 * 60 * 60 * 1000

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export function DataTab({ onGoSync }: { onGoSync: () => void }) {
  const [usage, setUsage] = useState<string>('')
  const [lastBackup, setLastBackup] = useState<number | null>(null)
  const [modelBytes, setModelBytes] = useState<number | null>(null)
  const [confirmSnapshots, setConfirmSnapshots] = useState(false)
  const toast = useUi((s) => s.toast)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void navigator.storage?.estimate?.().then((est) => {
      if (est?.usage != null) setUsage(`${(est.usage / 1024 / 1024).toFixed(1)} MB`)
    })
    void db.settings.get(LAST_BACKUP_KEY).then((row) => {
      if (typeof row?.value === 'number') setLastBackup(row.value)
    })
    void modelCacheBytes().then((bytes) => setModelBytes(bytes))
  }, [])

  const backupStale = lastBackup == null || Date.now() - lastBackup > BACKUP_REMIND_MS
  const { state: exportState, run: runExport } = useAsyncButton()

  const doExport = async () => {
    try {
      await runExport(async () => {
        const json = await exportAll()
        const blob = new Blob([json], { type: 'application/json' })
        // 本地日期，别用 toISOString（UTC 会让凌晨导出的文件名变成昨天）
        const where = await saveBlob(blob, `个人工作站备份-${todayStr()}.json`)
        const at = Date.now()
        setLastBackup(at)
        void db.settings.put({ key: LAST_BACKUP_KEY, value: at }).catch(() => undefined)
        toast(`备份已导出 → ${where}`, openSavedAction())
      })
    } catch {
      toast('导出失败，请重试')
    }
  }

  const { state: importState, run: runImport } = useAsyncButton()

  const doImport = async (file: File) => {
    try {
      await runImport(async () => {
        const json = await file.text()
        const r = await importAll(json)
        toast(r.warnings.length ? `已导入 ${r.tasks} 条任务；${r.warnings[0]}` : `已导入 ${r.tasks} 条任务`)
      })
    } catch (err) {
      toast(`导入失败：${err instanceof Error ? err.message : '文件无法解析'}`)
    }
  }

  const { state: clearCacheState, run: runClearCache } = useAsyncButton({ successHoldMs: 900 })
  const { state: snapshotState, run: runClearSnapshots } = useAsyncButton()

  const doClearModelCache = async () => {
    try {
      await runClearCache(async () => {
        await clearModelCache()
        setModelBytes(0)
        toast('已清理离线 AI 模型缓存，下次使用时会自动重新下载')
      })
    } catch {
      toast('清理模型缓存失败')
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      {/* 提醒通知（仅安卓 App 生效） */}
      {isNative() && <NotifyCard />}

      <section className="card p-4">
        <h2 className="text-[14px] font-semibold mb-1">备份与恢复</h2>
        <p className="text-[13px] text-on-surface-2 mb-3.5 leading-relaxed">
          所有数据保存在本机（IndexedDB）。换设备、清除浏览器数据或卸载应用前，先导出一份 JSON 备份。
          {usage && ` 当前占用约 ${usage}。`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" state={exportState} onClick={() => void doExport()}>
            <Download size={15} /> 导出备份
          </Button>
          <Button variant="outline" size="sm" state={importState} onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> 导入备份
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void doImport(f)
              e.target.value = ''
            }}
          />
        </div>
        <div
          className={cn(
            'mt-3 rounded-[10px] px-3 py-2 text-[12px] leading-relaxed',
            backupStale ? 'bg-p1/10 text-p1' : 'bg-ok/10 text-ok',
          )}
        >
          {lastBackup
            ? `上次导出：${fmtDateTime(lastBackup)}`
            : '还没有导出过备份'}
          {backupStale ? ' · 建议现在导出一次，之后每周一次即可' : ' · 备份状态良好'}
        </div>
        {'getDirectory' in (navigator.storage ?? {}) && (
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setConfirmSnapshots(true)}>
            <Trash2 size={14} /> 清理旧快照
          </Button>
        )}
        <Dialog
          open={confirmSnapshots}
          onOpenChange={setConfirmSnapshots}
          title="清理旧快照"
          description="旧版本自动生成的快照可能含有旧 AI Key。清理会永久删除这些快照，当前任务、文档和手动导出的备份仍可使用。"
        >
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmSnapshots(false)}>取消</Button>
            <Button variant="destructive" state={snapshotState} onClick={() => {
              void runClearSnapshots(async () => {
                const count = await clearLegacySnapshots()
                setConfirmSnapshots(false)
                toast(count ? `已清理 ${count} 份旧快照` : '没有旧快照需要清理')
              }).catch(() => toast('清理旧快照失败，请重试'))
            }}>清理</Button>
          </div>
        </Dialog>
      </section>

      <section className="card p-4">
        <h2 className="text-[14px] font-semibold mb-1">离线 AI 模型缓存</h2>
        <p className="text-[13px] text-on-surface-2 mb-3 leading-relaxed">
          文字识别、手写公式识别等本地模型文件在首次使用时按需下载并缓存在本机，清理后不影响任务与文档数据。
        </p>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[12.5px] text-on-surface-2 tabular-nums">
            {modelBytes == null
              ? '正在计算缓存大小…'
              : modelBytes > 0
                ? `已缓存模型约 ${formatBytes(modelBytes)}`
                : '当前没有离线模型缓存'}
          </span>
          <Button
            variant="outline"
            size="sm"
            state={clearCacheState}
            disabled={!modelBytes}
            onClick={() => void doClearModelCache()}
          >
            <Trash2 size={14} /> 清理模型缓存
          </Button>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="text-[14px] font-semibold mb-1">数据安全</h2>
        <ul className="text-[12.5px] text-on-surface-2 leading-relaxed flex flex-col gap-1.5">
          <li>· 任务、文档、批注都只保存在本机，不会上传到任何服务器。</li>
          <li>· 每周导出一次 JSON 备份，文件会落在「下载/个人工作站」，重装或换机后可导入恢复。</li>
          <li>· 想在手机和电脑之间自动共用一份数据，可以开启坚果云同步，云端会保留副本。</li>
        </ul>
        <Button variant="outline" size="sm" className="mt-3" onClick={onGoSync}>
          <RefreshCw size={15} /> 去开启同步
        </Button>
      </section>
    </div>
  )
}
