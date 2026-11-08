import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, ArrowUp, FileText, Folder, FolderOpen, ListTree, PanelLeftClose, PanelLeftOpen, RefreshCw, Settings2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { isTauri } from '@/lib/native'
import { fileName, parentPath, localLink, localMarkdown, type LocalDocument, type LocalFolder } from '@/lib/localMarkdown'
import { openExternal, transformDocUrl } from '@/lib/links'
import { cn } from '@/lib/cn'
import { useUi } from '@/stores/ui'
import { useThemeEffect } from '@/shared/theme'
import { normalizeMarkdown } from './markdownContent'
import { markdownSchema, rehypeReaderStyles } from './markdownPlugins'

const iconButton = 'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-on-surface-2 hover:bg-surface-3 focus-visible:outline-primary'
const slug = (text: string) => text.trim().toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/^-|-$/g, '')

function LocalImage({ src, alt, file }: { src?: string; alt?: string; file: string }) {
  const relative = useMemo(() => src ? localLink(file, src) : null, [file, src])
  const [image, setImage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setImage(''); setError('')
    if (relative) void localMarkdown.image(relative.path).then(value => { if (alive) setImage(value) }).catch(() => { if (alive) setError('本地图片无法读取') })
    return () => { alive = false }
  }, [relative])
  const url = relative ? image : src && /^(https?:|data:image\/)/i.test(src) ? src : ''
  if (!url) return <span className="text-sm text-on-surface-2">{error || alt || '加载图片…'}</span>
  return <img src={url} alt={alt ?? ''} loading="lazy" className="max-w-full rounded-md" />
}

/** Reads the original file; local folders and their contents never enter the synced document library. */
export function LocalMarkdownPage() {
  useThemeEffect()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const file = params.get('file') ?? ''
  const initialFolder = params.get('folder') ?? ''
  const [folder, setFolder] = useState<LocalFolder | null>(null)
  const [doc, setDoc] = useState<LocalDocument | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sideOpen, setSideOpen] = useState(true)
  const [tab, setTab] = useState<'files' | 'outline'>('files')
  const [headings, setHeadings] = useState<{ id: string; text: string; level: number }[]>([])
  const [fontSize, setFontSize] = useState(17)
  const [settings, setSettings] = useState(false)
  const body = useRef<HTMLElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const current = useRef<LocalDocument | null>(null)
  const pendingAnchor = useRef('')
  const toast = useUi(s => s.toast)
  const goFile = useCallback((path: string, hash = '') => {
    pendingAnchor.current = hash
    setParams({ file: path })
  }, [setParams])
  const browse = useCallback(async (path: string) => {
    try { setFolder(await localMarkdown.list(path)); setError('') }
    catch (e) { setError(String(e)) }
  }, [])
  const pick = async (directory: boolean) => {
    try {
      const path = await localMarkdown.pick(directory)
      if (path) { setError(''); if (directory) { setParams({ folder: path }); setDoc(null); current.current = null; await browse(path) } else goFile(path) }
    } catch (e) { setError(String(e)) }
  }

  useEffect(() => {
    if (!isTauri()) return
    if (!file) { if (initialFolder) void browse(initialFolder); return }
    let alive = true
    setLoading(true); setError(''); setDoc(null); current.current = null
    void Promise.all([localMarkdown.read(file), localMarkdown.list(parentPath(file))]).then(([next, list]) => {
      if (!alive) return
      if (next) {
        current.current = next; setDoc(next)
        if (next.path !== file) setParams({ file: next.path }, { replace: true })
      }
      setFolder(list)
      scroll.current?.scrollTo({ top: 0 })
    }).catch(e => { if (alive) setError(String(e)) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [file, initialFolder, browse])

  // Compare metadata in native code; unchanged files return without loading their contents.
  useEffect(() => {
    if (!file || !isTauri()) return
    let alive = true, checking = false
    const check = async () => {
      if (checking || document.visibilityState === 'hidden' || !current.current || current.current.path !== file) return
      checking = true
      try {
        const next = await localMarkdown.read(file, current.current.version)
        if (alive && next) { current.current = next; setDoc(next); setError('') }
      } catch (e) { if (alive) setError(String(e)) }
      finally { checking = false }
    }
    const timer = window.setInterval(() => void check(), 3000)
    const focus = () => { void check(); void browse(parentPath(file)) }
    window.addEventListener('focus', focus)
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [file, browse])

  useLayoutEffect(() => {
    const elements = Array.from(body.current?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6') ?? [])
    const list = elements.map((el, i) => {
      el.id = `local-heading-${i}`
      return { id: el.id, text: el.textContent ?? '', level: Number(el.tagName.slice(1)) }
    })
    setHeadings(list)
    if (pendingAnchor.current) {
      const anchor = pendingAnchor.current
      const target = elements.find(el => slug(el.textContent ?? '') === anchor || el.id === anchor)
      target?.scrollIntoView({ block: 'start' })
      pendingAnchor.current = ''
    }
  }, [doc, loading])

  useEffect(() => {
    if (!isTauri()) return
    const name = doc ? `${fileName(doc.path)} — Kairos` : '本地 Markdown — Kairos'
    void import('@tauri-apps/api/window').then(m => m.getCurrentWindow().setTitle(name)).catch(() => undefined)
    return () => { void import('@tauri-apps/api/window').then(m => m.getCurrentWindow().setTitle('Kairos')).catch(() => undefined) }
  }, [doc?.path])

  const openLink = (href: string) => {
    if (href.startsWith('#')) {
      let id: string
      try { id = decodeURIComponent(href.slice(1)) } catch { return }
      const target = headings.find(h => h.id === id || slug(h.text) === id)
      if (target) body.current?.querySelector<HTMLElement>(`#${target.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    if (/^(https?:|mailto:|tel:)/i.test(href)) { openExternal(href); return }
    const link = localLink(file, href)
    if (link && /\.(md|markdown)$/i.test(link.path)) goFile(link.path, link.hash)
    else toast('请选择同文件夹中的 Markdown 链接')
  }

  if (!isTauri()) return <div className="p-8 text-on-surface"><h1 className="text-xl font-semibold">本地 Markdown</h1><p className="mt-3 text-on-surface-2">请在 Windows 桌面版中打开本地文件夹。</p><button className="mt-5 text-primary" onClick={() => navigate('/docs')}>返回文档工作站</button></div>
  return <div className="local-markdown h-full min-h-0 flex flex-col bg-surface text-on-surface">
    <header className="h-12 shrink-0 flex items-center gap-1 border-b border-outline/70 px-2">
      <button className={iconButton} title="返回文档工作站" aria-label="返回文档工作站" onClick={() => navigate('/docs')}><ArrowLeft size={17} /></button>
      <button className={iconButton} title={sideOpen ? '收起侧栏' : '展开侧栏'} aria-label={sideOpen ? '收起侧栏' : '展开侧栏'} onClick={() => setSideOpen(v => !v)}>{sideOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button>
      <span className="ml-1 flex-1 min-w-0 truncate text-[13px] text-on-surface-2" title={file || folder?.directory}>{file ? fileName(file) : '本地 Markdown'}</span>
      <button className={iconButton} title="打开文件" aria-label="打开本地 Markdown 文件" onClick={() => void pick(false)}><FileText size={17} /></button>
      <button className={iconButton} title="打开文件夹" aria-label="打开本地文件夹" onClick={() => void pick(true)}><FolderOpen size={17} /></button>
      <button className={iconButton} title="刷新文件夹" aria-label="刷新文件夹" onClick={() => folder && void browse(folder.directory)}><RefreshCw size={16} /></button>
      <button className={cn(iconButton, settings && 'bg-surface-3')} title="阅读设置" aria-label="阅读设置" onClick={() => setSettings(v => !v)}><Settings2 size={17} /></button>
    </header>
    {settings && <div className="flex flex-wrap gap-4 items-center px-4 py-2 border-b border-outline text-sm bg-surface-2">
      <label className="flex items-center gap-2">字号<input aria-label="正文字号" type="range" min={14} max={24} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} />{fontSize}</label>
      <button className="text-primary" onClick={() => void localMarkdown.defaults().catch(e => toast(String(e)))}>默认应用设置</button>
      <span className="text-xs text-on-surface-2">搜索 .md 或 .markdown，选择 Kairos</span>
    </div>}
    <div className="flex-1 min-h-0 flex relative">
      {sideOpen && <aside className="w-64 max-w-[82vw] shrink-0 flex flex-col border-r border-outline/70 bg-surface absolute inset-y-0 left-0 z-10 shadow-lg md:static md:shadow-none" aria-label="文档导航">
        <div className="grid grid-cols-2 border-b border-outline/70 px-3" role="tablist" aria-label="侧栏内容">
          {(['files', 'outline'] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={cn('flex items-center justify-center gap-2 py-3 text-[13px] border-b-2', tab === value ? 'border-primary text-primary' : 'border-transparent text-on-surface-2')}>{value === 'files' ? <><Folder size={14} />文件</> : <><ListTree size={14} />目录</>}</button>)}
        </div>
        <div className="flex-1 overflow-y-auto py-2" role="tabpanel">
          {tab === 'files' ? <>
            <p className="truncate px-4 py-2 text-xs text-on-surface-2" title={folder?.directory}>{folder ? fileName(folder.directory) : '尚未打开文件夹'}</p>
            {folder?.parent && <button className="flex w-full items-center gap-2 px-4 py-2 text-[13px] hover:bg-surface-2" onClick={() => void browse(folder.parent!)}><ArrowUp size={14} />上一级</button>}
            {folder?.entries.map(entry => <button key={entry.path} aria-current={entry.path === doc?.path ? 'page' : undefined} className={cn('flex w-full min-w-0 items-center gap-2 border-l-2 px-4 py-2 text-left text-[13px] hover:bg-surface-2', entry.path === doc?.path ? 'border-primary text-primary bg-primary-soft' : 'border-transparent')} onClick={() => entry.directory ? void browse(entry.path) : goFile(entry.path)}>
              {entry.directory ? <Folder size={14} className="shrink-0 text-on-surface-2" /> : <FileText size={14} className="shrink-0 text-on-surface-2" />}<span className="truncate">{entry.name}</span>
            </button>)}
            {folder && !folder.entries.length && <p className="px-4 py-3 text-xs text-on-surface-2">此目录没有 Markdown 文件</p>}
          </> : headings.length ? headings.map(heading => <button key={heading.id} className="block w-full truncate py-2 pr-3 text-left text-[13px] text-on-surface-2 hover:bg-surface-2 hover:text-on-surface" style={{ paddingLeft: 16 + (heading.level - 1) * 12 }} onClick={() => { body.current?.querySelector<HTMLElement>(`#${heading.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); if (window.innerWidth < 768) setSideOpen(false) }}>{heading.text}</button>) : <p className="px-4 py-3 text-xs text-on-surface-2">文章没有标题目录</p>}
        </div>
      </aside>}
      <div ref={scroll} className="flex-1 min-w-0 overflow-y-auto overscroll-contain">
        {error && <div role="alert" className="mx-6 mt-4 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
        {loading ? <p role="status" className="px-8 py-12 text-sm text-on-surface-2">正在读取文件…</p> : doc ? <article ref={body} className="md-body local-markdown-body mx-auto px-6 md:px-10 py-9" style={{ fontSize }}>
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSchema], rehypeReaderStyles, [rehypeKatex, { trust: false, strict: false, maxSize: 20, maxExpand: 1000 }]]} urlTransform={transformDocUrl} components={{
            a: ({ href, children }) => <a href={href} onClick={e => { e.preventDefault(); if (href) openLink(href) }}>{children}</a>,
            img: ({ src, alt }) => <LocalImage file={file} src={src} alt={alt} />,
          }}>{normalizeMarkdown(doc.markdown)}</ReactMarkdown>
        </article> : <div className="max-w-lg mx-auto px-8 py-24"><h1 className="text-2xl font-semibold">本地 Markdown</h1><p className="mt-3 text-sm leading-6 text-on-surface-2">打开一篇文章，或从文件夹开始。文件列表、标题目录和正文都在这里。</p><div className="flex gap-3 mt-6"><button className="rounded-lg bg-primary-action text-on-primary-action px-4 py-2 text-sm" onClick={() => void pick(false)}>打开文件</button><button className="rounded-lg border border-outline px-4 py-2 text-sm" onClick={() => void pick(true)}>打开文件夹</button></div></div>}
      </div>
    </div>
  </div>
}
