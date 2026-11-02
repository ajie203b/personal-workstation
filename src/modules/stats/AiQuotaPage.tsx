import { useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Pencil, Trash2, WalletCards } from 'lucide-react'
import { db } from '@/db/db'
import { useUi } from '@/stores/ui'
import { DatePicker } from '@/shared/ui/DatePicker'
import { todayStr } from '@/lib/date'
import { PROVIDERS, QUOTA_KEY, quotaSummary, type QuotaEntry, type QuotaRecord } from './aiQuota'

const blank = (): QuotaEntry => ({ id: crypto.randomUUID(), provider: 'OpenAI', name: '', account: '', kind: '会员', expiresAt: '', resetAt: '', total: null, used: null, unit: 'Token', note: '' })
const field = 'w-full rounded-xl border border-outline bg-surface-2 px-3 py-2 text-sm text-on-surface outline-none focus:border-primary'
const badges: Record<string, [string, string]> = {
  OpenAI: ['O', '#16826e'], Anthropic: ['A', '#b66c4c'], Google: ['G', '#4285f4'], DeepSeek: ['D', '#4d6bfe'],
  '阿里云百炼': ['通', '#ff6a00'], '智谱 AI': ['智', '#4b5dd9'], '月之暗面': ['月', '#5650a5'], MiniMax: ['M', '#dd5242'],
}
const logos: Record<string, string> = { Anthropic: 'anthropic', Google: 'google', DeepSeek: 'deepseek', '阿里云百炼': 'alibabacloud' }

export function AiQuotaPage() {
  const entries = useLiveQuery(async () => (((await db.settings.get(QUOTA_KEY))?.value as QuotaRecord[] | undefined) ?? []).filter((item): item is QuotaEntry => !('deleted' in item && item.deleted)), [], [])
  const toast = useUi(s => s.toast)
  const [draft, setDraft] = useState<QuotaEntry | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const change = <K extends keyof QuotaEntry>(key: K, value: QuotaEntry[K]) => setDraft(prev => prev ? { ...prev, [key]: value } : prev)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || saving) return
    if (!draft.name.trim() || !draft.provider.trim() || !draft.unit.trim()) { setError('请填写厂商、名称和额度单位'); return }
    if ([draft.total, draft.used].some(n => n !== null && (!Number.isFinite(n) || n < 0))) { setError('额度和已用量须为非负数字'); return }
    setSaving(true)
    try {
      await db.transaction('rw', db.settings, async () => {
        const current = ((await db.settings.get(QUOTA_KEY))?.value as QuotaRecord[] | undefined) ?? []
        if (current.some(item => item.id === draft.id && 'deleted' in item && item.deleted)) throw new Error('记录已删除')
        const previous = current.find(item => item.id === draft.id)
        const updatedAt = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1)
        await db.settings.put({ key: QUOTA_KEY, value: [...current.filter(item => item.id !== draft.id), { ...draft, updatedAt, name: draft.name.trim(), provider: draft.provider.trim(), unit: draft.unit.trim() }] })
      })
      setDraft(null); setError(''); toast('记录已保存')
    } catch { setError('保存失败，请重试') } finally { setSaving(false) }
  }

  async function remove(entry: QuotaEntry) {
    if (!window.confirm(`删除“${entry.name}”的记录？`)) return
    try {
      await db.transaction('rw', db.settings, async () => {
        const current = ((await db.settings.get(QUOTA_KEY))?.value as QuotaRecord[] | undefined) ?? []
        const previous = current.find(item => item.id === entry.id)
        await db.settings.put({ key: QUOTA_KEY, value: [...current.filter(item => item.id !== entry.id), { id: entry.id, deleted: true, updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1) }] })
      })
      toast('记录已删除')
    } catch { toast('删除失败，请重试') }
  }

  return <div className="mx-auto w-full max-w-7xl px-4 md:px-8 pt-4 pb-24 flex flex-col gap-4">
    <header className="flex items-start gap-3">
      <div className="flex-1"><h1 className="text-xl font-bold">模型额度</h1><p className="mt-1 text-sm text-on-surface-2">记录会员和 API 额度，安排使用与续费</p></div>
      <button type="button" onClick={() => { setDraft(blank()); setEditing(false); setError('') }} className="inline-flex items-center gap-1 rounded-xl bg-primary-action px-3 py-2 text-sm text-on-primary-action"><Plus size={16} />添加</button>
    </header>
    <p className="text-xs text-on-surface-2">数据由你手动填写和更新，保存在本机并随应用备份；无需填写 API 密钥。</p>
    {draft && <form onSubmit={save} className="card p-4 flex flex-col gap-4" aria-label={editing ? '编辑额度记录' : '添加额度记录'}>
      <div className="flex items-center justify-between"><h2 className="font-semibold">{editing ? '编辑记录' : '添加记录'}</h2><button type="button" onClick={() => setDraft(null)} className="text-sm text-on-surface-2">取消</button></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm flex flex-col gap-1">厂商<select className={field} value={PROVIDERS.includes(draft.provider as typeof PROVIDERS[number]) ? draft.provider : '其他'} onChange={e => change('provider', e.target.value)}>{PROVIDERS.map(p => <option key={p}>{p}</option>)}</select></label>
        {(draft.provider === '其他' || !PROVIDERS.includes(draft.provider as typeof PROVIDERS[number])) && <label className="text-sm flex flex-col gap-1">自定义厂商<input className={field} value={draft.provider === '其他' ? '' : draft.provider} onChange={e => change('provider', e.target.value || '其他')} placeholder="输入厂商名称" /></label>}
        <label className="text-sm flex flex-col gap-1">名称<input className={field} value={draft.name} onChange={e => change('name', e.target.value)} placeholder="如 ChatGPT Plus、API 套餐" required maxLength={80} /></label>
        <label className="text-sm flex flex-col gap-1">类型<select className={field} value={draft.kind} onChange={e => change('kind', e.target.value as QuotaEntry['kind'])}><option>会员</option><option>API</option><option>其他</option></select></label>
        <label className="text-sm flex flex-col gap-1">账号备注（可选）<input className={field} value={draft.account} onChange={e => change('account', e.target.value)} placeholder="如个人账号" maxLength={100} /></label>
        <label className="text-sm flex flex-col gap-1">总额度（可选）<input className={field} type="number" min="0" step="any" value={draft.total ?? ''} onChange={e => change('total', e.target.value === '' ? null : Number(e.target.value))} /></label>
        <label className="text-sm flex flex-col gap-1">已使用（可选）<input className={field} type="number" min="0" step="any" value={draft.used ?? ''} onChange={e => change('used', e.target.value === '' ? null : Number(e.target.value))} /></label>
        <label className="text-sm flex flex-col gap-1">额度单位<input className={field} value={draft.unit} onChange={e => change('unit', e.target.value)} placeholder="Token、次、美元等" maxLength={20} required /></label>
        <div className="text-sm flex flex-col gap-1"><span>会员到期日（可选）</span><DatePicker value={draft.expiresAt} onChange={value => change('expiresAt', value)} ariaLabel="会员到期日" /></div>
        <div className="text-sm flex flex-col gap-1"><span>额度重置日（可选）</span><DatePicker value={draft.resetAt} onChange={value => change('resetAt', value)} ariaLabel="额度重置日" /></div>
        <label className="text-sm flex flex-col gap-1 sm:col-span-2">备注（可选）<textarea className={field} rows={2} value={draft.note} onChange={e => change('note', e.target.value)} maxLength={500} /></label>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div><button disabled={saving} type="submit" className="rounded-xl bg-primary-action px-4 py-2 text-sm text-on-primary-action disabled:opacity-50">保存记录</button></div>
    </form>}
    {!entries.length && !draft && <div className="card p-8 text-center text-on-surface-2"><WalletCards size={28} className="mx-auto mb-3 opacity-60" /><p className="font-medium text-on-surface">还没有额度记录</p><p className="mt-1 text-sm">添加一个会员或 API 套餐，开始规划使用。</p></div>}
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{entries.map(entry => {
      const summary = quotaSummary(entry)
      const [letter, color] = badges[entry.provider] ?? [entry.provider.slice(0, 1).toUpperCase(), '#667085']
      const expired = entry.expiresAt && entry.expiresAt < todayStr()
      return <article key={entry.id} className="card p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3"><span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl font-bold text-white" style={{ backgroundColor: color }}>{logos[entry.provider] ? <img alt="" className="h-5 w-5 brightness-0 invert" src={`${import.meta.env.BASE_URL}brands/${logos[entry.provider]}.svg`} /> : letter}</span><div className="min-w-0 flex-1"><h2 className="font-semibold break-words">{entry.name}</h2><p className="text-xs text-on-surface-2">{entry.provider} · {entry.kind}{entry.account ? ` · ${entry.account}` : ''}</p></div><button type="button" aria-label={`编辑 ${entry.name}`} onClick={() => { setDraft({ ...entry }); setEditing(true); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="p-2 text-on-surface-2"><Pencil size={16} /></button><button type="button" aria-label={`删除 ${entry.name}`} onClick={() => void remove(entry)} className="p-2 text-on-surface-2"><Trash2 size={16} /></button></div>
        {summary ? <div><div className="flex justify-between gap-2 text-sm"><span>剩余 {summary.remaining.toLocaleString()} {entry.unit}</span><span className="text-on-surface-2">已用 {entry.used?.toLocaleString()} / {entry.total?.toLocaleString()}</span></div><div className="mt-2 h-2 rounded-full bg-surface-3 overflow-hidden" role="progressbar" aria-label={`${entry.name} 已用额度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(summary.percent)}><div className="h-full rounded-full bg-primary" style={{ width: `${summary.percent}%` }} /></div>{summary.exceeded && <p className="mt-1 text-xs text-danger">已超过记录的总额度</p>}</div> : <p className="text-sm text-on-surface-2">{entry.total != null ? `总额度 ${entry.total.toLocaleString()} ${entry.unit}` : entry.used != null ? `已用 ${entry.used.toLocaleString()} ${entry.unit}` : '尚未填写额度'}</p>}
        {(entry.expiresAt || entry.resetAt) && <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-on-surface-2">{entry.expiresAt && <span className={expired ? 'text-danger' : ''}>到期 {entry.expiresAt}{expired ? '（已过期）' : ''}</span>}{entry.resetAt && <span>重置 {entry.resetAt}</span>}</div>}
        {entry.note && <p className="text-xs text-on-surface-2 whitespace-pre-wrap break-words">{entry.note}</p>}
      </article>
    })}</div>
  </div>
}
