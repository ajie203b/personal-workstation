import { useState } from 'react'
import { FileText, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { SelectMenu } from '@/shared/ui/SelectMenu'
import { Segmented } from '@/shared/ui/Segmented'
import { useUi } from '@/stores/ui'
import { PDFDocument } from 'pdf-lib'
import { parsePageExpr, parsePageGroups } from './pdfPages'
import { extractPages, splitByGroups } from './pdfOps'
import { zipFiles, type ToolOutput } from './output'
import { Field, FilePicker, OutputBar, Panel, fileBytes, pdfBlob } from './parts'

type Mode = 'extract' | 'groups' | 'per-page'

const MODES: { value: Mode; label: string }[] = [
  { value: 'extract', label: '提取合并' },
  { value: 'groups', label: '按段拆分' },
  { value: 'per-page', label: '每页一份' },
]

/** 拆分 / 提取：页码表达式 `1-3,5,8-` 选页；多份输出打 zip */
export function SplitPanel() {
  const toast = useUi((s) => s.toast)
  const [file, setFile] = useState<File | null>(null)
  const [total, setTotal] = useState(0)
  const [mode, setMode] = useState<Mode>('extract')
  const [expr, setExpr] = useState('1-3')
  const [name, setName] = useState('拆分')
  const [everyN, setEveryN] = useState('2')

  const pick = async (f: File) => {
    setFile(f)
    setTotal(0)
    try {
      const doc = await PDFDocument.load(await fileBytes(f), { ignoreEncryption: true })
      setTotal(doc.getPageCount())
    } catch {
      toast('打不开这份 PDF（可能已损坏或格式特殊）')
      setFile(null)
    }
  }

  const make = async (): Promise<ToolOutput> => {
    if (!file) throw new Error('先选一份 PDF')
    if (!total) throw new Error('正在读取页数，稍等一下')
    const bytes = await fileBytes(file)
    const base = name.trim() || '拆分'

    if (mode === 'extract') {
      const pages = parsePageExpr(expr, total)
      if (!pages.length) throw new Error('先填要提取的页码，例如 1-3,5,8-')
      return { blob: pdfBlob(await extractPages(bytes, pages)), filename: `${base}.pdf`, isPdf: true }
    }

    let groups: number[][]
    if (mode === 'per-page') {
      const n = Math.max(1, Math.floor(Number(everyN) || 1))
      groups = []
      for (let start = 1; start <= total; start += n) {
        const end = Math.min(total, start + n - 1)
        groups.push(Array.from({ length: end - start + 1 }, (_, i) => start + i))
      }
    } else {
      groups = parsePageGroups(expr, total)
      if (!groups.length) throw new Error('先填分段表达式，例如 1-3;4-6;7-')
    }

    const outs = await splitByGroups(bytes, groups)
    if (outs.length === 1) {
      return { blob: pdfBlob(outs[0]), filename: `${base}.pdf`, isPdf: true }
    }
    // 多份输出打 zip（含 PDF 无法直接进文档库，只能存下载）
    const zip = await zipFiles(
      outs.map((b, i) => ({ name: `${base}-${i + 1}.pdf`, blob: pdfBlob(b) })),
    )
    return { blob: zip, filename: `${base}.zip`, isPdf: false }
  }

  return (
    <Panel
      title="拆分 / 提取"
      desc="页码表达式支持 1-3、5、8-（到末页）、-4（从头开始）；结果去重保序，越界会报错。"
    >
      {file ? (
        <div className="flex items-center gap-2 rounded-[12px] border border-outline bg-surface-2 px-3 py-2">
          <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-primary-soft text-primary shrink-0">
            <FileText size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-5 truncate">{file.name}</p>
            <p className="text-[11px] text-on-surface-2">{total ? `共 ${total} 页` : '读取页数中…'}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setFile(null)} aria-label="移除">
            <X size={16} />
          </Button>
        </div>
      ) : (
        <FilePicker accept="application/pdf" label="选择 PDF" onPick={(files) => void pick(files[0])} />
      )}

      <Segmented options={MODES} value={mode} onChange={setMode} ariaLabel="拆分方式" className="self-start" />

      {mode === 'extract' && (
        <Field label="提取页码">
          <input
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            placeholder="如 1-3,5,8-"
            className="w-52 h-9 rounded-[10px] border border-outline bg-surface-2 px-3 text-[13px] outline-none focus:border-primary/60 text-right"
          />
        </Field>
      )}
      {mode === 'groups' && (
        <Field label="分段表达式">
          <input
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            placeholder="如 1-3;4-6;7-"
            className="w-52 h-9 rounded-[10px] border border-outline bg-surface-2 px-3 text-[13px] outline-none focus:border-primary/60 text-right"
          />
        </Field>
      )}
      {mode === 'per-page' && (
        <Field label="每份页数">
          <SelectMenu
            value={everyN}
            onChange={setEveryN}
            ariaLabel="每份页数"
            options={['1', '2', '3', '5', '10'].map((n) => ({ value: n, label: `${n} 页` }))}
            triggerClassName="w-28"
          />
        </Field>
      )}
      <p className="text-[11px] text-on-surface-2 leading-relaxed">
        {mode === 'extract' && '把选中的页合成一份新 PDF。'}
        {mode === 'groups' && '分号分段，每段出一份 PDF；多份结果打包 zip。'}
        {mode === 'per-page' && '按固定页数切开；多份结果打包 zip。'}
      </p>

      <Field label="文件名">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="拆分"
          className="w-40 h-9 rounded-[10px] border border-outline bg-surface-2 px-3 text-[13px] outline-none focus:border-primary/60 text-right"
        />
      </Field>

      <OutputBar make={make} action="拆分" disabled={!file || !total} />
    </Panel>
  )
}
