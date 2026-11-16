import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import * as RadixMenu from '@radix-ui/react-dropdown-menu'
import { ArrowRight, ChevronDown, Download, FolderOpen, Loader2, Upload } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/lib/cn'
import { useUi } from '@/stores/ui'
import { HANDOFF_TARGETS, usePdfHandoffContext, type PdfToolTab } from './handoff'
import { exportToDownloads, exportToLibrary, isBigFile, type ToolOutput } from './output'
import { safeOutputName } from './outputName'
import { usePdfImport } from './usePdfImport'

/** 面板内各 `Field` 单行文本输入框统一样式 */
export const FIELD_INPUT =
  'w-44 sm:w-52 max-w-full h-9 rounded-[10px] border border-outline bg-surface-2 px-3 text-[13px] text-on-surface outline-none focus:border-primary/60'

const EXT_FALLBACK_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
}

/** 校验拖拽或选择的文件是否符合 `accept` 规则（MIME 为空时回退到扩展名）。 */
export function matchesFileAccept(file: Pick<File, 'type' | 'name'>, accept: string): boolean {
  const rules = accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (!rules.length) return true
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? ''
  const mime = (file.type.trim().toLowerCase() || (ext ? EXT_FALLBACK_MIME[ext] ?? '' : ''))
  return rules.some((rule) => {
    if (rule === '*/*') return true
    if (rule.startsWith('.')) return ext ? `.${ext}` === rule : false
    if (rule.endsWith('/*')) return mime.startsWith(rule.slice(0, -1))
    return mime === rule
  })
}

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

/** 选文件入口（支持点击与拖放；超过 100MB 的文件给出警告但不拦） */
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
  const [dragging, setDragging] = useState(false)

  const handleFiles = (rawList: File[], fromDrop = false) => {
    if (!rawList.length || pdfImport.busy) return
    let list = rawList
    if (fromDrop) {
      const valid = rawList.filter((f) => matchesFileAccept(f, accept))
      const rejected = rawList.length - valid.length
      if (!valid.length) {
        toast('不支持该文件格式')
        return
      }
      if (rejected > 0) toast(`已跳过 ${rejected} 个不支持的文件`)
      list = multiple ? valid : [valid[0]]
    }
    const big = list.find((f) => isBigFile(f.size))
    if (big) toast(`「${big.name}」超过 100MB，处理可能较慢、占内存`)
    if (accept.includes('pdf')) void pdfImport.importFiles(list)
    else onPick(list)
  }

  return (
    <>
    <label
      htmlFor={id}
      onDragOver={(e) => {
        if (pdfImport.busy) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!dragging) setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        handleFiles(Array.from(e.dataTransfer.files ?? []), true)
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-1 border border-dashed rounded-[12px] py-5 px-3 text-center cursor-pointer transition-colors',
        dragging
          ? 'border-primary bg-primary-soft/45 ring-2 ring-primary/25'
          : 'border-outline hover:border-primary/50 hover:bg-surface-2/60',
      )}
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
          handleFiles(list)
        }}
      />
      <span className="pointer-events-none grid place-items-center w-9 h-9 rounded-full bg-primary-soft text-primary">
        <Upload size={16} />
      </span>
      <span className="pointer-events-none text-[13px] font-medium">
        {pdfImport.busy ? '正在读取 PDF…' : dragging ? '松开即可导入文件' : label}
      </span>
      {hint && <span className="pointer-events-none text-[11px] text-on-surface-2">{hint}</span>}
    </label>
    {pdfImport.busy && <Button size="sm" onClick={pdfImport.cancel}>取消读取</Button>}
    {pdfImport.error && <p role="alert" className="text-[12px] text-danger break-words">{pdfImport.error}</p>}
    {pdfImport.dialog}
    </>
  )
}

/** 输出出口：存到「下载/个人工作站」、进文档库、或内存交接至其他 PDF 工具继续处理 */
export function OutputBar({
  make,
  action = '导出',
  disabled,
  allowLibrary = true,
  allowHandoff = true,
  downloadLabel = '存到下载',
}: {
  make: () => Promise<ToolOutput>
  action?: string
  disabled?: boolean
  allowLibrary?: boolean
  allowHandoff?: boolean
  downloadLabel?: string
}) {
  const toast = useUi((s) => s.toast)
  const handoffCtx = usePdfHandoffContext()
  const [busy, setBusy] = useState<'save' | 'lib' | 'handoff' | ''>('')
  const locked = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const targets = handoffCtx
    ? HANDOFF_TARGETS.filter((t) => t.value !== handoffCtx.currentTab)
    : []

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

  const runHandoff = async (targetTab: PdfToolTab) => {
    if (!handoffCtx || locked.current) return
    locked.current = true
    setBusy('handoff')
    try {
      const out = await make()
      if (!mounted.current) return
      if (!out.isPdf) {
        toast('只有 PDF 结果可继续处理')
        return
      }
      const file = new File([out.blob], safeOutputName(out.filename), { type: 'application/pdf' })
      handoffCtx.handoff(file, targetTab)
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
      {allowHandoff && handoffCtx && targets.length > 0 && (
        <RadixMenu.Root>
          <RadixMenu.Trigger asChild>
            <Button variant="outline" disabled={disabled || Boolean(busy)} className="h-9 px-3.5">
              {busy === 'handoff' ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
              继续处理
              <ChevronDown size={13} className="opacity-70" />
            </Button>
          </RadixMenu.Trigger>
          <RadixMenu.Portal>
            <RadixMenu.Content
              side="bottom"
              sideOffset={6}
              align="start"
              collisionPadding={12}
              className="select-menu pop z-50 p-1.5 min-w-[176px] max-h-[60dvh] overflow-y-auto"
            >
              {targets.map((t) => (
                <RadixMenu.Item
                  key={t.value}
                  onSelect={() => void runHandoff(t.value)}
                  className="flex items-center gap-2 px-3 h-10 rounded-[10px] text-[13px] cursor-pointer outline-none select-none transition-colors data-[highlighted]:bg-surface-3"
                >
                  <ArrowRight size={13} className="text-primary shrink-0" />
                  <span>{t.label}</span>
                </RadixMenu.Item>
              ))}
            </RadixMenu.Content>
          </RadixMenu.Portal>
        </RadixMenu.Root>
      )}
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
