import { useState } from 'react'
import { Minimize2, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Segmented } from '@/shared/ui/Segmented'
import { formatBytes } from '@/lib/format'
import { FilePicker, OutputBar, Panel, pdfBlob } from './parts'
import { usePdfJob } from './usePdfJob'
import { JobFeedback } from './JobFeedback'
import type { CompressionPreset } from './qpdfTypes'

export function CompressPanel() {
  const [file, setFile] = useState<File | null>(null)
  const [preset, setPreset] = useState<CompressionPreset>('balanced')
  const job = usePdfJob()
  const result = job.result
  return <Panel title="压缩 PDF" desc="保留可搜索文字、矢量图与页面结构。根据用途选择质量，处理完成后再保存。">
    {file ? <div className="flex items-center gap-2 rounded-[12px] bg-surface-2 border border-outline p-3">
      <div className="flex-1 min-w-0"><p className="text-[13px] truncate">{file.name}</p><p className="text-[11px] text-on-surface-2">{formatBytes(file.size)}</p></div>
      <Button size="icon" aria-label="移除 PDF" onClick={() => { job.reset(); setFile(null) }}><X size={16} /></Button>
    </div> : <FilePicker accept="application/pdf,.pdf" label="选择要压缩的 PDF" onPick={files => { job.reset(); setFile(files[0]) }} />}
    <Segmented ariaLabel="压缩模式" value={preset} onChange={v => { job.reset(); setPreset(v) }} options={[
      { value: 'lossless', label: '无损' }, { value: 'balanced', label: '均衡' }, { value: 'small', label: '更小体积' },
    ]} />
    <p className="text-[12px] text-on-surface-2 leading-relaxed">{preset === 'lossless' ? '只优化文件结构与数据流，不重新编码图片，适合图纸与高质量文档。' : preset === 'balanced' ? '优化结构并适度压缩图片，适合阅读与分享。文字保持清晰可选中。' : '进一步降低图片质量，适合体积优先的分享；保存前请检查图像细节。'}</p>
    <Button variant="primary" disabled={!file || job.busy} onClick={() => { if (file) void job.run(file, { kind: 'compress', preset }) }}><Minimize2 size={16} />开始压缩</Button>
    <JobFeedback {...job} onCancel={job.reset} />
    {result && <div className="flex flex-col gap-3 rounded-[12px] bg-primary-soft/40 border border-primary/20 p-3" role="status">
      <div className="flex items-center justify-between gap-2 text-[13px]"><span>{formatBytes(result.originalSize)} → {formatBytes(result.outputSize)}</span><b className="text-primary">节省 {((1 - result.outputSize / result.originalSize) * 100).toFixed(1)}%</b></div>
      <p className="text-[12px] text-on-surface-2">{result.usedOriginal ? '这份文件已较精简，本次没有进一步缩小，保留原文件质量与体积。' : '压缩完成，可下载或加入文档库。'}{result.warnings ? ' 输入文件存在结构问题，已作兼容处理，请核对输出。' : ''}</p>
      <OutputBar make={async () => ({ blob: pdfBlob(result.bytes), filename: `${file?.name.replace(/\.pdf$/i, '') || '文档'}-压缩.pdf`, isPdf: true })} />
    </div>}
  </Panel>
}
