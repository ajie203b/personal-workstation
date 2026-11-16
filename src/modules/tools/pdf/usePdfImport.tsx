import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { PDFDocument } from 'pdf-lib'
import { Dialog } from '@/shared/ui/Sheet'
import { Button } from '@/shared/ui/Button'
import { inspectPdfEncryption, type PdfInspection } from './pdfInspect'
import { runPdfJob } from './qpdfClient'
import { validatePdfBytes } from './qpdfTypes'

/** 各工具共用的 PDF 输入边界；解密后的 File 只存在于当前工具内存中。 */
export function usePdfImport(onPick: (files: File[]) => void, unlock: boolean) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [prompt, setPrompt] = useState<{ name: string; error: string } | null>(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const controller = useRef<AbortController>()
  const resolver = useRef<((password: string | null) => void) | null>(null)
  const mounted = useRef(true)
  const cancel = () => {
    controller.current?.abort()
    resolver.current?.(null)
    resolver.current = null
    if (mounted.current) { setPrompt(null); setPassword(''); setShowPassword(false); setBusy(false) }
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); resolver.current?.(null) } }, [])

  const requestPassword = (name: string, error: string) => new Promise<string | null>(resolve => {
    resolver.current = resolve
    setPassword('')
    setShowPassword(false)
    setPrompt({ name, error })
  })
  const makeUnlockedFile = async (source: File, decrypted: Uint8Array) => {
    const unlockedDoc = await PDFDocument.load(decrypted)
    if (unlockedDoc.getPageCount() === 0) throw new Error(`「${source.name}」没有页面`)
    return new File([decrypted as BlobPart], source.name, { type: 'application/pdf', lastModified: source.lastModified })
  }
  const importFiles = async (files: File[]) => {
    cancel()
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    setError('')
    try {
      const ready: File[] = []
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (abort.signal.aborted) return
        validatePdfBytes(bytes)
        let inspection: PdfInspection
        try { inspection = await inspectPdfEncryption(bytes) }
        catch { throw new Error(`「${file.name}」无法读取，请确认 PDF 文件完整`) }
        if (!inspection.encrypted) {
          if (!inspection.doc || inspection.doc.getPageCount() === 0) throw new Error(`「${file.name}」没有页面`)
          ready.push(file)
          continue
        }
        if (!unlock) { ready.push(file); continue }
        // 有些 PDF 只限制打印/复制，打开密码为空，无需打扰用户输入。
        try {
          const output = await runPdfJob(bytes, { kind: 'decrypt', password: '' }, { signal: abort.signal })
          ready.push(await makeUnlockedFile(file, output.bytes))
          continue
        } catch (e) {
          if (abort.signal.aborted) return
          if (!(e instanceof Error) || !e.message.includes('密码不正确')) throw e
        }
        let passwordError = ''
        for (;;) {
          const input = await requestPassword(file.name, passwordError)
          if (input === null || abort.signal.aborted) return
          try {
            const result = await runPdfJob(bytes, { kind: 'decrypt', password: input }, { signal: abort.signal })
            ready.push(await makeUnlockedFile(file, result.bytes))
            break
          } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') return
            if (!(e instanceof Error) || !e.message.includes('密码不正确')) throw e
            passwordError = e.message
          }
        }
      }
      if (!abort.signal.aborted && mounted.current) onPick(ready)
    } catch (e) {
      if (!abort.signal.aborted && mounted.current) setError(e instanceof Error ? e.message : '读取 PDF 失败')
    } finally {
      if (controller.current === abort && mounted.current) { setBusy(false); setPassword(''); setShowPassword(false); setPrompt(null) }
    }
  }
  const submitPassword = () => {
    if (!password.length) return
    resolver.current?.(password)
    resolver.current = null
    setPrompt(null)
    setPassword('')
    setShowPassword(false)
  }
  const dialog = <Dialog open={!!prompt} onOpenChange={open => { if (!open) cancel() }} title="输入 PDF 密码">
    <p className="text-[13px] text-on-surface-2 break-all">{prompt?.name}</p>
    <p className="text-[12px] text-on-surface-2 mt-2">输入已知打开密码后继续处理。密码仅用于本次解密，处理后的副本不带密码。</p>
    <div className="relative mt-3 flex items-center">
      <input type={showPassword ? 'text' : 'password'} aria-label="PDF 打开密码" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitPassword() }}
        className="w-full h-10 pl-3 pr-10 rounded-[10px] bg-surface-2 border border-outline outline-none focus:border-primary" />
      <button type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword(v => !v)}
        className="absolute right-1 grid place-items-center w-8 h-8 rounded-[8px] text-on-surface-2 hover:text-on-surface cursor-pointer">
        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
    {prompt?.error && <p role="alert" className="text-danger text-[12px] mt-2">{prompt.error}</p>}
    <div className="flex justify-end gap-2 mt-4"><Button onClick={cancel}>取消</Button><Button variant="primary" disabled={!password.length} onClick={submitPassword}>解锁并继续</Button></div>
  </Dialog>
  return { importFiles, busy, error, dialog, cancel }
}
