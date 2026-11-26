import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useState, type RefObject, type MutableRefObject } from 'react'
import type { DocKind } from '@/db/db'
import { sanitizeHtml } from '@/lib/sanitizeHtml'
import { HtmlPreview } from './HtmlPreview'
import { localFileKind, type LocalDocument } from '@/lib/localMarkdown'
import { mdContentHash } from '@/db/docs'
import { parseFlowDoc, type FlowDoc } from './flowDoc'
import { FlowReader } from './FlowReader'
import { DEFAULT_SETTINGS, useReadingPosition, type JumpTarget } from './reader/useReadingPosition'
import { ReaderSettingsPanel } from './reader/ReaderSettingsPanel'
import { MarkdownWordCount } from './MarkdownWordCount'
import { restoreLocalPosition, type LocalScrollPosition } from './localScrollPosition'

const noop = () => {}
const PdfReader = lazy(() => import('./PdfReader').then(module => ({ default: module.PdfReader })))

export function LocalFilePreview({ doc, scrollRef, onLink, position, jump = null, settingsOpen = false, onCloseSettings }: {
  doc: LocalDocument
  scrollRef: RefObject<HTMLDivElement>
  onLink: (href: string) => void
  position?: LocalScrollPosition
  jump?: JumpTarget | null
  settingsOpen?: boolean
  onCloseSettings?: () => void
}) {
  const kind = localFileKind(doc.path)
  const settingsKind: DocKind = kind === 'pdf' || kind === 'docx' || kind === 'pptx' || kind === 'epub' ? kind : 'txt'
  const blob = useMemo(() => doc.base64 === undefined ? undefined : new Blob([Uint8Array.from(atob(doc.base64), c => c.charCodeAt(0))], { type: kind === 'pdf' ? 'application/pdf' : undefined }), [doc.base64, kind])
  const hash = mdContentHash('local-position', doc.path)
  const reading = useReadingPosition({ docHash: hash, paramP: null, paramHl: undefined })
  const [flow, setFlow] = useState<FlowDoc>()
  const [error, setError] = useState('')
  const [interactive, setInteractive] = useState(false)
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

  const settingsModal = settingsOpen && onCloseSettings ? (
    <ReaderSettingsPanel
      doc={{ kind: settingsKind }}
      settings={reading.settings}
      updateSettings={reading.updateSettings}
      placement="center"
      onClose={onCloseSettings}
      onResetLayout={() => reading.updateSettings({ ...DEFAULT_SETTINGS, theme: reading.settings.theme })}
    />
  ) : null

  if (error) return <p role="alert" className="p-6 text-danger">{error}</p>
  if (kind === 'pdf') return <>
    <Suspense fallback={<p role="status" className="p-6 text-on-surface-2">正在打开 PDF…</p>}>
      <PdfReader
        hash={hash}
        localBlob={blob}
        localScrollProgress={position?.progress}
        settings={reading.settings}
        annotations={[]}
        jump={jump ?? reading.jump}
        onSelection={noop}
        onProgress={noop}
        onRestored={noop}
        onLoaded={noop}
        scrollRef={scrollRef}
        initialTarget={null}
        onZoom={(z) => reading.updateSettings({ zoom: z })}
      />
    </Suspense>
    {settingsModal}
  </>
  if (kind === 'docx' || kind === 'pptx' || kind === 'epub') {
    return <>
      {flow ? (
        <FlowReader
          hash={hash}
          flow={flow}
          settings={reading.settings}
          annotations={[]}
          jump={jump ?? reading.jump}
          onSelection={noop}
          onProgress={noop}
          onRestored={noop}
          onLoaded={noop}
          scrollRef={scrollRef}
          initialTarget={null}
          onFontSizeChange={(px) => reading.updateSettings({ fontSize: px })}
        />
      ) : (
        <p role="status" className="p-6 text-on-surface-2">正在生成预览…</p>
      )}
      {settingsModal}
    </>
  }
  return <>
    {kind === 'html' && <button type="button" aria-pressed={interactive}
      className="self-end mx-3 my-1 rounded-lg px-3 py-2 text-sm text-primary chrome-button"
      onClick={() => setInteractive(value => !value)}>{interactive ? '返回阅读模式' : '交互预览'}</button>}
    {kind === 'html' && interactive ? <HtmlPreview source={doc.markdown} title={doc.path.split(/[\\/]/).pop() || 'HTML'} /> :
    <div ref={scrollRef} className={`flex-1 min-h-0 overflow-auto theme-${reading.settings.theme}`}>
      <div
        className="reader-prose mx-auto py-8 min-w-0"
        style={{
          ['--reader-width' as string]: `${reading.settings.widthPct}%`,
          fontSize: reading.settings.fontSize,
          ['--md-leading' as string]: String(reading.settings.leading),
        }}
      >
        {kind === 'html' ? <div className="md-body" onClick={e => {
          const link = (e.target as HTMLElement).closest('a[href]')
          if (link) { e.preventDefault(); onLink(link.getAttribute('href') ?? '') }
        }} dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="whitespace-pre-wrap break-words font-sans" style={{ lineHeight: reading.settings.leading }}>{doc.markdown}</pre>}
      </div>
    </div>}
    {settingsModal}
  </>
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
