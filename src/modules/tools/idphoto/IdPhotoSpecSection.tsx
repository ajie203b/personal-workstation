import { useMemo, useState } from 'react'
import { Image as ImageIcon, Plus, Search, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/shared/ui/Button'
import { HexColorInput } from '@/shared/ui/HexColorInput'
import { Segmented } from '@/shared/ui/Segmented'
import { useUi } from '@/stores/ui'
import { BUILTIN_SPECS, parseSpecsJson, saveCustomSpecs, serializeSpecs, validateSpec, type PhotoFormat, type PhotoSpec } from './idphotoSpec'
import { CHECKERBOARD_STYLE } from './idphotoPreview'

/** 底色预设（报名照常用 + 透明底 PNG） */
const BG_PRESETS = [
  { id: 'white', label: '白底', value: '#FFFFFF' },
  { id: 'blue', label: '蓝底', value: '#438EDB' },
  { id: 'red', label: '红底', value: '#D9001B' },
  { id: 'transparent', label: '透明底', value: 'transparent' },
] as const

interface NewSpecForm {
  name: string
  width: string
  height: string
  dpi: string
  minKb: string
  maxKb: string
  format: PhotoFormat
  sheetCount: string
}

const DEFAULT_NEW_SPEC: NewSpecForm = {
  name: '',
  width: '295',
  height: '413',
  dpi: '300',
  minKb: '10',
  maxKb: '30',
  format: 'jpeg',
  sheetCount: '8',
}

interface Props {
  spec: PhotoSpec
  allSpecs: PhotoSpec[]
  customSpecs: PhotoSpec[]
  bg: string
  effectiveFormat: PhotoFormat
  onSelectBg: (bg: string) => void
  onSelectSpec: (id: string) => void
  onCustomSpecsChange: (specs: PhotoSpec[], selectedId: string) => void
}

export function IdPhotoSpecSection({ spec, allSpecs, customSpecs, bg, effectiveFormat, onSelectBg, onSelectSpec, onCustomSpecsChange }: Props) {
  const toast = useUi((s) => s.toast)
  const [specQuery, setSpecQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [newSpecForm, setNewSpecForm] = useState<NewSpecForm>(DEFAULT_NEW_SPEC)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [customBg, setCustomBg] = useState('#438EDB')

  const filteredSpecs = useMemo(() => {
    const q = specQuery.trim().toLowerCase()
    if (!q) return allSpecs
    return allSpecs.filter((s) => s.name.toLowerCase().includes(q) || `${s.width}x${s.height}`.includes(q))
  }, [allSpecs, specQuery])
  const isCustomSpec = customSpecs.some((s) => s.id === spec.id)

  const openJson = () => {
    setJsonText(serializeSpecs(customSpecs.length ? customSpecs : BUILTIN_SPECS))
    setJsonOpen((v) => !v)
    setAddOpen(false)
  }

  const saveJson = () => {
    const parsed = parseSpecsJson(jsonText)
    if (!parsed.ok) {
      toast(parsed.error)
      return
    }
    const saved = saveCustomSpecs(parsed.specs)
    if (!saved.ok) {
      toast(saved.error)
      return
    }
    onCustomSpecsChange(saved.specs, saved.specs[0]?.id ?? 'yicun')
    toast(`已保存 ${saved.specs.length} 条我的规格`)
  }

  const submitNewSpec = () => {
    const candidate = {
      id: `mine-${Date.now().toString(36)}`,
      name: newSpecForm.name,
      width: Number(newSpecForm.width),
      height: Number(newSpecForm.height),
      dpi: Number(newSpecForm.dpi),
      minKb: Number(newSpecForm.minKb),
      maxKb: Number(newSpecForm.maxKb),
      format: newSpecForm.format,
      sheetCount: Number(newSpecForm.sheetCount),
    }
    const check = validateSpec(candidate)
    if (!check.ok) {
      toast(check.error)
      return
    }
    const saved = saveCustomSpecs([...customSpecs, check.spec])
    if (!saved.ok) {
      toast(saved.error)
      return
    }
    onCustomSpecsChange(saved.specs, check.spec.id)
    setAddOpen(false)
    setNewSpecForm(DEFAULT_NEW_SPEC)
    toast(`已新增规格「${check.spec.name}」`)
  }

  const saveCurrentAsMine = () => {
    const mine: PhotoSpec = {
      ...spec,
      id: `mine-${Date.now().toString(36)}`,
      name: `${spec.name}·自定义`,
    }
    const saved = saveCustomSpecs([...customSpecs, mine])
    if (!saved.ok) {
      toast(saved.error)
      return
    }
    onCustomSpecsChange(saved.specs, mine.id)
    toast(`已存为我的规格「${mine.name}」`)
  }

  const deleteCurrentCustomSpec = () => {
    if (!isCustomSpec) return
    const next = customSpecs.filter((s) => s.id !== spec.id)
    const saved = saveCustomSpecs(next.length ? next : [])
    if (!next.length) {
      localStorage.removeItem('idphoto.specs')
      onCustomSpecsChange([], 'yicun')
    } else if (saved.ok) {
      onCustomSpecsChange(saved.specs, 'yicun')
    } else {
      onSelectSpec('yicun')
    }
    toast(`已删除自定义规格「${spec.name}」`)
  }

  return (
    <section className="card p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-surface-2 text-on-surface-2 shrink-0">
          <ImageIcon size={15} />
        </span>
        <p className="text-[13.5px] font-medium flex-1">④ 换底与规格</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="背景底色">
        {BG_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={bg === p.value}
            onClick={() => onSelectBg(p.value)}
            className={cn(
              'inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] border text-[12.5px] transition-colors cursor-pointer',
              bg === p.value ? 'border-primary text-primary bg-primary-soft' : 'border-outline text-on-surface-2',
            )}
          >
            <span
              className="w-4 h-4 rounded-full border border-outline shrink-0"
              style={p.value === 'transparent' ? CHECKERBOARD_STYLE : { background: p.value }}
            />
            {p.label}
          </button>
        ))}
        <HexColorInput
          label="自定义底色"
          value={customBg}
          onChange={(value) => {
            setCustomBg(value)
            onSelectBg(value)
          }}
        />
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-2 pointer-events-none" />
        <input
          type="search"
          value={specQuery}
          onChange={(e) => setSpecQuery(e.target.value)}
          placeholder="搜索规格（如 一寸 / 四六级 / 社保卡 / 签证）"
          aria-label="搜索照片规格"
          className="w-full h-9 rounded-[10px] border border-outline bg-surface-2 pl-8 pr-3 text-[12.5px] outline-none focus:border-primary/60"
        />
      </div>

      <div role="group" aria-label="照片规格" className="flex gap-2 overflow-x-auto pb-1">
        {filteredSpecs.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={spec.id === s.id}
            onClick={() => onSelectSpec(s.id)}
            className={cn(
              'shrink-0 flex min-h-12 items-center gap-2 rounded-lg border px-3 py-2 text-left cursor-pointer',
              spec.id === s.id ? 'border-primary bg-primary-soft text-primary' : 'border-outline bg-surface-2 text-on-surface',
            )}
          >
            <span aria-hidden className="w-4 rounded-sm border border-current shrink-0" style={{ aspectRatio: s.width / s.height }} />
            <span className="text-xs whitespace-nowrap">
              {s.name}
              <span className="block text-on-surface-2 tabular-nums">
                {s.width}×{s.height}
              </span>
            </span>
          </button>
        ))}
        {filteredSpecs.length === 0 && (
          <p className="text-[12px] text-on-surface-2 py-2">没有匹配「{specQuery}」的规格，可直接点下方「新增规格」添加。</p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          className="h-9 px-3 text-[12.5px]"
          onClick={() => {
            setAddOpen((v) => !v)
            setJsonOpen(false)
          }}
        >
          <Plus size={14} /> {addOpen ? '收起表单' : '新增规格'}
        </Button>
        <Button variant="outline" className="h-9 px-3 text-[12.5px]" onClick={saveCurrentAsMine}>
          保存为我的规格
        </Button>
        <Button variant="ghost" className="h-9 px-3 text-[12.5px]" onClick={openJson}>
          {jsonOpen ? '收起 JSON' : '编辑 JSON'}
        </Button>
        {isCustomSpec && (
          <Button variant="danger" className="h-9 px-3 text-[12.5px]" onClick={deleteCurrentCustomSpec}>
            <Trash2 size={14} /> 删除当前规格
          </Button>
        )}
        <p className="text-[11px] text-on-surface-2">
          {effectiveFormat === 'png'
            ? bg === 'transparent'
              ? 'PNG 透明底（自动切为 PNG，不压 KB）'
              : 'PNG（不压 KB）'
            : `JPEG · ${spec.minKb}~${spec.maxKb}KB · ${spec.dpi}dpi`}
        </p>
      </div>

      {addOpen && (
        <div className="rounded-[12px] border border-outline bg-surface-2 p-3 flex flex-col gap-3">
          <p className="text-[12.5px] font-medium">自定义新规格</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-[12px]">
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-on-surface-2">规格名称</span>
              <input
                type="text"
                value={newSpecForm.name}
                onChange={(e) => setNewSpecForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="如 考研报名"
                className="h-9 rounded-lg border border-outline bg-surface px-2.5 outline-none focus:border-primary/60"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-on-surface-2">宽 (px)</span>
              <input
                type="number"
                value={newSpecForm.width}
                onChange={(e) => setNewSpecForm((f) => ({ ...f, width: e.target.value }))}
                className="h-9 rounded-lg border border-outline bg-surface px-2.5 outline-none focus:border-primary/60"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-on-surface-2">高 (px)</span>
              <input
                type="number"
                value={newSpecForm.height}
                onChange={(e) => setNewSpecForm((f) => ({ ...f, height: e.target.value }))}
                className="h-9 rounded-lg border border-outline bg-surface px-2.5 outline-none focus:border-primary/60"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-on-surface-2">DPI</span>
              <input
                type="number"
                value={newSpecForm.dpi}
                onChange={(e) => setNewSpecForm((f) => ({ ...f, dpi: e.target.value }))}
                className="h-9 rounded-lg border border-outline bg-surface px-2.5 outline-none focus:border-primary/60"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-on-surface-2">最小 KB</span>
              <input
                type="number"
                value={newSpecForm.minKb}
                onChange={(e) => setNewSpecForm((f) => ({ ...f, minKb: e.target.value }))}
                className="h-9 rounded-lg border border-outline bg-surface px-2.5 outline-none focus:border-primary/60"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-on-surface-2">最大 KB</span>
              <input
                type="number"
                value={newSpecForm.maxKb}
                onChange={(e) => setNewSpecForm((f) => ({ ...f, maxKb: e.target.value }))}
                className="h-9 rounded-lg border border-outline bg-surface px-2.5 outline-none focus:border-primary/60"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-on-surface-2">排版张数</span>
              <input
                type="number"
                value={newSpecForm.sheetCount}
                onChange={(e) => setNewSpecForm((f) => ({ ...f, sheetCount: e.target.value }))}
                className="h-9 rounded-lg border border-outline bg-surface px-2.5 outline-none focus:border-primary/60"
              />
            </label>
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Segmented<PhotoFormat>
              size="sm"
              ariaLabel="新规格导出格式"
              value={newSpecForm.format}
              onChange={(format) => setNewSpecForm((f) => ({ ...f, format }))}
              options={[
                { value: 'jpeg', label: 'JPEG' },
                { value: 'png', label: 'PNG' },
              ]}
            />
            <Button variant="primary" className="h-9 px-4" onClick={submitNewSpec}>
              保存并选中
            </Button>
          </div>
        </div>
      )}

      {jsonOpen && (
        <div className="flex flex-col gap-2">
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            rows={8}
            spellCheck={false}
            aria-label="规格 JSON 编辑器"
            className="w-full rounded-[12px] border border-outline bg-surface-2 px-3 py-2.5 text-[12px] leading-relaxed font-mono outline-none focus:border-primary/60 resize-y"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="primary" className="h-9 px-4" onClick={saveJson}>
              校验并保存
            </Button>
            <p className="text-[11px] text-on-surface-2 leading-relaxed">
              字段：name / width / height / dpi / minKb / maxKb / format(jpeg|png) / headRatio / headroom / sheetCount
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
