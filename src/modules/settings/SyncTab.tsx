import { useEffect, useState } from 'react'
import { ChevronRight, Eye, EyeOff, PlugZap } from 'lucide-react'
import { useUi } from '@/stores/ui'
import { Button } from '@/shared/ui/Button'
import { JellySwitch } from '@/shared/ui/JellySwitch'
import { Segmented } from '@/shared/ui/Segmented'
import { fmtDateTime } from '@/lib/date'
import { isNative, isTauri } from '@/lib/native'
import { cn } from '@/lib/cn'
import {
  JIANGUOYUN_URL, getLastSyncAt, getLastSyncError, getWebdavConfig, setWebdavConfig, syncNow, testWebdav,
  type SyncFailure, type WebdavConfig,
} from '@/lib/sync'

type BlobPolicy = 'all' | '20mb' | 'meta'

function policyOf(maxBlobMb?: number): BlobPolicy {
  if (maxBlobMb === 0) return 'meta'
  if (typeof maxBlobMb === 'number' && maxBlobMb > 0) return '20mb'
  return 'all'
}

function isInsecurePublicHttp(url: string): boolean {
  const trimmed = url.trim()
  if (!/^http:\/\//i.test(trimmed)) return false
  try {
    const host = new URL(trimmed).hostname.toLowerCase()
    return !(host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('192.168.') || host.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(host))
  } catch {
    return true
  }
}

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
  const [customUrlDraft, setCustomUrlDraft] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [last, setLast] = useState<number | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [lastError, setLastError] = useState<SyncFailure | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    void Promise.all([getWebdavConfig(), getLastSyncAt(), getLastSyncError()]).then(([c, l, err]) => {
      if (c) {
        const resolved = { ...c, url: c.url || JIANGUOYUN_URL }
        setCfg(resolved)
        if (resolved.url !== JIANGUOYUN_URL) setCustomUrlDraft(resolved.url)
      }
      setLast(l)
      setLastError(err)
    })
  }, [])

  const custom = customUrlDraft.trim() !== '' && customUrlDraft.trim() !== JIANGUOYUN_URL
  const ready = cfg.username.trim() !== '' && cfg.password !== ''
  const insecureHttp = isInsecurePublicHttp(customUrlDraft || cfg.url)

  const persist = async (next: WebdavConfig) => {
    const fixed = { ...next, url: next.url.trim() || JIANGUOYUN_URL }
    setCfg(fixed)
    await setWebdavConfig(fixed)
  }
  const patch = (p: Partial<WebdavConfig>) => void persist({ ...cfg, ...p })

  const handleTest = async () => {
    if (testing || busy) return
    if (!ready) {
      setNote({ ok: false, text: '请先填写账号和应用密码' })
      return
    }
    setTesting(true)
    setNote(null)
    const nextCfg: WebdavConfig = {
      ...cfg,
      username: cfg.username.trim(),
      url: customUrlDraft.trim() || JIANGUOYUN_URL,
    }
    await persist(nextCfg)
    try {
      const r = await testWebdav(nextCfg)
      setNote({ ok: r.ok, text: r.message })
    } finally {
      setTesting(false)
    }
  }

  const sync = async () => {
    if (busy) return
    if (!ready) {
      setNote({ ok: false, text: '请先填写坚果云账号和应用密码' })
      return
    }
    setBusy(true)
    setNote(null)
    const nextCfg: WebdavConfig = {
      ...cfg,
      username: cfg.username.trim(),
      url: customUrlDraft.trim() || JIANGUOYUN_URL,
    }
    await persist(nextCfg)
    try {
      const r = await syncNow()
      setLast(r.at)
      setLastError(null)
      setNote({
        ok: true,
        text: `已同步：${r.tasks} 条任务、${r.docs} 篇文档（上传 ${r.blobsUp} / 下载 ${r.blobsDown} 个文件`
          + (r.blobsSkipped ? `，按策略跳过 ${r.blobsSkipped} 个大附件` : '')
          + '）'
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
        <p className="rounded-lg bg-primary-soft px-3 py-2 text-[12.5px] leading-relaxed text-on-surface">
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
          <div className="relative">
            <input
              value={cfg.password}
              onChange={(e) => setCfg({ ...cfg, password: e.target.value })}
              onBlur={() => patch({ password: cfg.password })}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className={cn(inputCls, 'pr-9')}
            />
            <button
              type="button"
              aria-label={showPassword ? '隐藏应用密码' : '显示应用密码'}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 grid place-items-center w-7 h-7 rounded-[7px] text-on-surface-2 hover:text-on-surface hover:bg-surface-3 cursor-pointer"
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[12px] font-medium text-on-surface-2">文档附件同步策略</span>
          <Segmented<BlobPolicy>
            size="sm"
            ariaLabel="文档附件同步策略"
            value={policyOf(cfg.maxBlobMb)}
            onChange={(v) => patch({ maxBlobMb: v === 'all' ? undefined : v === '20mb' ? 20 : 0 })}
            options={[
              { value: 'all', label: '全部同步' },
              { value: '20mb', label: '≤20MB' },
              { value: 'meta', label: '仅元数据' },
            ]}
          />
        </div>
        <p className="text-[11.5px] text-on-surface-2 leading-relaxed">
          默认全量同步兼容现有多端数据；文档库偏大或触发坚果云限流时，可切换「≤20MB」或「仅元数据」，超限文档在阅读时按需拉取。
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-[12.5px] text-on-surface-2">
          <JellySwitch checked={cfg.auto} onChange={() => patch({ auto: !cfg.auto })} label="自动同步" />
          打开应用时自动同步（间隔 ≥ 10 分钟，限流自动退避）
        </label>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" state={testing ? 'loading' : 'idle'} disabled={busy} onClick={() => void handleTest()}>
            <PlugZap size={14} /> 测试连接
          </Button>
          <Button variant="primary" size="sm" state={busy ? 'loading' : 'idle'} disabled={testing} onClick={() => void sync()}>
            立即同步
          </Button>
        </div>
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
            value={customUrlDraft}
            onChange={(e) => setCustomUrlDraft(e.target.value)}
            onBlur={() => {
              const trimmed = customUrlDraft.trim()
              setCustomUrlDraft(trimmed === JIANGUOYUN_URL ? '' : trimmed)
              patch({ url: trimmed || JIANGUOYUN_URL })
            }}
            placeholder={JIANGUOYUN_URL}
            className={inputCls}
          />
        </label>
        {insecureHttp && (
          <p className="mt-1.5 text-[11.5px] text-p1 leading-relaxed">
            注意：非局域网 HTTP 地址会以明文传输账号密码，建议改用 HTTPS。
          </p>
        )}
      </details>
    </section>
  )
}
