import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useUi } from '@/stores/ui'
import { Button } from '@/shared/ui/Button'
import { JellySwitch } from '@/shared/ui/JellySwitch'
import { fmtDateTime } from '@/lib/date'
import { isNative, isTauri } from '@/lib/native'
import { cn } from '@/lib/cn'
import {
  JIANGUOYUN_URL, getLastSyncAt, getLastSyncError, getWebdavConfig, setWebdavConfig, syncNow,
  type SyncFailure, type WebdavConfig,
} from '@/lib/sync'

/** 同步分区：坚果云预设，只填账号和应用密码 */
export function SyncTab() {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <WebdavCard />
    </div>
  )
}

/**
 * 坚果云同步：默认只填账号 + 应用密码，目录固定为 JIANGUOYUN_URL；
 * 用别家 WebDAV 的在「高级」里改地址。口令只存本机，不随同步/备份导出。
 */
function WebdavCard() {
  const toast = useUi((s) => s.toast)
  const [cfg, setCfg] = useState<WebdavConfig>({ url: JIANGUOYUN_URL, username: '', password: '', auto: true })
  const [last, setLast] = useState<number | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [lastError, setLastError] = useState<SyncFailure | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void Promise.all([getWebdavConfig(), getLastSyncAt(), getLastSyncError()]).then(([c, l, err]) => {
      if (c) setCfg({ ...c, url: c.url || JIANGUOYUN_URL })
      setLast(l)
      setLastError(err)
    })
  }, [])

  const custom = cfg.url.trim() !== '' && cfg.url.trim() !== JIANGUOYUN_URL
  const ready = cfg.username.trim() !== '' && cfg.password !== ''

  const persist = async (next: WebdavConfig) => {
    const fixed = { ...next, url: next.url.trim() || JIANGUOYUN_URL }
    setCfg(fixed)
    await setWebdavConfig(fixed)
  }
  const patch = (p: Partial<WebdavConfig>) => void persist({ ...cfg, ...p })

  const sync = async () => {
    if (busy) return
    if (!ready) {
      setNote({ ok: false, text: '请先填写坚果云账号和应用密码' })
      return
    }
    setBusy(true)
    setNote(null)
    await persist(cfg)
    try {
      const r = await syncNow()
      setLast(r.at)
      setLastError(null)
      setNote({
        ok: true,
        text: `已同步：${r.tasks} 条任务、${r.docs} 篇文档（上传 ${r.blobsUp} / 下载 ${r.blobsDown} 个文件）`
          + (r.pendingLocal > 0 ? `；另有 ${r.pendingLocal} 条同步期间的改动已保留，下次同步会推送` : '')
          + (r.mathNotes.ok ? '' : `；手写计算笔记这次没同步上（${r.mathNotes.error}），下次同步会重试`),
      })
      toast('同步完成')
    } catch (e) {
      const text = e instanceof Error ? e.message : '同步失败'
      setNote({ ok: false, text })
      setLastError({ at: Date.now(), message: text })
      toast(text)
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'w-full h-10 px-3 rounded-[10px] bg-surface border border-outline text-[13px] outline-none focus:border-primary/60'

  return (
    <section className="card p-4 flex flex-col gap-3">
      <div>
        <h2 className="text-[14px] font-semibold mb-0.5">坚果云同步</h2>
        <p className="text-[12.5px] text-on-surface-2 leading-relaxed">
          手机和电脑填同一个坚果云账号，就共用同一份任务、文档和批注。应用密码在坚果云网页版
          「账户信息 → 安全选项 → 第三方应用管理」里生成，不是登录密码。
        </p>
      </div>

      {!isNative() && !isTauri() && (
        <p className="text-[12.5px] leading-relaxed text-danger">
          网页版受浏览器跨域限制，连不上坚果云。电脑上请安装 Windows 桌面版（GitHub Releases 里的 Kairos 安装包），手机用安卓 App。
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[12px] font-medium text-on-surface-2 mb-1">坚果云账号</span>
          <input
            value={cfg.username}
            onChange={(e) => setCfg({ ...cfg, username: e.target.value })}
            onBlur={() => patch({ username: cfg.username.trim() })}
            placeholder="注册邮箱或手机号"
            autoComplete="username"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-on-surface-2 mb-1">应用密码</span>
          <input
            value={cfg.password}
            onChange={(e) => setCfg({ ...cfg, password: e.target.value })}
            onBlur={() => patch({ password: cfg.password })}
            type="password"
            autoComplete="current-password"
            className={inputCls}
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-[12.5px] text-on-surface-2">
          <JellySwitch checked={cfg.auto} onChange={() => patch({ auto: !cfg.auto })} label="自动同步" />
          打开应用时自动同步（间隔 ≥ 10 分钟）
        </label>
        <Button variant="primary" size="sm" state={busy ? 'loading' : 'idle'} onClick={() => void sync()}>
          立即同步
        </Button>
      </div>

      {note && (
        <p className={cn('text-[12px] leading-relaxed', note.ok ? 'text-primary' : 'text-danger')}>{note.text}</p>
      )}
      {!note && lastError && (
        <p className="text-[12px] leading-relaxed text-danger">
          上次同步失败（{fmtDateTime(lastError.at)}）：{lastError.message}
        </p>
      )}
      <p className="text-[11.5px] text-on-surface-2">{last ? `上次同步：${fmtDateTime(last)}` : '还没有同步过'}</p>

      <details className="group" open={custom || undefined}>
        <summary className="cursor-pointer select-none text-[12px] text-on-surface-2 list-none flex items-center gap-1">
          <ChevronRight size={13} className="transition-transform group-open:rotate-90" />
          高级：使用其他 WebDAV
        </summary>
        <label className="block mt-2">
          <span className="block text-[12px] font-medium text-on-surface-2 mb-1">目录地址（留空即坚果云）</span>
          <input
            value={custom ? cfg.url : ''}
            onChange={(e) => setCfg({ ...cfg, url: e.target.value })}
            onBlur={() => patch({ url: cfg.url })}
            placeholder={JIANGUOYUN_URL}
            className={inputCls}
          />
        </label>
      </details>
    </section>
  )
}
