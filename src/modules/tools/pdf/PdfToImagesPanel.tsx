import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { FileText, ScanText, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { SelectMenu } from '@/shared/ui/SelectMenu'
import { Segmented } from '@/shared/ui/Segmented'
import { PDFDocument } from 'pdf-lib'
import { setPendingOcrFiles } from '../ocr/ocrHandoff'
import { usePdfHandoff } from './handoff'
import { rasterizePdf } from './pdfRender'
import { zipFiles, type ToolOutput } from './output'
import { FIELD_INPUT, Field, FilePicker, OutputBar, Panel, fileBytes } from './parts'
import { parsePageExpr } from './pdfPages'
import { useUi } from '@/stores/ui'

type Format = 'png' | 'jpeg'

/** PDF 转图片：按 DPI 渲染（scale = dpi/72），多页打包 zip，也可直接送入本地 OCR */
export function PdfToImagesPanel() {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [total, setTotal] = useState(0)
  const [dpi, setDpi] = useState('150')
  const [format, setFormat] = useState<Format>('png')
  const [name, setName] = useState('导出')
  const [progress, setProgress] = useState('')
  const [progressRatio, setProgressRatio] = useState<number | null>(null)
  const [expr, setExpr] = useState('')
  const [quality, setQuality] = useState('90')
  const [sendingOcr, setSendingOcr] = useState(false)
  const controller = useRef<AbortController>()
  useEffect(() => () => controller.current?.abort(), [])
  const cancel = () => { controller.current?.abort(); setProgress(''); setProgressRatio(null) }

  const pick = useCallback(async (f: File) => {
    setFile(f)
    setTotal(0)
    try {
      const doc = await PDFDocument.load(await fileBytes(f))
      setTotal(doc.getPageCount())
    } catch {
      useUi.getState().toast('无法读取这份 PDF，请重新选择文件')
      setFile(null)
      setTotal(0)
    }
  }, [])

  usePdfHandoff('pdf2img', (incoming) => void pick(incoming))

  const rasterizeSelected = async (abort: AbortController) => {
    if (!file) throw new Error('先选一份 PDF')
    const base = name.trim() || '导出'
    const pages = expr.trim() ? parsePageExpr(expr, total) : undefined
    return rasterizePdf(await fileBytes(file), {
      dpi: Number(dpi),
      format,
      baseName: base,
      pages,
      quality: Number(quality) / 100,
      signal: abort.signal,
      onProgress: (done, all) => {
        setProgress(`${done}/${all}`)
        setProgressRatio(all > 0 ? done / all : null)
      },
    })
  }

  const make = async (): Promise<ToolOutput> => {
    const base = name.trim() || '导出'
    const abort = new AbortController()
    controller.current = abort
    setProgress('准备中')
    setProgressRatio(null)
    try {
      const files = await rasterizeSelected(abort)
      abort.signal.throwIfAborted()
      if (files.length === 1) return { blob: files[0].blob, filename: files[0].name, isPdf: false }
      const blob = await zipFiles(files)
      abort.signal.throwIfAborted()
      return { blob, filename: `${base}.zip`, isPdf: false }
    } catch (e) {
      if (abort.signal.aborted) throw new Error('已取消导出')
      throw e
    } finally { if (controller.current === abort) { controller.current = undefined; setProgress(''); setProgressRatio(null) } }
  }

  const sendToOcr = async () => {
    if (!file || !total || progress || sendingOcr) return
    const abort = new AbortController()
    controller.current = abort
    setSendingOcr(true)
    setProgress('准备送入 OCR')
    setProgressRatio(null)
    try {
      const files = await rasterizeSelected(abort)
      abort.signal.throwIfAborted()
      const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png'
      const imgFiles = files.map((f) => new File([f.blob], f.name, { type: f.blob.type || mime }))
      setPendingOcrFiles(imgFiles)
      navigate('/tools/ocr')
    } catch (e) {
      if (!abort.signal.aborted) {
        useUi.getState().toast(e instanceof Error ? e.message : '渲染失败')
      }
    } finally {
      if (controller.current === abort) { controller.current = undefined; setProgress(''); setProgressRatio(null) }
      setSendingOcr(false)
    }
  }

  return (
    <Panel
      title="PDF 转图片"
      desc="按 DPI 逐页渲染成 PNG / JPEG；多页自动打包 zip。"
      busy={Boolean(progress)}
      progress={progressRatio}
      progressLabel="PDF 转图片进度"
    >
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
          <Button variant="ghost" size="icon" disabled={!!progress} onClick={() => { cancel(); setFile(null) }} aria-label="移除">
            <X size={16} />
          </Button>
        </div>
      ) : (
        <FilePicker accept="application/pdf,.pdf" label="选择 PDF" onPick={(files) => void pick(files[0])} />
      )}

      <fieldset disabled={!!progress} className="contents">
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
      <Field label="导出页码"><input aria-label="导出页码" value={expr} disabled={!!progress} onChange={e => setExpr(e.target.value)} placeholder="留空为全部，如 1-3,5" className={FIELD_INPUT} /></Field>
      <Field label="格式">
        <Segmented
          asRadio
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
      {format === 'jpeg' && <Field label="JPEG 质量"><SelectMenu ariaLabel="JPEG 质量" value={quality} onChange={setQuality} options={[{ value: '70', label: '70% · 较小' }, { value: '90', label: '90% · 清晰' }, { value: '100', label: '100% · 最高' }]} /></Field>}
      <p className="text-[11px] text-on-surface-2 leading-relaxed">
        300 DPI 较占内存，建议先选一页试效果。超大页面会按设备画布上限适配，避免导出失败。
      </p>

      <Field label="文件名">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="导出"
          className={FIELD_INPUT}
        />
      </Field>

      </fieldset>
      {progress && <Button size="sm" onClick={cancel}>取消导出</Button>}
      <div className="flex items-center gap-2 flex-wrap">
        <OutputBar make={make} action="导出" disabled={!file || !total || sendingOcr} allowLibrary={false} allowHandoff={false} />
        <Button
          variant="outline"
          disabled={!file || !total || Boolean(progress) || sendingOcr}
          onClick={() => void sendToOcr()}
        >
          <ScanText size={15} /> {sendingOcr ? '正在送入 OCR…' : '转图并送入本地 OCR'}
        </Button>
      </div>
    </Panel>
  )
}
