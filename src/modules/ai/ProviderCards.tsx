import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { KeyRound, Plus, Zap } from 'lucide-react'
import { db, type AiProvider } from '@/db/db'
import { PROVIDER_PRESETS, addProvider, deleteProvider, maskKey, testProvider, updateProvider } from '@/db/ai'
import { useUi } from '@/stores/ui'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { cn } from '@/lib/cn'

interface FormState {
  id?: string
  name: string
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
  name: '', baseUrl: '', apiKey: '', models: '',
  pricePrompt: '', priceCompletion: '', quotaTotal: '', quotaUsed: '', quotaResetDay: '',
}

/** AI 资产页：Provider 分组卡片 + Key 槽位（尾四位 + 状态灯，永不明文回显） */
export function ProviderCards() {
  const providers = useLiveQuery(() => db.aiProviders.orderBy('createdAt').toArray(), [], [] as AiProvider[])
  const [form, setForm] = useState<FormState | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string; models?: string[] }>>({})
  const [pendingDelete, setPendingDelete] = useState<AiProvider | null>(null)
  const toast = useUi((s) => s.toast)

  const openCreate = (preset?: (typeof PROVIDER_PRESETS)[number]) => {
    setForm({ ...EMPTY_FORM, name: preset?.name === '自定义' ? '' : (preset?.name ?? ''), baseUrl: preset?.baseUrl ?? '', models: preset?.models.join(', ') ?? '' })
  }

  const openEdit = (p: AiProvider) => {
    setForm({
      id: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: '', // 留空 = 保持不变
      models: p.models.join(', '),
      pricePrompt: p.pricePrompt != null ? String(p.pricePrompt) : '',
      priceCompletion: p.priceCompletion != null ? String(p.priceCompletion) : '',
      quotaTotal: p.quotaTotal != null ? String(p.quotaTotal) : '',
      quotaUsed: p.quotaUsed != null ? String(p.quotaUsed) : '',
      quotaResetDay: p.quotaResetDay ?? '',
    })
  }

  const save = async () => {
    if (!form) return
    if (!form.name.trim() || !form.baseUrl.trim()) {
      toast('名称与接口地址必填')
      return
    }
    const payload = {
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
      toast('服务商已添加')
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
    <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="text-[12.5px] text-on-surface-2">
          API Key 仅保存在本机（IndexedDB），永不明文回显，不上传任何服务器。
        </p>
        <Button variant="primary" size="sm" className="ml-auto shrink-0" onClick={() => openCreate()}>
          <Plus size={14} /> 添加服务商
        </Button>
      </div>

      {providers.length === 0 && (
        <div className="card p-5">
          <p className="text-[13.5px] font-semibold mb-2 flex items-center gap-1.5"><KeyRound size={15} /> 从预设开始</p>
          <div className="flex flex-wrap gap-2">
            {PROVIDER_PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => openCreate(p)}
                className="px-3 h-9 rounded-full bg-surface-3 hover:bg-primary-soft hover:text-primary text-[13px] transition-colors cursor-pointer"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {providers.map((p) => {
          const tr = testResult[p.id]
          const quotaPct = p.quotaTotal ? Math.min(100, Math.round(((p.quotaUsed ?? 0) / p.quotaTotal) * 100)) : null
          return (
            <div key={p.id} className="card px-4 py-3.5 flex flex-col gap-2">
              <div className="flex items-center gap-2.5">
                <span className="grid place-items-center w-9 h-9 rounded-[11px] bg-primary-soft text-primary shrink-0">
                  <Zap size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold truncate leading-tight">{p.name}</p>
                  <p className="text-[11px] text-on-surface-2 truncate leading-tight mt-0.5">{p.baseUrl}</p>
                </div>
                {/* 状态灯：绿=已配 Key */}
                <span
                  className={cn('w-2.5 h-2.5 rounded-full shrink-0', p.apiKey ? 'bg-ok' : 'bg-surface-3 border border-outline')}
                  title={p.apiKey ? 'Key 已配置' : '未配置 Key'}
                />
              </div>

              {/* Key 槽位：尾四位 + 更换 */}
              <div className="flex items-center gap-2 text-[12px]">
                <span className="font-mono bg-surface-3 px-2 py-1 rounded-lg text-on-surface-2">{maskKey(p.apiKey)}</span>
                <button className="text-primary hover:underline cursor-pointer" onClick={() => openEdit(p)}>更换</button>
                <button className="text-on-surface-2 hover:text-on-surface cursor-pointer" onClick={() => void doTest(p)}>
                  {testing === p.id ? '测试中…' : '测试连接'}
                </button>
                {tr && (
                  <span className={cn('text-[11px]', tr.ok ? 'text-ok' : 'text-danger')}>{tr.msg}</span>
                )}
              </div>

              {p.models.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {p.models.slice(0, 6).map((m) => (
                    <span key={m} className="text-[10.5px] px-2 py-0.5 rounded-full bg-surface-3 text-on-surface-2 font-mono">{m}</span>
                  ))}
                  {p.models.length > 6 && <span className="text-[10.5px] text-on-surface-2 self-center">+{p.models.length - 6}</span>}
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

              <div className="flex items-center gap-2 mt-0.5">
                <button className="text-[12px] text-on-surface-2 hover:text-on-surface cursor-pointer" onClick={() => openEdit(p)}>编辑</button>
                <button className="text-[12px] text-on-surface-2 hover:text-danger cursor-pointer" onClick={() => setPendingDelete(p)}>删除</button>
                {tr?.ok && tr.models && tr.models.length > p.models.length && (
                  <button
                    className="text-[12px] text-primary hover:underline cursor-pointer"
                    onClick={() => void updateProvider(p.id, { models: tr.models! }).then(() => toast('已同步模型列表'))}
                  >
                    同步 {tr.models.length} 个模型
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 新增/编辑表单 */}
      <Dialog
        open={form != null}
        onOpenChange={(v) => !v && setForm(null)}
        title={form?.id ? '编辑服务商' : '添加服务商'}
        description={form?.id ? 'API Key 留空表示保持不变。' : 'Key 只存本机，不会上传。'}
      >
        {form && (
          <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-1">
            <Field label="名称">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="DeepSeek" />
            </Field>
            <Field label="接口地址（OpenAI 兼容）">
              <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className={inputCls} placeholder="https://api.deepseek.com/v1" />
            </Field>
            <Field label={form.id ? `API Key（当前 ${maskKey(providers?.find((p) => p.id === form.id)?.apiKey ?? '')}）` : 'API Key'}>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                className={inputCls}
                placeholder={form.id ? '留空保持不变' : 'sk-…'}
                autoComplete="off"
              />
            </Field>
            <Field label="模型（逗号分隔，测试连接后可自动同步）">
              <textarea
                value={form.models}
                onChange={(e) => setForm({ ...form, models: e.target.value })}
                rows={2}
                className={cn(inputCls, 'h-auto py-2 resize-none')}
                placeholder="deepseek-chat, deepseek-reasoner"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="输入价格 $/1M（可选）">
                <input value={form.pricePrompt} onChange={(e) => setForm({ ...form, pricePrompt: e.target.value })} className={inputCls} placeholder="1.0" />
              </Field>
              <Field label="输出价格 $/1M（可选）">
                <input value={form.priceCompletion} onChange={(e) => setForm({ ...form, priceCompletion: e.target.value })} className={inputCls} placeholder="2.0" />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="额度总量（可选）">
                <input value={form.quotaTotal} onChange={(e) => setForm({ ...form, quotaTotal: e.target.value })} className={inputCls} placeholder="100" />
              </Field>
              <Field label="已用">
                <input value={form.quotaUsed} onChange={(e) => setForm({ ...form, quotaUsed: e.target.value })} className={inputCls} placeholder="30" />
              </Field>
              <Field label="重置日">
                <input type="date" value={form.quotaResetDay} onChange={(e) => setForm({ ...form, quotaResetDay: e.target.value })} className={inputCls} />
              </Field>
            </div>
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
        title="删除服务商？"
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

const inputCls = 'w-full h-10 px-3 rounded-[10px] bg-surface-2 border border-outline text-[13.5px] outline-none focus:border-primary/60 transition-colors'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium text-on-surface-2 mb-1">{label}</span>
      {children}
    </label>
  )
}
