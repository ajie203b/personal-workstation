import { useState } from 'react'
import { FileText, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { SelectMenu } from '@/shared/ui/SelectMenu'
import { Segmented } from '@/shared/ui/Segmented'
import { PDFDocument } from 'pdf-lib'
import { rasterizePdf } from './pdfRender'
import { zipFiles, type ToolOutput } from './output'
import { Field, FilePicker, OutputBar, Panel, fileBytes } from './parts'

type Format = 'png' | 'jpeg'

/** PDF 转图片：按 DPI 渲染（scale = dpi/72），多页打包 zip */
export function PdfToImagesPanel() {
  const [file, setFile] = useState<File | null>(null)
  const [total, setTotal] = useState(0)
  const [dpi, setDpi] = useState('150')
  const [format, setFormat] = useState<Format>('png')
  const [name, setName] = useState('导出')
  const [progress, setProgress] = useState('')

  const pick = async (f: File) => {
    setFile(f)
    setTotal(0)
    try {
      const doc = await PDFDocument.load(await fileBytes(f), { ignoreEncryption: true })
      setTotal(doc.getPageCount())
    } catch {
      setFile(null)
      setTotal(0)
    }
  }

  const make = async (): Promise<ToolOutput> => {
    if (!file) throw new Error('先选一份 PDF')
    const base = name.trim() || '导出'
    setProgress('')
    const files = await rasterizePdf(await fileBytes(file), {
      dpi: Number(dpi),
      format,
      baseName: base,
      onProgress: (done, all) => setProgress(`${done}/${all}`),
    })
    setProgress('')
    if (files.length === 1) {
      return { blob: files[0].blob, filename: files[0].name, isPdf: false }
    }
    return { blob: await zipFiles(files), filename: `${base}.zip`, isPdf: false }
  }

  return (
    <Panel title="PDF 转图片" desc="按 DPI 逐页渲染成 PNG / JPEG；多页自动打包 zip。">
      {file ? (
        <div className="flex items-center gap-2 rounded-[12px] border border-outline bg-surface-2 px-3 py-2">
          <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-primary-soft text-primary shrink-0">
            <FileText size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-5 truncate">{file.name}</p>
            <p className="text-[11px] text-on-surface-2">
              {total ? `共 ${total} 页` : '读取页数中…'}
              {progress ? ` · 已渲 ${progress}` : ''}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setFile(null)} aria-label="移除">
            <X size={16} />
          </Button>
        </div>
      ) : (
        <FilePicker accept="application/pdf" label="选择 PDF" onPick={(files) => void pick(files[0])} />
      )}

      <Field label="清晰度">
        <SelectMenu
          value={dpi}
          onChange={setDpi}
          options={[
            { value: '72', label: '72 DPI（屏幕）' },
            { value: '150', label: '150 DPI（清晰）' },
            { value: '300', label: '300 DPI（打印）' },
          ]}
          ariaLabel="清晰度"
          title="清晰度"
          triggerClassName="w-36"
        />
      </Field>
      <Field label="格式">
        <Segmented
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'jpeg', label: 'JPEG' },
          ]}
          value={format}
          onChange={(v) => setFormat(v as Format)}
          ariaLabel="图片格式"
          size="sm"
        />
      </Field>
      <p className="text-[11px] text-on-surface-2 leading-relaxed">
        300 DPI 大图会比较占内存，页数多时建议先用 150 DPI 试一页效果。
      </p>

      <Field label="文件名">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="导出"
          className="w-40 h-9 rounded-[10px] border border-outline bg-surface-2 px-3 text-[13px] outline-none focus:border-primary/60 text-right"
        />
      </Field>

      <OutputBar make={make} action="导出" disabled={!file || !total} />
    </Panel>
  )
}
