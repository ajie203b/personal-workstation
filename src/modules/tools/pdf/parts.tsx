import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Download, FolderOpen, Loader2, Upload } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { useUi } from '@/stores/ui'
import { exportToDownloads, exportToLibrary, isBigFile, type ToolOutput } from './output'
import { usePdfImport } from './usePdfImport'

/** 面板统一卡片容器 */
export function Panel({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="card p-4 flex flex-col gap-3">
      <div>
        <h2 className="text-[15px] font-semibold leading-6">{title}</h2>
        {desc && <p className="text-[11.5px] text-on-surface-2 leading-relaxed mt-0.5">{desc}</p>}
      </div>
      {children}
    </section>
  )
}

/** 行内「标签 + 控件」 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 min-h-9">
      <span className="text-[12.5px] text-on-surface-2 shrink-0">{label}</span>
      <div className="min-w-0 flex justify-end">{children}</div>
    </div>
  )
}

/** 选文件入口（虚线卡片）；超过 100MB 的文件给出警告但不拦 */
export function FilePicker({
  accept,
  multiple,
  onPick,
  label = '选择文件',
  hint,
  unlockPdf = true,
}: {
  accept: string
  multiple?: boolean
  onPick: (files: File[]) => void
  label?: string
  hint?: string
  unlockPdf?: boolean
}) {
  const toast = useUi((s) => s.toast)
  const id = useId()
  const pdfImport = usePdfImport(onPick, unlockPdf)
  return (
    <>
    <label
      htmlFor={id}
      className="flex flex-col items-center justify-center gap-1 border border-dashed border-outline rounded-[12px] py-5 px-3 text-center cursor-pointer hover:border-primary/50 hover:bg-surface-2/60 transition-colors"
    >
      <input
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={pdfImport.busy}
        className="sr-only"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (!list.length) return
          const big = list.find((f) => isBigFile(f.size))
          if (big) toast(`「${big.name}」超过 100MB，处理可能较慢、占内存`)
          if (accept.includes('pdf')) void pdfImport.importFiles(list)
          else onPick(list)
        }}
      />
      <span className="grid place-items-center w-9 h-9 rounded-full bg-primary-soft text-primary">
        <Upload size={16} />
      </span>
      <span className="text-[13px] font-medium">{pdfImport.busy ? '正在读取 PDF…' : label}</span>
      {hint && <span className="text-[11px] text-on-surface-2">{hint}</span>}
    </label>
    {pdfImport.busy && <Button size="sm" onClick={pdfImport.cancel}>取消读取</Button>}
    {pdfImport.error && <p role="alert" className="text-[12px] text-danger break-words">{pdfImport.error}</p>}
    {pdfImport.dialog}
    </>
  )
}

/** 输出两出口：存到「下载/个人工作站」或进文档库 */
export function OutputBar({
  make,
  action = '导出',
  disabled,
  allowLibrary = true,
  downloadLabel = '存到下载',
}: {
  make: () => Promise<ToolOutput>
  action?: string
  disabled?: boolean
  allowLibrary?: boolean
  downloadLabel?: string
}) {
  const toast = useUi((s) => s.toast)
  const [busy, setBusy] = useState<'save' | 'lib' | ''>('')
  const locked = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const run = async (dest: 'save' | 'lib') => {
    if (locked.current) return
    locked.current = true
    setBusy(dest)
    try {
      const out = await make()
      if (!mounted.current) return
      if (dest === 'save') await exportToDownloads(out, toast)
      else await exportToLibrary(out, toast)
    } catch (e) {
      toast(e instanceof Error ? e.message : `${action}失败`)
    } finally {
      locked.current = false
      if (mounted.current) setBusy('')
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button
        variant="primary"
        onClick={() => void run('save')}
        disabled={disabled || Boolean(busy)}
        className="h-9 px-4"
      >
        {busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
        {downloadLabel}
      </Button>
      {allowLibrary && <Button onClick={() => void run('lib')} disabled={disabled || Boolean(busy)} className="h-9 px-4">
        {busy === 'lib' ? <Loader2 size={15} className="animate-spin" /> : <FolderOpen size={15} />}
        进文档库
      </Button>}
    </div>
  )
}

/** Uint8Array → PDF Blob（各面板出 PDF 都走这） */
export function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
}

/** 读文件字节 */
export async function fileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}
