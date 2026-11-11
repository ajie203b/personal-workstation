import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useState, type RefObject, type MutableRefObject } from 'react'
import { sanitizeHtml } from '@/lib/sanitizeHtml'
import { localFileKind, type LocalDocument } from '@/lib/localMarkdown'
import { mdContentHash } from '@/db/docs'
import { parseFlowDoc, type FlowDoc } from './flowDoc'
import { FlowReader } from './FlowReader'
import { DEFAULT_SETTINGS } from './reader/useReadingPosition'
import { MarkdownWordCount } from './MarkdownWordCount'
import { restoreLocalPosition, type LocalScrollPosition } from './localScrollPosition'

const noop = () => {}
const PdfReader = lazy(() => import('./PdfReader').then(module => ({ default: module.PdfReader })))

export function LocalFilePreview({ doc, scrollRef, onLink, position }: {
  doc: LocalDocument
  scrollRef: RefObject<HTMLDivElement>
  onLink: (href: string) => void
  position?: LocalScrollPosition
}) {
  const kind = localFileKind(doc.path)
  const blob = useMemo(() => doc.base64 === undefined ? undefined : new Blob([Uint8Array.from(atob(doc.base64), c => c.charCodeAt(0))], { type: kind === 'pdf' ? 'application/pdf' : undefined }), [doc.base64, kind])
  const hash = mdContentHash('local-position', doc.path)
  const [flow, setFlow] = useState<FlowDoc>()
  const [error, setError] = useState('')
  const html = useMemo(() => kind === 'html' ? sanitizeHtml(doc.markdown) : '', [kind, doc.markdown])
  useEffect(() => {
    if (!blob || (kind !== 'docx' && kind !== 'pptx' && kind !== 'epub')) return
    let disposed = false
    let parsed: FlowDoc | undefined
    void parseFlowDoc(kind, blob).then(value => {
      if (disposed) value.dispose?.()
      else { parsed = value; setFlow(value) }
    }).catch(() => { if (!disposed) setError('无法预览此文件，请用其他应用打开。') })
    return () => { disposed = true; parsed?.dispose?.() }
  }, [blob, kind])
  useLayoutEffect(() => {
    if (!flow || !position) return
    const frame = requestAnimationFrame(() => { if (scrollRef.current) restoreLocalPosition(scrollRef.current, position) })
    return () => cancelAnimationFrame(frame)
  }, [flow, position, scrollRef])

  if (error) return <p role="alert" className="p-6 text-danger">{error}</p>
  if (kind === 'pdf') return <Suspense fallback={<p role="status" className="p-6 text-on-surface-2">正在打开 PDF…</p>}>
    <PdfReader hash={hash} localBlob={blob} localScrollProgress={position?.progress} settings={DEFAULT_SETTINGS} annotations={[]} jump={null} onSelection={noop} onProgress={noop} onRestored={noop} onLoaded={noop} scrollRef={scrollRef} initialTarget={null} />
  </Suspense>
  if (kind === 'docx' || kind === 'pptx' || kind === 'epub') {
    return flow ? <FlowReader hash={hash} flow={flow} settings={DEFAULT_SETTINGS} annotations={[]} jump={null} onSelection={noop} onProgress={noop} onRestored={noop} onLoaded={noop} scrollRef={scrollRef} initialTarget={null} /> : <p role="status" className="p-6 text-on-surface-2">正在生成预览…</p>
  }
  return <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto p-6">
    {kind === 'html' ? <div className="md-body" onClick={e => {
      const link = (e.target as HTMLElement).closest('a[href]')
      if (link) { e.preventDefault(); onLink(link.getAttribute('href') ?? '') }
    }} dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="whitespace-pre-wrap break-words text-sm leading-7">{doc.markdown}</pre>}
  </div>
}

export function LocalTextEditor({ text, onChange, scrollRef, position }: {
  text: string
  onChange: (text: string) => void
  scrollRef: MutableRefObject<HTMLElement | null>
  position?: LocalScrollPosition
}) {
  useLayoutEffect(() => {
    if (position && scrollRef.current) restoreLocalPosition(scrollRef.current, position)
  }, [position, scrollRef])
  return <>
    <textarea ref={el => { scrollRef.current = el }} aria-label="编辑文件原文" value={text} onChange={e => onChange(e.target.value)}
      className="flex-1 min-h-0 resize-none bg-surface p-6 font-mono text-sm leading-7 outline-none" spellCheck={false} />
    <MarkdownWordCount markdown={text} />
  </>
}
