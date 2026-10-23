import { useEffect, useRef, useState } from 'react'
import { runPdfJob } from './qpdfClient'
import type { PdfJob, PdfJobResult, PdfProgress } from './qpdfTypes'

export function usePdfJob() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PdfJobResult | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<PdfProgress>({ percent: 0, label: '' })
  const controller = useRef<AbortController>()
  const reset = () => {
    controller.current?.abort()
    controller.current = undefined
    setBusy(false); setResult(null); setError(''); setProgress({ percent: 0, label: '' })
  }
  useEffect(() => () => { controller.current?.abort(); controller.current = undefined }, [])
  const run = async (file: File, job: PdfJob) => {
    reset()
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const output = await runPdfJob(bytes, job, { signal: abort.signal, onProgress: setProgress })
      if (!abort.signal.aborted) { setResult(output); setProgress({ percent: 100, label: '处理完成' }) }
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'PDF 处理失败')
    } finally {
      if (controller.current === abort) setBusy(false)
    }
  }
  return { busy, result, error, progress, run, reset }
}
