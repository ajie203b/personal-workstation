import { useEffect, useRef, useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { Dialog } from '@/shared/ui/Sheet'
import { Button } from '@/shared/ui/Button'
import { runPdfJob } from './qpdfClient'
import { validatePdfBytes } from './qpdfTypes'

/** 各工具共用的 PDF 输入边界；解密后的 File 只存在于当前工具内存中。 */
export function usePdfImport(onPick: (files: File[]) => void, unlock: boolean) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [prompt, setPrompt] = useState<{ name: string; error: string } | null>(null)
  const [password, setPassword] = useState('')
  const controller = useRef<AbortController>()
  const resolver = useRef<((password: string | null) => void) | null>(null)
  const mounted = useRef(true)
  const cancel = () => {
    controller.current?.abort()
    resolver.current?.(null)
    resolver.current = null
    if (mounted.current) { setPrompt(null); setPassword(''); setBusy(false) }
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); resolver.current?.(null) } }, [])

  const requestPassword = (name: string, error: string) => new Promise<string | null>(resolve => {
    resolver.current = resolve
    setPassword('')
    setPrompt({ name, error })
  })
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
        let doc: PDFDocument
        try { doc = await PDFDocument.load(bytes, { ignoreEncryption: true }) }
        catch { throw new Error(`「${file.name}」无法读取，请确认 PDF 文件完整`) }
        if (doc.getPageCount() === 0) throw new Error(`「${file.name}」没有页面`)
        if (!unlock || !doc.isEncrypted) { ready.push(file); continue }
        // 有些 PDF 只限制打印/复制，打开密码为空，无需打扰用户输入。
        try {
          const output = await runPdfJob(bytes, { kind: 'decrypt', password: '' }, { signal: abort.signal })
          ready.push(new File([output.bytes as BlobPart], file.name, { type: 'application/pdf', lastModified: file.lastModified }))
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
            ready.push(new File([result.bytes as BlobPart], file.name, { type: 'application/pdf', lastModified: file.lastModified }))
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
      if (controller.current === abort && mounted.current) { setBusy(false); setPassword(''); setPrompt(null) }
    }
  }
  const submitPassword = () => {
    if (!password.length) return
    resolver.current?.(password)
    resolver.current = null
    setPrompt(null)
    setPassword('')
  }
  const dialog = <Dialog open={!!prompt} onOpenChange={open => { if (!open) cancel() }} title="输入 PDF 密码">
    <p className="text-[13px] text-on-surface-2 break-all">{prompt?.name}</p>
    <p className="text-[12px] text-on-surface-2 mt-2">输入已知打开密码后继续处理。密码仅用于本次解密，处理后的副本不带密码。</p>
    <input type="password" aria-label="PDF 打开密码" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitPassword() }}
      className="w-full h-10 mt-3 px-3 rounded-[10px] bg-surface-2 border border-outline outline-none focus:border-primary" />
    {prompt?.error && <p role="alert" className="text-danger text-[12px] mt-2">{prompt.error}</p>}
    <div className="flex justify-end gap-2 mt-4"><Button onClick={cancel}>取消</Button><Button variant="primary" disabled={!password.length} onClick={submitPassword}>解锁并继续</Button></div>
  </Dialog>
  return { importFiles, busy, error, dialog, cancel }
}
