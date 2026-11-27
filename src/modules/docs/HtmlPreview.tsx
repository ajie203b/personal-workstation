import { useEffect, useState } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { Doc } from '@/db/db'
import { getDocBlob, touchDoc } from '@/db/docs'
import { readDocumentText } from '@/lib/readDocumentText'
import { useDocumentPrintTitle } from '@/lib/printDocument'

const nativePreview = registerPlugin<{ open(options: { html: string; title: string }): Promise<void> }>('HtmlPreview')
const policy = "default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; navigate-to 'none'"

function buildPreviewHtml(source: string, android: boolean): string {
  // 去掉可触发 iframe 自导航逃逸沙箱的 meta refresh，并避免重复拼接 <!doctype html>
  const stripped = source.replace(/<meta\b[^>]*http-equiv\s*=\s*(?:"refresh"|'refresh'|refresh)[^>]*>/gi, '')
  const base = android ? '' : '<base href="about:srcdoc" target="_self">'
  const headInject = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}; base-uri ${android ? "'none'" : 'about:'}">${base}<meta name="viewport" content="width=device-width, initial-scale=1">`
  if (/<head\b[^>]*>/i.test(stripped)) {
    return stripped.replace(/<head\b[^>]*>/i, (m) => `${m}${headInject}`)
  }
  if (/^\s*<!doctype\b[^>]*>/i.test(stripped)) {
    return stripped.replace(/^\s*<!doctype\b[^>]*>/i, (m) => `${m}${headInject}`)
  }
  return `<!doctype html>${headInject}${stripped}`
}

export function HtmlPreview({ source, title }: { source: string; title: string }) {
  const [error, setError] = useState('')
  const android = Capacitor.getPlatform() === 'android'
  const html = buildPreviewHtml(source, android)
  if (android) {
    return <div className="m-auto p-4 text-center">
      <button className="rounded-lg bg-primary-action text-on-primary-action px-4 py-2" onClick={() => {
        setError('')
        void nativePreview.open({ html, title }).catch(() => setError('未能打开网页预览，请检查安卓客户端是否为最新版。'))
      }}>打开交互网页</button>
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
    </div>
  }
  return <iframe title={title} sandbox="allow-scripts" referrerPolicy="no-referrer"
    className="block min-h-0 w-full flex-1 border-0 bg-white" srcDoc={html} />
}

export function HtmlDocumentPage({ doc }: { doc: Doc }) {
  const navigate = useNavigate()
  const [source, setSource] = useState<string>()
  const [error, setError] = useState('')
  useDocumentPrintTitle(doc.title)
  useEffect(() => {
    let active = true
    async function load() {
      const blob = await getDocBlob(doc.hash)
      if (!blob) throw new Error('找不到文件本体，请重新导入这份 HTML。')
      const text = await readDocumentText(blob)
      if (active) {
        await touchDoc(doc.id)
        if (active) setSource(text)
      }
    }
    void load().catch((e: Error) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [doc.hash, doc.id])
  return <section className="flex h-full min-h-0 flex-col bg-surface pt-[env(safe-area-inset-top)]">
    <header className="flex shrink-0 items-center gap-2 border-b border-outline px-3 py-2">
      <button type="button" aria-label="返回文档库" onClick={() => navigate('/docs')} className="chrome-button grid size-10 place-items-center rounded-lg"><ArrowLeft size={18} /></button>
      <h1 className="truncate font-semibold">{doc.title}</h1>
    </header>
    {error ? <p role="alert" className="p-4 text-danger">{error}</p> :
      source === undefined ? <p role="status" className="p-4">正在读取网页…</p> : <HtmlPreview title={doc.title} source={source} />}
  </section>
}
