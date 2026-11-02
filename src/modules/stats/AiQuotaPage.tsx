import { useEffect, useRef, useState, type FormEvent } from 'react'
import { arraySwap, rectSwappingStrategy } from '@dnd-kit/sortable'
import { DragSort, DragSortItem } from '@/shared/ui/DragSort'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays, Plus, Pencil, Trash2, WalletCards } from 'lucide-react'
import { db } from '@/db/db'
import { useUi } from '@/stores/ui'
import { DatePicker } from '@/shared/ui/DatePicker'
import { todayStr } from '@/lib/date'
import { PROVIDER_GROUPS } from './quotaBrands'
import { PROVIDERS, QUOTA_KEY, quotaSummary, quotaDisplayMode, quotaExpiry, quotaProviderLabel, quotaBrand, orderQuotaEntries, applyQuotaOrder, type QuotaDisplayMode, type QuotaEntry, type QuotaRecord } from './aiQuota'

const blank = (): QuotaEntry => ({ id: crypto.randomUUID(), provider: 'OpenAI', name: '', account: '', kind: '会员', expiresAt: '', resetAt: '', total: null, used: null, unit: 'Token', note: '', displayMode: 'none', balance: null })
const field = 'w-full rounded-xl border border-outline bg-surface-2 px-3 py-2 text-sm text-on-surface outline-none focus:border-primary'

export function AiQuotaPage() {
  const entries = useLiveQuery(async () => (((await db.settings.get(QUOTA_KEY))?.value as QuotaRecord[] | undefined) ?? []).filter((item): item is QuotaEntry => !('deleted' in item && item.deleted)), [], [])
  const toast = useUi(s => s.toast)
  const [localOrder, setLocalOrder] = useState<string[] | null>(null)
  const writeQueue = useRef<Promise<void>>(Promise.resolve())
  const orderGeneration = useRef(0)
  const orderedEntries = orderQuotaEntries(entries, localOrder)
  useEffect(() => {
    if (!localOrder) return
    const saved = orderQuotaEntries(entries).map(entry => entry.id)
    if (saved.length === localOrder.length && saved.every((id, index) => id === localOrder[index])) setLocalOrder(null)
  }, [entries, localOrder])

  function moveEntry(active: string, over: string) {
    const ids = orderedEntries.map(entry => entry.id)
    const from = ids.indexOf(active)
    const to = ids.indexOf(over)
    if (from < 0 || to < 0 || from === to) return
    const next = arraySwap(ids, from, to)
    const generation = ++orderGeneration.current
    setLocalOrder(next)
    writeQueue.current = writeQueue.current.catch(() => {}).then(async () => {
      await db.transaction('rw', db.settings, async () => {
        const current = ((await db.settings.get(QUOTA_KEY))?.value as QuotaRecord[] | undefined) ?? []
        await db.settings.put({ key: QUOTA_KEY, value: applyQuotaOrder(current, next, Date.now()) })
      })
    }).catch(() => {
      if (generation === orderGeneration.current) setLocalOrder(null)
      toast('排序保存失败，请重试')
    })
  }
  const [draft, setDraft] = useState<QuotaEntry | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const change = <K extends keyof QuotaEntry>(key: K, value: QuotaEntry[K]) => setDraft(prev => prev ? { ...prev, [key]: value } : prev)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || saving) return
    const mode = quotaDisplayMode(draft)
    if (!draft.name.trim() || !draft.provider.trim() || (mode === 'quota' && !draft.unit.trim()) || (mode === 'balance' && !(draft.balanceUnit ?? '元').trim())) { setError('请填写厂商、名称和所需的单位'); return }
    const numbers = mode === 'balance' ? [draft.balance] : mode === 'quota' ? [draft.total, draft.used] : []
    if (numbers.some(n => n != null && (!Number.isFinite(n) || n < 0))) { setError('额度、用量和余额须为非负数字'); return }
    setSaving(true)
    try {
      await db.transaction('rw', db.settings, async () => {
        const current = ((await db.settings.get(QUOTA_KEY))?.value as QuotaRecord[] | undefined) ?? []
        if (current.some(item => item.id === draft.id && 'deleted' in item && item.deleted)) throw new Error('记录已删除')
        const previous = current.find(item => item.id === draft.id)
        const updatedAt = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1)
        const saved = { ...draft, ...((previous && !('deleted' in previous)) ? { sortOrder: previous.sortOrder } : {}), updatedAt, name: draft.name.trim(), provider: draft.provider.trim(), unit: draft.unit.trim() || 'Token' }
        await db.settings.put({ key: QUOTA_KEY, value: previous ? current.map(item => item.id === draft.id ? saved : item) : [...current, saved] })
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
    <p className="text-xs text-on-surface-2">数据由你手动填写和更新，保存在本机并随应用备份；无需填写 API 密钥。长按卡片可调整顺序。</p>
    {draft && <form onSubmit={save} className="card p-4 flex flex-col gap-4" aria-label={editing ? '编辑额度记录' : '添加额度记录'}>
      <div className="flex items-center justify-between"><h2 className="font-semibold">{editing ? '编辑记录' : '添加记录'}</h2><button type="button" onClick={() => setDraft(null)} className="text-sm text-on-surface-2">取消</button></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm flex flex-col gap-1">厂商<div className="flex items-center gap-2"><BrandIcon name="" provider={draft.provider} compact /><select aria-label="厂商" className={field} value={PROVIDERS.includes(draft.provider) ? draft.provider : '其他'} onChange={e => change('provider', e.target.value)}>{PROVIDER_GROUPS.map(group => <optgroup key={group.label} label={group.label}>{group.providers.map(provider => <option key={provider.name} value={provider.name}>{provider.name}</option>)}</optgroup>)}<option value="其他">其他</option></select></div></label>
        {(draft.provider === '其他' || !PROVIDERS.includes(draft.provider)) && <label className="text-sm flex flex-col gap-1">自定义厂商<input className={field} value={draft.provider === '其他' ? '' : draft.provider} onChange={e => change('provider', e.target.value || '其他')} placeholder="输入厂商名称" /></label>}
        <label className="text-sm flex flex-col gap-1">名称<input className={field} value={draft.name} onChange={e => change('name', e.target.value)} placeholder="如 ChatGPT Plus、API 套餐" required maxLength={80} /></label>
        <label className="text-sm flex flex-col gap-1">类型<select className={field} value={draft.kind} onChange={e => {
          const kind = e.target.value as QuotaEntry['kind']
          setDraft(previous => previous ? { ...previous, kind, displayMode: kind === 'API' && quotaDisplayMode(previous) === 'none' ? 'quota' : quotaDisplayMode(previous) } : previous)
        }}><option>会员</option><option>API</option><option>其他</option></select></label>
        <label className="text-sm flex flex-col gap-1">账号备注（可选）<input className={field} value={draft.account} onChange={e => change('account', e.target.value)} placeholder="如个人账号" maxLength={100} /></label>
        <label className="text-sm flex flex-col gap-1">记录方式<select className={field} value={quotaDisplayMode(draft)} onChange={e => change('displayMode', e.target.value as QuotaDisplayMode)}><option value="none">只记录会员期限</option><option value="quota">额度与用量</option><option value="balance">账户余额</option></select></label>
        {quotaDisplayMode(draft) === 'quota' && <>
          <label className="text-sm flex flex-col gap-1">总额度（可选）<input className={field} type="number" min="0" step="any" value={draft.total ?? ''} onChange={e => change('total', e.target.value === '' ? null : Number(e.target.value))} /></label>
          <label className="text-sm flex flex-col gap-1">已使用（可选）<input className={field} type="number" min="0" step="any" value={draft.used ?? ''} onChange={e => change('used', e.target.value === '' ? null : Number(e.target.value))} /></label>
        </>}
        {quotaDisplayMode(draft) === 'balance' && <label className="text-sm flex flex-col gap-1">当前余额（可选）<input className={field} type="number" min="0" step="any" value={draft.balance ?? ''} onChange={e => change('balance', e.target.value === '' ? null : Number(e.target.value))} /></label>}
        {quotaDisplayMode(draft) === 'quota' && <label className="text-sm flex flex-col gap-1">单位<input className={field} value={draft.unit} onChange={e => change('unit', e.target.value)} placeholder="Token、次、元等" maxLength={20} required /></label>}
        {quotaDisplayMode(draft) === 'balance' && <label className="text-sm flex flex-col gap-1">余额单位<input className={field} value={draft.balanceUnit ?? '元'} onChange={e => change('balanceUnit', e.target.value)} placeholder="元、美元等" maxLength={20} required /></label>}
        <div className="text-sm flex flex-col gap-1"><span>到期日（可选）</span><DatePicker value={draft.expiresAt} onChange={value => change('expiresAt', value)} ariaLabel="到期日" /></div>
        {quotaDisplayMode(draft) !== 'none' && <div className="text-sm flex flex-col gap-1"><span>额度重置日（可选）</span><DatePicker value={draft.resetAt} onChange={value => change('resetAt', value)} ariaLabel="额度重置日" /></div>}
        <label className="text-sm flex flex-col gap-1 sm:col-span-2">备注（可选）<textarea className={field} rows={2} value={draft.note} onChange={e => change('note', e.target.value)} maxLength={500} /></label>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div><button disabled={saving} type="submit" className="rounded-xl bg-primary-action px-4 py-2 text-sm text-on-primary-action disabled:opacity-50">保存记录</button></div>
    </form>}
    {!entries.length && !draft && <div className="card p-8 text-center text-on-surface-2"><WalletCards size={28} className="mx-auto mb-3 opacity-60" /><p className="font-medium text-on-surface">还没有额度记录</p><p className="mt-1 text-sm">添加一个会员或 API 套餐，开始规划使用。</p></div>}
    <DragSort ids={orderedEntries.map(entry => entry.id)} strategy={rectSwappingStrategy} onMove={moveEntry}>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{orderedEntries.map(entry => <DragSortItem key={entry.id} id={entry.id} label={`拖动排序 ${entry.name}`} className="h-full"><QuotaCard entry={entry} onEdit={() => { setDraft({ ...entry }); setEditing(true); setError(''); document.getElementById('main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' }); window.scrollTo({ top: 0, behavior: 'smooth' }) }} onDelete={() => void remove(entry)} /></DragSortItem>)}</div>
    </DragSort>

  </div>
}


function QuotaCard({ entry, onEdit, onDelete }: { entry: QuotaEntry; onEdit: () => void; onDelete: () => void }) {
  const mode = quotaDisplayMode(entry)
  const summary = mode === 'quota' ? quotaSummary(entry) : null
  const expiry = quotaExpiry(entry.expiresAt, todayStr())
  const metadata = [quotaProviderLabel(entry.name, entry.provider), entry.kind, entry.account].filter(Boolean).join(' · ')
  const number = (value: number) => value.toLocaleString('zh-CN')

  return <article className="card p-4 flex h-full flex-col gap-4 min-w-0">
    <div className="flex items-start gap-3">
      <BrandIcon name={entry.name} provider={entry.provider} />
      <div className="min-w-0 flex-1"><h2 className="font-semibold leading-5 break-words">{entry.name}</h2><p className="mt-1 text-xs text-on-surface-2 break-words">{metadata}</p></div>
      <div className="flex shrink-0"><button type="button" aria-label={`编辑 ${entry.name}`} onClick={onEdit} className="p-2 text-on-surface-2 hover:text-on-surface"><Pencil size={16} /></button><button type="button" aria-label={`删除 ${entry.name}`} onClick={onDelete} className="p-2 text-on-surface-2 hover:text-on-surface"><Trash2 size={16} /></button></div>
    </div>
    {mode === 'balance' && <div><p className="text-xs text-on-surface-2">账户余额</p><p className="mt-1 text-lg font-semibold break-words">{entry.balance != null ? <>{number(entry.balance)} <span className="text-sm font-normal text-on-surface-2">{entry.balanceUnit || '元'}</span></> : <span className="text-sm font-normal text-on-surface-2">尚未填写余额</span>}</p></div>}
    {mode === 'quota' && (summary ? <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><p className="min-w-0 break-words"><span className="text-xs text-on-surface-2">剩余 </span><span className="font-semibold">{number(summary.remaining)}</span> <span className="text-sm text-on-surface-2">{entry.unit}</span></p><p className="text-xs text-on-surface-2">已用 {number(entry.used!)} / {number(entry.total!)}</p></div>
      <div className="mt-2 h-1.5 rounded-full bg-surface-3 overflow-hidden" role="progressbar" aria-label={`${entry.name} 已用额度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(summary.percent)}><div className="h-full rounded-full bg-primary" style={{ width: `${summary.percent}%` }} /></div>
      {summary.exceeded && <p className="mt-1 text-xs text-danger">已超过记录的总额度</p>}
    </div> : <p className="text-sm text-on-surface-2">{entry.total != null ? `总额度 ${number(entry.total)} ${entry.unit}` : entry.used != null ? `已用 ${number(entry.used)} ${entry.unit}` : '尚未填写额度'}</p>)}
    {(entry.expiresAt || (mode !== 'none' && entry.resetAt)) && <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-outline pt-3">
      {entry.expiresAt && <div className="flex items-center gap-2 text-sm"><CalendarDays size={16} className={expiry?.tone === 'expired' || expiry?.tone === 'soon' ? 'text-danger' : 'text-primary'} /><span className="font-medium">{entry.expiresAt}</span>{expiry && <span className={expiry.tone === 'expired' || expiry.tone === 'soon' ? 'text-xs font-semibold text-danger' : 'text-xs text-on-surface-2'}>{expiry.text}</span>}</div>}
      {mode !== 'none' && entry.resetAt && <span className="text-xs text-on-surface-2">重置 {entry.resetAt}</span>}
    </div>}
    {entry.note && <p className="text-xs text-on-surface-2 whitespace-pre-wrap break-words">{entry.note}</p>}
  </article>
}


function BrandIcon({ name, provider, compact = false }: { name: string; provider: string; compact?: boolean }) {
  const brand = quotaBrand(name, provider)
  return <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-xl border border-outline bg-white overflow-hidden ${compact ? 'h-10 w-10' : 'h-11 w-11'}`}>
    {brand ? <img alt="" className={brand === 'lobe-xiaomimimo' ? 'h-9 w-9 object-contain' : 'h-7 w-7 object-contain'} src={`${import.meta.env.BASE_URL}brands/${brand}.svg`} /> : <span className="text-base font-bold text-slate-600">{provider.slice(0, 1).toUpperCase()}</span>}
  </span>
}
