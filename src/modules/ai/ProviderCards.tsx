import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CalendarClock, ExternalLink, Plus, Zap,
} from 'lucide-react'
import { db, type AiAssetKind, type AiProvider } from '@/db/db'
import {
  PROVIDER_PRESETS, SUBSCRIPTION_PRESETS, addProvider, deleteProvider, maskKey, providerBrand, testProvider, updateProvider,
} from '@/db/ai'
import { useUi } from '@/stores/ui'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { Segmented } from '@/shared/ui/Segmented'
import { cn } from '@/lib/cn'

const inputCls = 'w-full h-10 px-3 rounded-[10px] bg-surface-2 border border-outline text-[13.5px] outline-none focus:border-primary/60 transition-colors'
const FIELD = 'block text-[12px] font-medium text-on-surface-2 mb-1'
const CYCLE_LABEL: Record<string, string> = { monthly: '月付', yearly: '年付', once: '单次' }

/** 厂商品牌标 */
function BrandMark({ name, size = 38 }: { name: string; size?: number }) {
  const { mark, color } = providerBrand(name)
  return (
    <span
      className="grid place-items-center rounded-[10px] shrink-0 text-white font-bold"
      style={{ background: color, width: size, height: size, fontSize: mark.length > 2 ? 11 : mark.length > 1 ? 14 : 17 }}
    >
      {mark}
    </span>
  )
}

/** 到期倒计时徽标 */
function ExpiryBadge({ expiresAt }: { expiresAt: string }) {
  const days = Math.ceil((new Date(expiresAt + 'T23:59:59').getTime() - Date.now()) / 86400000)
  const expired = days < 0
  const soon = days >= 0 && days <= 7
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full',
        expired ? 'bg-danger/10 text-danger' : soon ? 'bg-p1/15 text-p1' : 'bg-surface-3 text-on-surface-2',
      )}
    >
      <CalendarClock size={11} />
      {expired ? `已过期 ${-days} 天` : days === 0 ? '今天到期' : `剩 ${days} 天`}
    </span>
  )
}

interface FormState {
  id?: string
  kind: AiAssetKind
  name: string
  planName: string
  expiresAt: string
  cycle: string
  account: string
  manageUrl: string
  baseUrl: string
  apiKey: string
  models: string
  pricePrompt: string
  priceCompletion: string
  quotaTotal: string
  quotaUsed: string
  quotaResetDay: string
}

const EMPTY_FORM: FormState = {
  kind: 'subscription', name: '', planName: '', expiresAt: '', cycle: 'monthly',
  account: '', manageUrl: '', baseUrl: '', apiKey: '', models: '',
  pricePrompt: '', priceCompletion: '', quotaTotal: '', quotaUsed: '', quotaResetDay: '',
}

/** AI 资产页：会员订阅 + API 套餐 统一管理（厂商图标 / 名称 / 到期时间） */
export function ProviderCards() {
  const providers = useLiveQuery(() => db.aiProviders.orderBy('createdAt').toArray(), [], [] as AiProvider[])
  const [form, setForm] = useState<FormState | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string; models?: string[] }>>({})
  const [pendingDelete, setPendingDelete] = useState<AiProvider | null>(null)
  const toast = useUi((s) => s.toast)

  const subs = (providers ?? []).filter((p) => p.kind === 'subscription')
  const apis = (providers ?? []).filter((p) => (p.kind ?? 'api') === 'api')

  const openCreate = (kind: AiAssetKind, preset?: { name: string; planName?: string; baseUrl?: string; models?: string[] }) => {
    setForm({
      ...EMPTY_FORM, kind,
      name: preset?.name === '自定义' ? '' : (preset?.name ?? ''),
      planName: preset?.planName ?? '',
      baseUrl: preset?.baseUrl ?? '',
      models: preset?.models?.join(', ') ?? '',
    })
  }

  const openEdit = (p: AiProvider) => {
    setForm({
      id: p.id, kind: p.kind ?? 'api', name: p.name, planName: p.planName ?? '',
      expiresAt: p.expiresAt ?? '', cycle: p.cycle ?? 'monthly',
      account: p.account ?? '', manageUrl: p.manageUrl ?? '',
      baseUrl: p.baseUrl ?? '', apiKey: '', models: (p.models ?? []).join(', '),
      pricePrompt: p.pricePrompt != null ? String(p.pricePrompt) : '',
      priceCompletion: p.priceCompletion != null ? String(p.priceCompletion) : '',
      quotaTotal: p.quotaTotal != null ? String(p.quotaTotal) : '',
      quotaUsed: p.quotaUsed != null ? String(p.quotaUsed) : '',
      quotaResetDay: p.quotaResetDay ?? '',
    })
  }

  const save = async () => {
    if (!form) return
    if (!form.name.trim()) {
      toast('请填写厂商名称')
      return
    }
    if (form.kind === 'subscription') {
      if (!form.expiresAt) {
        toast('请填写到期日')
        return
      }
      const payload = {
        kind: 'subscription' as const,
        name: form.name.trim(),
        planName: form.planName.trim() || undefined,
        expiresAt: form.expiresAt,
        cycle: (form.cycle || 'monthly') as 'monthly' | 'yearly' | 'once',
        account: form.account.trim() || undefined,
        manageUrl: form.manageUrl.trim() || undefined,
        models: [],
      }
      if (form.id) await updateProvider(form.id, payload)
      else await addProvider(payload)
      toast('订阅已保存')
      setForm(null)
      return
    }
    // API 资产
    if (!form.baseUrl.trim()) {
      toast('请填写接口地址')
      return
    }
    const payload = {
      kind: 'api' as const,
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim().replace(/\/$/, ''),
      models: form.models.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean),
      pricePrompt: form.pricePrompt ? Number(form.pricePrompt) : undefined,
      priceCompletion: form.priceCompletion ? Number(form.priceCompletion) : undefined,
      quotaTotal: form.quotaTotal ? Number(form.quotaTotal) : undefined,
      quotaUsed: form.quotaUsed ? Number(form.quotaUsed) : undefined,
      quotaResetDay: form.quotaResetDay || undefined,
    }
    if (form.id) {
      await updateProvider(form.id, { ...payload, ...(form.apiKey ? { apiKey: form.apiKey.trim() } : {}) })
      toast('已保存')
    } else {
      if (!form.apiKey.trim()) {
        toast('请填写 API Key')
        return
      }
      await addProvider({ ...payload, apiKey: form.apiKey.trim() })
      toast('API 套餐已添加')
    }
    setForm(null)
  }

  const doTest = async (p: AiProvider) => {
    setTesting(p.id)
    const r = await testProvider(p)
    setTestResult((s) => ({ ...s, [p.id]: { ok: r.ok, msg: r.ok ? `连接成功 · ${r.models?.length ?? 0} 个模型` : (r.error ?? '失败'), models: r.models } }))
    setTesting(null)
  }

  return (
    <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <p className="text-[12.5px] text-on-surface-2">管理你的 AI 会员与 API 套餐；Key / 账号信息只存本机。</p>
        <Button variant="primary" size="sm" className="ml-auto shrink-0" onClick={() => openCreate('subscription')}>
          <Plus size={14} /> 添加资产
        </Button>
      </div>

      {providers?.length === 0 && (
        <div className="card p-5">
          <p className="text-[13.5px] font-semibold mb-2 flex items-center gap-1.5"><Zap size={15} /> 从预设开始</p>
          <p className="text-[11.5px] text-on-surface-2 mb-1.5">会员订阅</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {SUBSCRIPTION_PRESETS.map((p) => (
              <button key={p.name} onClick={() => openCreate('subscription', p)} className="px-3 h-9 rounded-full bg-surface-3 hover:bg-primary-soft hover:text-primary text-[13px] transition-colors cursor-pointer">
                {p.planName || p.name}
              </button>
            ))}
          </div>
          <p className="text-[11.5px] text-on-surface-2 mb-1.5">API 套餐</p>
          <div className="flex flex-wrap gap-2">
            {PROVIDER_PRESETS.map((p) => (
              <button key={p.name} onClick={() => openCreate('api', p)} className="px-3 h-9 rounded-full bg-surface-3 hover:bg-primary-soft hover:text-primary text-[13px] transition-colors cursor-pointer">
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 会员订阅 */}
      {subs.length > 0 && (
        <section>
          <h2 className="text-[13px] font-semibold text-on-surface-2 mb-2 px-1">会员订阅 · {subs.length}</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {subs.map((p) => (
              <div key={p.id} className="card px-4 py-3.5 flex gap-3">
                <BrandMark name={p.name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14.5px] font-semibold truncate">{p.name}</span>
                    {p.planName && <span className="text-[12px] text-on-surface-2 truncate">{p.planName}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {p.expiresAt && <ExpiryBadge expiresAt={p.expiresAt} />}
                    {p.cycle && p.cycle !== 'once' && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-3 text-on-surface-2">{CYCLE_LABEL[p.cycle]}</span>
                    )}
                    {p.expiresAt && (
                      <span className="text-[11px] text-on-surface-2">{new Date(p.expiresAt + 'T00:00:00').toLocaleDateString('zh-CN')} 到期</span>
                    )}
                  </div>
                  {p.account && <p className="text-[11px] text-on-surface-2 mt-1.5 truncate">账号：{p.account}</p>}
                  <div className="flex items-center gap-3 mt-2 text-[12px]">
                    {p.manageUrl && (
                      <a href={p.manageUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                        管理订阅 <ExternalLink size={11} />
                      </a>
                    )}
                    <button className="text-on-surface-2 hover:text-on-surface cursor-pointer" onClick={() => openEdit(p)}>编辑</button>
                    <button className="text-on-surface-2 hover:text-danger cursor-pointer" onClick={() => setPendingDelete(p)}>删除</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* API 套餐 */}
      {apis.length > 0 && (
        <section>
          <h2 className="text-[13px] font-semibold text-on-surface-2 mb-2 px-1">API 套餐 · {apis.length}</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {apis.map((p) => {
              const tr = testResult[p.id]
              const quotaPct = p.quotaTotal ? Math.min(100, Math.round(((p.quotaUsed ?? 0) / p.quotaTotal) * 100)) : null
              return (
                <div key={p.id} className="card px-4 py-3.5 flex flex-col gap-2">
                  <div className="flex items-center gap-2.5">
                    <BrandMark name={p.name} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14.5px] font-semibold truncate leading-tight">{p.name}</p>
                      <p className="text-[11px] text-on-surface-2 truncate leading-tight mt-0.5">{p.baseUrl}</p>
                    </div>
                    <span
                      className={cn('w-2.5 h-2.5 rounded-full shrink-0', p.apiKey ? 'bg-ok' : 'bg-surface-3 border border-outline')}
                      title={p.apiKey ? 'Key 已配置' : '未配置 Key'}
                    />
                  </div>
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="font-mono bg-surface-3 px-2 py-1 rounded-lg text-on-surface-2">{maskKey(p.apiKey ?? '')}</span>
                    <button className="text-primary hover:underline cursor-pointer" onClick={() => openEdit(p)}>更换</button>
                    <button className="text-on-surface-2 hover:text-on-surface cursor-pointer" onClick={() => void doTest(p)}>
                      {testing === p.id ? '测试中…' : '测试连接'}
                    </button>
                    {tr && <span className={cn('text-[11px]', tr.ok ? 'text-ok' : 'text-danger')}>{tr.msg}</span>}
                  </div>
                  {(p.models ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {(p.models ?? []).slice(0, 6).map((m) => (
                        <span key={m} className="text-[10.5px] px-2 py-0.5 rounded-full bg-surface-3 text-on-surface-2 font-mono">{m}</span>
                      ))}
                      {(p.models ?? []).length > 6 && <span className="text-[10.5px] text-on-surface-2 self-center">+{(p.models ?? []).length - 6}</span>}
                    </div>
                  )}
                  {quotaPct != null && (
                    <div className="flex items-center gap-2">
                      <span className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                        <span className="block h-full bg-primary rounded-full" style={{ width: `${quotaPct}%` }} />
                      </span>
                      <span className="text-[10.5px] text-on-surface-2 tabular-nums">
                        {quotaPct}%{p.quotaResetDay ? ` · ${p.quotaResetDay} 重置` : ''}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-0.5 text-[12px]">
                    <button className="text-on-surface-2 hover:text-on-surface cursor-pointer" onClick={() => openEdit(p)}>编辑</button>
                    <button className="text-on-surface-2 hover:text-danger cursor-pointer" onClick={() => setPendingDelete(p)}>删除</button>
                    {tr?.ok && tr.models && tr.models.length > (p.models ?? []).length && (
                      <button className="text-[12px] text-primary hover:underline cursor-pointer" onClick={() => void updateProvider(p.id, { models: tr.models! }).then(() => toast('已同步模型列表'))}>
                        同步 {tr.models.length} 个模型
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {providers?.length === 0 && null}

      {/* 新增/编辑表单 */}
      <Dialog
        open={form != null}
        onOpenChange={(v) => !v && setForm(null)}
        title={form?.id ? '编辑资产' : '添加 AI 资产'}
        description={form?.id ? undefined : '会员订阅记到期日；API 套餐记接口与 Key。全部只存本机。'}
      >
        {form && (
          <div className="flex flex-col gap-3 max-h-[62vh] overflow-y-auto pr-1">
            {!form.id && (
              <Segmented
                value={form.kind}
                onChange={(v) => setForm({ ...form, kind: v as AiAssetKind })}
                className="w-full [&>button]:flex-1"
                options={[
                  { value: 'subscription', label: '会员订阅' },
                  { value: 'api', label: 'API 套餐' },
                ]}
              />
            )}
            <label className="block">
              <span className={FIELD}>厂商名称</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="如 DeepSeek / OpenAI" />
            </label>

            {form.kind === 'subscription' ? (
              <>
                <label className="block">
                  <span className={FIELD}>套餐名（可选）</span>
                  <input value={form.planName} onChange={(e) => setForm({ ...form, planName: e.target.value })} className={inputCls} placeholder="如 ChatGPT Plus / Kimi 会员" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={FIELD}>到期日</span>
                    <input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className={inputCls} />
                  </label>
                  <label className="block">
                    <span className={FIELD}>续费周期</span>
                    <select value={form.cycle} onChange={(e) => setForm({ ...form, cycle: e.target.value })} className={inputCls}>
                      <option value="monthly">月付</option>
                      <option value="yearly">年付</option>
                      <option value="once">单次</option>
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className={FIELD}>账号 / 邮箱（可选）</span>
                  <input value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} className={inputCls} placeholder="you@example.com" />
                </label>
                <label className="block">
                  <span className={FIELD}>管理页链接（可选）</span>
                  <input value={form.manageUrl} onChange={(e) => setForm({ ...form, manageUrl: e.target.value })} className={inputCls} placeholder="https://…" />
                </label>
              </>
            ) : (
              <>
                <label className="block">
                  <span className={FIELD}>接口地址（OpenAI 兼容）</span>
                  <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className={inputCls} placeholder="https://api.deepseek.com/v1" />
                </label>
                <label className="block">
                  <span className={FIELD}>{form.id ? `API Key（当前 ${maskKey(providers?.find((p) => p.id === form.id)?.apiKey ?? '')}）` : 'API Key'}</span>
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    className={inputCls}
                    placeholder={form.id ? '留空保持不变' : 'sk-…'}
                    autoComplete="off"
                  />
                </label>
                <label className="block">
                  <span className={FIELD}>模型（逗号分隔，测试连接后可自动同步）</span>
                  <textarea
                    value={form.models}
                    onChange={(e) => setForm({ ...form, models: e.target.value })}
                    rows={2}
                    className={cn(inputCls, 'h-auto py-2 resize-none')}
                    placeholder="deepseek-chat, deepseek-reasoner"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={FIELD}>输入价格 $/1M（可选）</span>
                    <input value={form.pricePrompt} onChange={(e) => setForm({ ...form, pricePrompt: e.target.value })} className={inputCls} placeholder="1.0" />
                  </label>
                  <label className="block">
                    <span className={FIELD}>输出价格 $/1M（可选）</span>
                    <input value={form.priceCompletion} onChange={(e) => setForm({ ...form, priceCompletion: e.target.value })} className={inputCls} placeholder="2.0" />
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <label className="block">
                    <span className={FIELD}>额度总量（可选）</span>
                    <input value={form.quotaTotal} onChange={(e) => setForm({ ...form, quotaTotal: e.target.value })} className={inputCls} placeholder="100" />
                  </label>
                  <label className="block">
                    <span className={FIELD}>已用</span>
                    <input value={form.quotaUsed} onChange={(e) => setForm({ ...form, quotaUsed: e.target.value })} className={inputCls} placeholder="30" />
                  </label>
                  <label className="block">
                    <span className={FIELD}>重置日</span>
                    <input type="date" value={form.quotaResetDay} onChange={(e) => setForm({ ...form, quotaResetDay: e.target.value })} className={inputCls} />
                  </label>
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button onClick={() => setForm(null)}>取消</Button>
              <Button variant="primary" onClick={() => void save()}>保存</Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={pendingDelete != null}
        onOpenChange={(v) => !v && setPendingDelete(null)}
        title="删除资产？"
        description={`「${pendingDelete?.name ?? ''}」将被移除（历史会话与用量记录保留）。`}
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setPendingDelete(null)}>取消</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (pendingDelete) void deleteProvider(pendingDelete.id).then(() => toast('已删除'))
              setPendingDelete(null)
            }}
          >
            确认删除
          </Button>
        </div>
      </Dialog>

    </div>
  )
}
