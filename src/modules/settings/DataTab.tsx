import { useEffect, useRef, useState } from 'react'
import { Download, FileArchive, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useUi } from '@/stores/ui'
import { db } from '@/db/db'
import { ALL_BACKUP_SCOPES, exportAll, type BackupScope, type ImportMode } from '@/db/tasks'
import { exportBackupZip, importBackupFile, inspectBackupFile, type BackupPreview } from '@/db/zipBackup'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { Segmented } from '@/shared/ui/Segmented'
import { TopProgressLine } from '@/shared/ui/TopProgressLine'
import { clearLegacySnapshots, countLegacySnapshots } from '@/lib/legacySnapshots'
import { fmtDateTime, todayStr } from '@/lib/date'
import { isSaveCancelled, openSavedAction, saveBlob } from '@/lib/saveFile'
import { isNative, isTauri } from '@/lib/native'
import { syncAllTaskNotifications } from '@/lib/notify'
import { cn } from '@/lib/cn'
import { NotifyCard } from './NotifyCard'
import { ModelCenterCard } from './ModelCenterCard'
import { StorageDiagnosticsCard } from './StorageDiagnosticsCard'

const LAST_BACKUP_KEY = 'lastManualBackupAt'
const BACKUP_REMIND_MS = 7 * 24 * 60 * 60 * 1000

const SCOPE_OPTIONS: { id: BackupScope; label: string }[] = [
  { id: 'tasks', label: '任务与专注记录' },
  { id: 'docs', label: '文档、附件与批注' },
  { id: 'mathNotes', label: '手写计算笔记' },
  { id: 'settings', label: '外观、模型额度与工具记录' },
]

export function DataTab({ onGoSync }: { onGoSync: () => void }) {
  const [usage, setUsage] = useState<string>('')
  const [lastBackup, setLastBackup] = useState<number | null>(null)
  const [confirmSnapshots, setConfirmSnapshots] = useState(false)
  const [snapshotCount, setSnapshotCount] = useState(0)
  const [pendingRestore, setPendingRestore] = useState<{ file: File; preview: BackupPreview } | null>(null)
  const [restoreMode, setRestoreMode] = useState<ImportMode>('merge')
  const [restoreScopes, setRestoreScopes] = useState<BackupScope[]>(ALL_BACKUP_SCOPES)
  const toast = useUi((s) => s.toast)
  const fileRef = useRef<HTMLInputElement>(null)

  const refreshUsage = () => {
    void navigator.storage?.estimate?.().then((est) => {
      if (est?.usage != null) setUsage(`${(est.usage / 1024 / 1024).toFixed(1)} MB`)
    })
  }

  useEffect(() => {
    refreshUsage()
    void db.settings.get(LAST_BACKUP_KEY).then((row) => {
      if (typeof row?.value === 'number') setLastBackup(row.value)
    })
    void countLegacySnapshots().then(setSnapshotCount).catch(() => undefined)
  }, [])

  const backupStale = lastBackup == null || Date.now() - lastBackup > BACKUP_REMIND_MS
  const { state: exportZipState, run: runExportZip } = useAsyncButton()
  const { state: exportJsonState, run: runExportJson } = useAsyncButton()

  const markBackedUp = () => {
    const at = Date.now()
    setLastBackup(at)
    void db.settings.put({ key: LAST_BACKUP_KEY, value: at }).catch(() => undefined)
  }

  const doExportZip = async () => {
    try {
      await runExportZip(async () => {
        const blob = await exportBackupZip()
        const where = await saveBlob(blob, `Kairos备份-${todayStr()}.kairos.zip`)
        if (!where) return
        markBackedUp()
        toast(`压缩备份已导出 → ${where}`, openSavedAction())
      })
    } catch (err) {
      if (!isSaveCancelled(err)) toast('导出压缩备份失败，请重试')
    }
  }

  const doExportJson = async () => {
    try {
      await runExportJson(async () => {
        const json = await exportAll()
        const blob = new Blob([json], { type: 'application/json' })
        // 本地日期，别用 toISOString（UTC 会让凌晨导出的文件名变成昨天）
        const where = await saveBlob(blob, `Kairos备份-${todayStr()}.json`)
        if (!where) return
        markBackedUp()
        toast(`JSON 备份已导出 → ${where}`, openSavedAction())
      })
    } catch (err) {
      if (!isSaveCancelled(err)) toast('导出失败，请重试')
    }
  }

  const { state: importState, run: runImport } = useAsyncButton()

  const onSelectBackupFile = async (file: File) => {
    try {
      const preview = await inspectBackupFile(file)
      setRestoreMode('merge')
      setRestoreScopes(ALL_BACKUP_SCOPES)
      setPendingRestore({ file, preview })
    } catch (err) {
      toast(`备份无法解析：${err instanceof Error ? err.message : '文件格式不支持'}`)
    }
  }

  const confirmRestore = async () => {
    if (!pendingRestore || restoreScopes.length === 0) return
    const { file } = pendingRestore
    try {
      await runImport(async () => {
        const r = await importBackupFile(file, { mode: restoreMode, scopes: restoreScopes })
        setPendingRestore(null)
        void db.tasks.toArray().then((rows) => syncAllTaskNotifications(rows)).catch(() => undefined)
        refreshUsage()
        const parts = [
          restoreScopes.includes('tasks') ? `${r.tasks} 条任务` : '',
          restoreScopes.includes('docs') && r.docs ? `${r.docs} 篇文档` : '',
        ].filter(Boolean)
        const head = parts.length ? `已恢复 ${parts.join('、')}` : '所选分区已恢复'
        toast(r.warnings.length ? `${head}；${r.warnings[0]}` : head)
      })
    } catch (err) {
      toast(`导入失败：${err instanceof Error ? err.message : '文件无法解析'}`)
    }
  }

  const toggleScope = (id: BackupScope) => {
    setRestoreScopes((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const { state: snapshotState, run: runClearSnapshots } = useAsyncButton()

  const saveHintWhere = isNative() ? '「下载/个人工作站」' : isTauri() ? '你选择的保存位置' : '系统下载目录'

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      {/* 提醒通知（仅安卓 App 生效） */}
      {isNative() && <NotifyCard />}

      <section className="card relative overflow-hidden p-4">
        <TopProgressLine
          active={exportZipState === 'loading' || exportJsonState === 'loading' || importState === 'loading'}
          label="正在导出或恢复备份"
        />
        <h2 className="text-[14px] font-semibold mb-1">备份与恢复</h2>
        <p className="text-[13px] text-on-surface-2 mb-3.5 leading-relaxed">
          所有数据保存在本机。推荐导出 <code>.kairos.zip</code> 压缩包（原始二进制文档体积更小、更快），也兼容导入旧版 JSON 备份。
          {usage && ` 当前占用约 ${usage}。`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" state={exportZipState} onClick={() => void doExportZip()}>
            <FileArchive size={15} /> 导出压缩备份 (.zip)
          </Button>
          <Button variant="outline" size="sm" state={exportJsonState} onClick={() => void doExportJson()}>
            <Download size={15} /> 兼容 JSON
          </Button>
          <Button variant="outline" size="sm" state={importState} onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> 导入备份
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,.kairos.zip,application/zip,application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onSelectBackupFile(f)
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
        {snapshotCount > 0 && (
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setConfirmSnapshots(true)}>
            <Trash2 size={14} /> 清理旧快照（{snapshotCount}）
          </Button>
        )}

        <Dialog
          open={Boolean(pendingRestore)}
          onOpenChange={(v) => { if (!v) setPendingRestore(null) }}
          title="恢复备份预览"
          description={pendingRestore?.preview.exportedAt
            ? `备份时间：${fmtDateTime(Date.parse(pendingRestore.preview.exportedAt))}（${pendingRestore.preview.format.toUpperCase()}）`
            : `格式：${pendingRestore?.preview.format.toUpperCase() ?? ''}`}
        >
          {pendingRestore && (
            <div className="flex flex-col gap-3.5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                {[
                  ['任务', pendingRestore.preview.counts.tasks],
                  ['文档', pendingRestore.preview.counts.docs],
                  ['批注', pendingRestore.preview.counts.annotations],
                  ['手写笔记', pendingRestore.preview.counts.mathNotes],
                ].map(([label, n]) => (
                  <div key={String(label)} className="rounded-[10px] bg-surface-2 border border-outline/70 px-2.5 py-2">
                    <p className="text-[15px] font-semibold tabular-nums">{n}</p>
                    <p className="text-[11px] text-on-surface-2">{label}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[12.5px] font-medium">恢复方式</span>
                  <Segmented<ImportMode>
                    size="sm"
                    ariaLabel="备份恢复方式"
                    value={restoreMode}
                    onChange={setRestoreMode}
                    options={[
                      { value: 'merge', label: '合并导入' },
                      { value: 'replace', label: '覆盖所选' },
                    ]}
                  />
                </div>
                <p className="text-[11.5px] text-on-surface-2 leading-relaxed">
                  {restoreMode === 'merge'
                    ? '合并导入：同 ID 覆盖，保留本机其他数据（且自动解除对应墓碑防同步误删）。'
                    : '覆盖所选：清空所选分区的当前数据后再整份还原；本机 WebDAV 口令等设置始终保留。'}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-medium">选择性恢复分区</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {SCOPE_OPTIONS.map((opt) => {
                    const checked = restoreScopes.includes(opt.id)
                    return (
                      <label
                        key={opt.id}
                        className={cn(
                          'flex items-center gap-2 rounded-[10px] border px-2.5 py-2 text-[12.5px] cursor-pointer transition-colors',
                          checked ? 'border-primary/50 bg-primary-soft/50 text-on-surface' : 'border-outline bg-surface-2 text-on-surface-2',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleScope(opt.id)}
                          className="accent-[var(--primary)]"
                        />
                        <span>{opt.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              {pendingRestore.preview.warnings.length > 0 && (
                <p className="rounded-[10px] bg-p1/10 px-3 py-2 text-[11.5px] text-p1 leading-relaxed">
                  提示：{pendingRestore.preview.warnings[0]}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPendingRestore(null)}>取消</Button>
                <Button
                  variant={restoreMode === 'replace' ? 'destructive' : 'primary'}
                  state={importState}
                  disabled={restoreScopes.length === 0}
                  onClick={() => void confirmRestore()}
                >
                  {restoreMode === 'replace' ? '确认覆盖恢复' : '确认合并导入'}
                </Button>
              </div>
            </div>
          )}
        </Dialog>

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
                setSnapshotCount(0)
                setConfirmSnapshots(false)
                toast(count ? `已清理 ${count} 份旧快照` : '没有旧快照需要清理')
              }).catch(() => toast('清理旧快照失败，请重试'))
            }}>清理</Button>
          </div>
        </Dialog>
      </section>

      <ModelCenterCard onChanged={refreshUsage} />

      <StorageDiagnosticsCard onChanged={refreshUsage} />

      <section className="card p-4">
        <h2 className="text-[14px] font-semibold mb-1">数据安全</h2>
        <ul className="text-[12.5px] text-on-surface-2 leading-relaxed flex flex-col gap-1.5">
          <li>· 任务、文档、批注都只保存在本机，不会上传到任何服务器。</li>
          <li>· 每周导出一次压缩备份，文件会落在{saveHintWhere}，重装或换机后可按需合并或覆盖恢复。</li>
          <li>· 想在手机和电脑之间自动共用一份数据，可以开启坚果云同步，云端会保留副本。</li>
        </ul>
        <Button variant="outline" size="sm" className="mt-3" onClick={onGoSync}>
          <RefreshCw size={15} /> 去开启同步
        </Button>
      </section>
    </div>
  )
}
