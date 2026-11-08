import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, ArrowUp, Check, FileText, Folder, FolderOpen, ListTree, PanelLeftClose, PanelLeftOpen, PenLine, RefreshCw, Settings2 } from 'lucide-react'
import { isTauri } from '@/lib/native'
import { fileName, parentPath, localLink, localMarkdown, type LocalDocument, type LocalFolder } from '@/lib/localMarkdown'
import { openExternal } from '@/lib/links'
import { cn } from '@/lib/cn'
import { useUi } from '@/stores/ui'
import { useThemeEffect } from '@/shared/theme'
import { LocalReadingPane } from './LocalReadingPane'
import { parseMdBlocks } from './MdReader'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import type { JumpTarget } from './reader/useReadingPosition'

const iconButton = 'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-on-surface-2 hover:bg-surface-3 focus-visible:outline-primary'
const slug = (text: string) => text.trim().toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/^-|-$/g, '')

function LocalImage({ src, alt, file, refresh }: { src?: string; alt?: string; file: string; refresh: number }) {
  const relative = useMemo(() => src ? localLink(file, src) : null, [file, src])
  const [image, setImage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setImage(''); setError('')
    if (relative) void localMarkdown.image(relative.path).then(value => { if (alive) setImage(value) }).catch(() => { if (alive) setError('本地图片无法读取') })
    return () => { alive = false }
  }, [relative, refresh])
  const url = relative ? image : src && /^(https?:|data:image\/)/i.test(src) ? src : ''
  if (!url) return <span className="text-sm text-on-surface-2">{error || alt || '加载图片…'}</span>
  return <img src={url} alt={alt ?? ''} loading="lazy" className="max-w-full rounded-md" />
}

/** Reads and edits original files in place; annotations and tasks still link into the document library. */
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
  const headings = useMemo(() => doc ? parseMdBlocks(doc.markdown).headings : [], [doc?.markdown])
  const [jump, setJump] = useState<JumpTarget | null>(null)
  const refresh = useAsyncButton()
  const refreshLock = useRef(false)
  const [picking, setPicking] = useState(false)
  const [imageRefresh, setImageRefresh] = useState(0)
  const [settings, setSettings] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const current = useRef<LocalDocument | null>(null)
  const pendingAnchor = useRef('')
  const toast = useUi(s => s.toast)

  // 编辑直接写回原文件：草稿与最后落盘版本分开存，外部改动靠版本号冲突保护
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saveState, setSaveState] = useState<'saved' | 'unsaved' | 'saving' | 'error'>('saved')
  const [conflict, setConflict] = useState(false)
  const editingRef = useRef(false)
  const draftRef = useRef('')
  const saveChain = useRef(Promise.resolve(true))
  const saveStateRef = useRef<'saved' | 'unsaved' | 'saving' | 'error'>('saved')
  const updateSaveState = useCallback((value: 'saved' | 'unsaved' | 'saving' | 'error') => { saveStateRef.current = value; setSaveState(value) }, [])

  const saveDraft = useCallback((force = false, target?: LocalDocument): Promise<boolean> => {
    const run = saveChain.current.then(async () => {
      // target：切换文件的瞬间 current 会被清空，调用方先把旧文档捕获进来
      const cur = target ?? current.current
      if (!cur) return false
      const text = draftRef.current
      if (text === cur.markdown) { updateSaveState('saved'); return true }
      updateSaveState('saving')
      try {
        const next = await localMarkdown.write(cur.path, text, force ? undefined : cur.version)
        if (current.current?.path === next.path) { current.current = next; setDoc(next) }
        setConflict(false)
        updateSaveState(draftRef.current === text ? 'saved' : 'unsaved')
        return true
      } catch (e) {
        const message = String(e)
        updateSaveState('error')
        if (message.includes('文件已被外部修改')) {
          setConflict(true)
          if (!editingRef.current) toast('上一份文件的草稿未保存：' + message)
        } else toast('保存失败：' + message)
        return false
      }
    })
    saveChain.current = run.catch(() => false)
    return run
  }, [toast, updateSaveState])

  const startEditing = () => {
    if (!doc) return
    draftRef.current = doc.markdown
    setDraft(doc.markdown)
    updateSaveState('saved')
    setConflict(false)
    editingRef.current = true
    setEditing(true)
  }
  const finishEditing = async () => {
    if (await saveDraft()) { editingRef.current = false; setEditing(false) }
  }
  const reloadExternal = async () => {
    const cur = current.current
    if (!cur) return
    try {
      const next = await localMarkdown.read(cur.path)
      if (!next) return
      current.current = next
      setDoc(next)
      draftRef.current = next.markdown
      setDraft(next.markdown)
      updateSaveState('saved')
      setConflict(false)
      setError('')
    } catch (e) { setError(String(e)) }
  }

  useEffect(() => {
    if (!editing || conflict || saveState !== 'unsaved') return
    const timer = window.setTimeout(() => void saveDraft(), 1000)
    return () => window.clearTimeout(timer)
  }, [editing, conflict, saveState, draft, saveDraft])

  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void saveDraft() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, saveDraft])

  useEffect(() => {
    if (!editing || saveState === 'saved') return
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [editing, saveState])

  // 点 X / Alt+F4 退出：先把草稿写回原文件再关窗；保存失败（如外部冲突）则留在窗口里处理
  useEffect(() => {
    if (!isTauri()) return
    let alive = true
    let closing = false
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/window').then(async m => {
      const win = m.getCurrentWindow()
      const stop = await win.onCloseRequested(event => {
        if (!alive || closing) return
        const cur = current.current
        if (!editingRef.current || !cur || (saveStateRef.current === 'saved' && draftRef.current === cur.markdown)) return
        event.preventDefault()
        closing = true
        void saveDraft(false, cur).then(ok => {
          if (ok) void win.destroy()
          else { closing = false; toast('修改尚未保存，已留在窗口中：处理后会自动保存，再关闭即可') }
        })
      })
      if (!alive) stop()
      else unlisten = stop
    }).catch(() => undefined)
    return () => { alive = false; unlisten?.() }
  }, [saveDraft, toast])

  const goFile = useCallback(async (path: string, hash = '') => {
    if (path === file) return
    if (editingRef.current && !(await saveDraft())) return
    pendingAnchor.current = hash
    setJump(null)
    editingRef.current = false
    setEditing(false)
    setParams({ file: path })
  }, [setParams, file, saveDraft])
  const browse = useCallback(async (path: string) => {
    try { setFolder(await localMarkdown.list(path)); setError('') }
    catch (e) { setError(String(e)) }
  }, [])
  const pick = async (directory: boolean) => {
    if (picking) return
    setPicking(true)
    try {
      const path = await localMarkdown.pick(directory)
      if (path) { setError(''); if (directory) { setParams({ folder: path }); setDoc(null); current.current = null; await browse(path) } else void goFile(path) }
    } catch (e) { setError(String(e)); toast('打开失败：' + String(e)) }
    finally { setPicking(false) }
  }

  useEffect(() => {
    if (!isTauri()) return
    // 资源管理器又递进来一个新文件：先落盘正在编辑的草稿，再切换
    if (editingRef.current) void saveDraft(false, current.current ?? undefined)
    editingRef.current = false
    setEditing(false)
    setConflict(false)
    updateSaveState('saved')
    if (!file) {
      setDoc(null); current.current = null; setLoading(false)
      if (initialFolder) void browse(initialFolder)
      return
    }
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
  }, [file, initialFolder, browse, saveDraft, updateSaveState])

  // Compare metadata in native code; unchanged files return without loading their contents.
  useEffect(() => {
    if (!file || !isTauri()) return
    let alive = true, checking = false
    const check = async () => {
      if (checking || editingRef.current || document.visibilityState === 'hidden' || !current.current || current.current.path !== file) return
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

  useEffect(() => {
    if (!pendingAnchor.current || !doc || loading) return
    const heading = headings.find(h => slug(h.text) === pendingAnchor.current)
    if (heading) setJump({ anchor: 'b' + heading.blockIdx, ts: Date.now() })
    pendingAnchor.current = ''
  }, [doc, loading, headings])

  const refreshDocument = async () => {
    if (refreshLock.current) return
    if (editingRef.current && !(await saveDraft())) return
    refreshLock.current = true
    await refresh.run(async () => {
      try {
        const [next, nextFolder] = await Promise.all([
          file ? localMarkdown.read(file) : Promise.resolve(null),
          folder ? localMarkdown.list(folder.directory) : Promise.resolve(null),
        ])
        const changed = next && next.version !== current.current?.version
        if (next && changed) { current.current = next; setDoc(next) }
        if (next && editingRef.current) {
          current.current = next
          draftRef.current = next.markdown
          setDraft(next.markdown)
          updateSaveState('saved')
          setConflict(false)
        }
        if (nextFolder) setFolder(nextFolder)
        setImageRefresh(v => v + 1)
        setError('')
        toast(changed ? '文档已更新' : '已刷新，当前内容是最新的')
      } catch (e) { setError(String(e)); toast('刷新失败，请重试'); throw e }
    })
    refreshLock.current = false
  }
  const leavePage = async () => {
    if (editingRef.current && !(await saveDraft())) return
    navigate('/docs')
  }

  useEffect(() => {
    if (!isTauri()) return
    const name = doc ? `${fileName(doc.path)} — Kairos` : '本地 Markdown — Kairos'
    void import('@tauri-apps/api/window').then(m => m.getCurrentWindow().setTitle(name)).catch(() => undefined)
    return () => { void import('@tauri-apps/api/window').then(m => m.getCurrentWindow().setTitle('Kairos')).catch(() => undefined) }
  }, [doc?.path])

  const openLink = useCallback((href: string) => {
    if (href.startsWith('#')) {
      let id: string
      try { id = decodeURIComponent(href.slice(1)) } catch { return }
      const target = headings.find(h => 'b' + h.blockIdx === id || slug(h.text) === id)
      if (target) setJump({ anchor: 'b' + target.blockIdx, ts: Date.now() })
      return
    }
    if (/^(https?:|mailto:|tel:)/i.test(href)) { openExternal(href); return }
    const link = localLink(file, href)
    if (link && /\.(md|markdown)$/i.test(link.path)) void goFile(link.path, link.hash)
    else toast('请选择同文件夹中的 Markdown 链接')
  }, [headings, file, goFile, toast])
  const renderImage = useCallback((src: string | undefined, alt: string | undefined) => <LocalImage file={file} src={src} alt={alt} refresh={imageRefresh} />, [file, imageRefresh])

  if (!isTauri()) return <div className="p-8 text-on-surface"><h1 className="text-xl font-semibold">本地 Markdown</h1><p className="mt-3 text-on-surface-2">请在 Windows 桌面版中打开本地文件夹。</p><button className="mt-5 text-primary" onClick={() => navigate('/docs')}>返回文档工作站</button></div>
  return <div className="local-markdown h-full min-h-0 flex flex-col bg-surface text-on-surface">
    <header className="h-12 shrink-0 flex items-center gap-1 border-b border-outline/70 px-2">
      <button className={iconButton} title="返回文档工作站" aria-label="返回文档工作站" onClick={() => void leavePage()}><ArrowLeft size={17} /></button>
      <button className={iconButton} title={sideOpen ? '收起侧栏' : '展开侧栏'} aria-label={sideOpen ? '收起侧栏' : '展开侧栏'} onClick={() => setSideOpen(v => !v)}>{sideOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button>
      <span className="ml-1 flex-1 min-w-0 truncate text-[13px] text-on-surface-2" title={file || folder?.directory}>
        {file ? fileName(file) : '本地 Markdown'}
        {editing && <span className={cn('ml-2', saveState === 'error' ? 'text-danger' : saveState === 'saved' ? 'text-on-surface-2' : 'text-primary')}>{saveState === 'saving' ? '保存中…' : saveState === 'unsaved' ? '未保存' : saveState === 'error' ? '保存失败' : '已保存到原文件'}</span>}
      </span>
      {!file && <>
        <Button size="sm" disabled={picking} aria-label="打开本地 Markdown 文件" onClick={() => void pick(false)}><FileText size={16} /><span className="hidden sm:inline">打开文件</span></Button>
        <Button size="sm" disabled={picking} aria-label="打开本地文件夹" onClick={() => void pick(true)}><FolderOpen size={16} /><span className="hidden sm:inline">打开文件夹</span></Button>
      </>}
      <Button size="icon" state={refresh.state} disabled={!file && !folder} title="刷新文档和文件夹" aria-label="刷新文档" onClick={() => void refreshDocument()}><RefreshCw size={16} /></Button>
      <button className={cn(iconButton, settings && 'bg-surface-3', editing && 'opacity-40 pointer-events-none')} title="阅读设置" aria-label="阅读设置" aria-controls="reader-settings" aria-expanded={settings} onClick={() => setSettings(v => !v)}><Settings2 size={17} /></button>
    </header>
    <div className="flex-1 min-h-0 flex relative">
      {sideOpen && <aside className="w-64 max-w-[82vw] shrink-0 flex flex-col border-r border-outline/70 bg-surface absolute inset-y-0 left-0 z-10 shadow-lg md:static md:shadow-none" aria-label="文档导航">
        <div className="grid grid-cols-2 border-b border-outline/70 px-3" role="tablist" aria-label="侧栏内容">
          {(['files', 'outline'] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={cn('flex items-center justify-center gap-2 py-3 text-[13px] border-b-2', tab === value ? 'border-primary text-primary' : 'border-transparent text-on-surface-2')}>{value === 'files' ? <><Folder size={14} />文件</> : <><ListTree size={14} />目录</>}</button>)}
        </div>
        <div className="flex-1 overflow-y-auto py-2" role="tabpanel">
          {tab === 'files' ? <>
            <p className="truncate px-4 py-2 text-xs text-on-surface-2" title={folder?.directory}>{folder ? fileName(folder.directory) : '尚未打开文件夹'}</p>
            {folder?.parent && <button className="flex w-full items-center gap-2 px-4 py-2 text-[13px] hover:bg-surface-2" onClick={() => void browse(folder.parent!)}><ArrowUp size={14} />上一级</button>}
            {folder?.entries.map(entry => <button key={entry.path} aria-current={entry.path === doc?.path ? 'page' : undefined} className={cn('flex w-full min-w-0 items-center gap-2 border-l-2 px-4 py-2 text-left text-[13px] hover:bg-surface-2', entry.path === doc?.path ? 'border-primary text-primary bg-primary-soft' : 'border-transparent')} onClick={() => entry.directory ? void browse(entry.path) : void goFile(entry.path)}>
              {entry.directory ? <Folder size={14} className="shrink-0 text-on-surface-2" /> : <FileText size={14} className="shrink-0 text-on-surface-2" />}<span className="truncate">{entry.name}</span>
            </button>)}
            {folder && !folder.entries.length && <p className="px-4 py-3 text-xs text-on-surface-2">此目录没有 Markdown 文件</p>}
          </> : headings.length ? headings.map(heading => <button key={heading.blockIdx} className="block w-full truncate py-2 pr-3 text-left text-[13px] text-on-surface-2 hover:bg-surface-2 hover:text-on-surface" style={{ paddingLeft: 16 + (heading.level - 1) * 12 }} onClick={() => { setJump({ anchor: 'b' + heading.blockIdx, ts: Date.now() }); if (window.innerWidth < 768) setSideOpen(false) }}>{heading.text}</button>) : <p className="px-4 py-3 text-xs text-on-surface-2">文章没有标题目录</p>}
        </div>
        <button className="shrink-0 border-t border-outline px-4 py-3 text-left text-xs text-on-surface-2 hover:text-primary" onClick={() => void localMarkdown.defaults().catch(e => toast(String(e)))}>默认应用设置</button>
      </aside>}
      <div ref={scroll} className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
        {error && !conflict && <div role="alert" className="mx-6 mt-4 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
        {conflict && editing && <div role="alert" className="mx-6 mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">
          <span className="flex-1 min-w-40">文件已被其他程序修改，自动保存已暂停。</span>
          <button className="rounded-lg border border-outline px-3 py-1.5 text-[12px] text-on-surface hover:bg-surface-2" onClick={() => void reloadExternal()}>重新加载外部版本</button>
          <button className="rounded-lg bg-primary-action px-3 py-1.5 text-[12px] text-on-primary-action" onClick={() => void saveDraft(true)}>覆盖保存我的修改</button>
        </div>}
        {loading ? <p role="status" className="px-8 py-12 text-sm text-on-surface-2">正在读取文件…</p> : editing && doc ? <textarea
          value={draft}
          onChange={e => { draftRef.current = e.target.value; setDraft(e.target.value); updateSaveState('unsaved') }}
          className="flex-1 min-h-0 w-full resize-none bg-surface px-6 md:px-12 py-8 font-mono text-[13.5px] leading-7 text-on-surface outline-none"
          spellCheck={false}
          autoFocus
          aria-label="编辑 Markdown 原文"
        /> : doc ? <LocalReadingPane key={doc.path} document={doc} onLink={openLink} renderImage={renderImage} jump={jump} settingsOpen={settings} onCloseSettings={() => setSettings(false)} /> : <div className="max-w-lg mx-auto px-8 py-24"><h1 className="text-2xl font-semibold">本地 Markdown</h1><p className="mt-3 text-sm leading-6 text-on-surface-2">打开一篇文章，或从文件夹开始。文件列表、标题目录和正文都在这里。</p><div className="flex gap-3 mt-6"><button className="rounded-lg bg-primary-action text-on-primary-action px-4 py-2 text-sm" onClick={() => void pick(false)}>打开文件</button><button className="rounded-lg border border-outline px-4 py-2 text-sm" onClick={() => void pick(true)}>打开文件夹</button></div></div>}
      </div>
      {doc && !loading && (editing
        ? <button className="absolute bottom-6 right-6 z-20 grid h-12 w-12 place-items-center rounded-full bg-primary-action text-on-primary-action shadow-lg hover:opacity-90" title="完成编辑（Ctrl+S 立即保存）" aria-label="完成编辑" onClick={() => void finishEditing()}><Check size={20} /></button>
        : <button className="absolute bottom-6 right-6 z-20 grid h-12 w-12 place-items-center rounded-full bg-primary-action text-on-primary-action shadow-lg hover:opacity-90" title="编辑原文件，修改直接写回磁盘" aria-label="编辑文档" onClick={startEditing}><PenLine size={20} /></button>)}
    </div>
  </div>
}
