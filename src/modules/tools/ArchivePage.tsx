import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router'
import { ArrowLeft, ClipboardPaste, Download, Home, RotateCw, Trash2 } from 'lucide-react'
import { IconToolNovel } from '@/shared/icons'
import { Button } from '@/shared/ui/Button'
import { importDoc } from '@/db/docs'
import { isNative, isTauri } from '@/lib/native'
import { useUi } from '@/stores/ui'
import {
  controlDesktopArchive, downloadArchiveLink, listArchiveDownloads, openAndroidArchive, readArchiveDownload,
  removeArchiveDownload, type ArchiveBook, type ArchiveDownloads,
} from '@/lib/archiveBrowser'

function errorText(error: unknown, fallback: string): string {
  if (typeof error === 'string') return error
  return error instanceof Error ? error.message : fallback
}

function transferText({ downloading, progress, items }: ArchiveDownloads): string {
  if (progress) {
    if (progress.received === 0) return '正在连接下载服务器…'
    const size = `${(progress.received / 1048576).toFixed(1)} MB`
    return progress.total ? `正在下载 ${Math.floor(progress.received / progress.total * 100)}%` : `已下载 ${size}`
  }
  if (downloading) return '正在下载电子书…'
  return items.length ? '电子书已下载，可以导入阅读' : ''
}

function DesktopArchiveBrowser({ close, downloads, onError, onStart }: {
  close: () => void
  downloads: ArchiveDownloads
  onError: (message: string) => void
  onStart: () => void
}) {
  const pane = useRef<HTMLDivElement>(null)
  const [showLink, setShowLink] = useState(false)
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState('')
  const [browserError, setBrowserError] = useState('')
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    const node = pane.current
    if (!node) return
    let active = true
    let pendingResize = false
    let frame = 0
    const resize = () => {
      if (!active || pendingResize) return
      pendingResize = true
      frame = requestAnimationFrame(() => {
        void controlDesktopArchive('resize', node.getBoundingClientRect()).catch(() => {})
          .finally(() => { pendingResize = false })
      })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(node)
    void controlDesktopArchive('show', node.getBoundingClientRect()).catch((error) => {
      if (!active) return
      onError(errorText(error, '无法打开内嵌浏览器'))
      close()
    })
    return () => {
      active = false
      observer.disconnect()
      cancelAnimationFrame(frame)
      void controlDesktopArchive('hide').catch(() => {})
    }
  }, [close, onError])

  const action = (command: 'back' | 'home' | 'reload') => {
    setBrowserError('')
    if (command === 'back' && showLink) {
      setShowLink(false)
      return
    }
    void controlDesktopArchive(command).then((result) => {
      if (result === 'exit') close()
    }).catch((error) => setBrowserError(errorText(error, '浏览器操作失败')))
  }

  async function startLinkDownload() {
    setLinkError('')
    setStarting(true)
    try {
      await downloadArchiveLink(link)
      onStart()
      setShowLink(false)
    } catch (error) {
      setLinkError(errorText(error, '无法开始下载'))
    } finally {
      setStarting(false)
    }
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="安娜的档案浏览器"
      className="fixed inset-0 z-[100] flex flex-col bg-surface">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-1 border-b border-outline px-2 sm:px-4">
        <Button size="icon" title="返回上一页，首页返回工具" aria-label="返回" onClick={() => action('back')}><ArrowLeft size={18} /></Button>
        <Button size="icon" title="首页" aria-label="首页" onClick={() => action('home')}><Home size={17} /></Button>
        <Button size="icon" title="刷新" aria-label="刷新" onClick={() => action('reload')}><RotateCw size={17} /></Button>
        <span className="hidden font-semibold sm:inline">安娜的档案</span>
        <Button variant="outline" size="sm" className="ml-auto shrink-0" aria-expanded={showLink}
          onClick={() => { setLinkError(''); setShowLink((open) => !open) }}>
          <ClipboardPaste size={16} /> 粘贴链接下载
        </Button>
        <Button variant="outline" size="sm" className="shrink-0" onClick={close}>
          <Download size={16} /> 下载列表{downloads.items.length > 0 ? ` (${downloads.items.length})` : ''}
        </Button>
      </header>
      {showLink && (
        <form className="shrink-0 border-b border-outline px-3 py-2 sm:px-4" onSubmit={(event) => {
          event.preventDefault()
          void startLinkDownload()
        }}>
          <label htmlFor="archive-download-link" className="text-xs text-on-surface-2">
            网页显示「已复制」后，在这里按 Ctrl+V，再点「开始下载」。
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input id="archive-download-link" type="text" inputMode="url" autoFocus autoComplete="off" spellCheck={false}
              aria-label="电子书下载地址" value={link} onChange={(event) => setLink(event.target.value)}
              placeholder="粘贴 EPUB 或 PDF 下载地址" className="h-9 min-w-0 flex-1 rounded-[10px] border border-outline bg-surface px-3 text-sm" />
            <Button type="submit" size="sm" variant="primary" className="shrink-0" disabled={!link.trim() || downloads.downloading}
              state={starting ? 'loading' : 'idle'}>开始下载</Button>
          </div>
          {linkError && <p role="alert" className="mt-1.5 text-xs text-danger">{linkError}</p>}
        </form>
      )}
      {browserError || downloads.error ? (
        <p role="alert" className="shrink-0 border-b border-outline px-4 py-2 text-xs text-danger">{browserError || downloads.error}</p>
      ) : transferText(downloads) && (
        <p role="status" className="shrink-0 border-b border-outline px-4 py-2 text-xs text-on-surface-2">{transferText(downloads)}</p>
      )}
      <div ref={pane} className="flex min-h-0 flex-1 items-center justify-center text-sm text-on-surface-2">正在打开网页…</div>
    </div>, document.body,
  )
}

export function ArchivePage() {
  const navigate = useNavigate()
  const toast = useUi((state) => state.toast)
  const desktop = isTauri()
  const supported = desktop || isNative()
  const [desktopOpen, setDesktopOpen] = useState(false)
  const [androidOpen, setAndroidOpen] = useState(false)
  const [downloads, setDownloads] = useState<ArchiveDownloads>({ items: [], downloading: false })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string>()
  const [revision, setRevision] = useState(0)
  const closeDesktop = useRef(() => setDesktopOpen(false)).current
  const startDesktopDownload = () => {
    setError('')
    setDownloads((current) => ({ ...current, downloading: true, progress: { received: 0, total: null }, error: null }))
    setRevision((value) => value + 1)
  }

  useEffect(() => {
    if (!supported) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const snapshot = await listArchiveDownloads()
        if (active) setDownloads(snapshot)
      } catch (error) {
        if (active) setError(errorText(error, '无法读取下载列表'))
      } finally {
        if (active) timer = setTimeout(refresh, 1200)
      }
    }
    void refresh()
    return () => { active = false; clearTimeout(timer) }
  }, [supported, revision])

  async function openBrowser() {
    setError('')
    if (desktop) { setDesktopOpen(true); return }
    setAndroidOpen(true)
    try { await openAndroidArchive() }
    catch (error) { setError(errorText(error, '无法打开内嵌浏览器')) }
    finally { setAndroidOpen(false); setRevision((value) => value + 1) }
  }

  async function useDownload(book: ArchiveBook, remove = false) {
    setBusy(book.id)
    setError('')
    try {
      if (remove) {
        await removeArchiveDownload(book.id)
        setDownloads((current) => ({ ...current, items: current.items.filter(({ id }) => id !== book.id) }))
        return
      }
      const { doc } = await importDoc(await readArchiveDownload(book))
      try { await removeArchiveDownload(book.id) }
      catch { toast('已导入文档，下载列表中的副本仍可手动移除') }
      navigate(`/docs/${doc.id}`)
    } catch (error) {
      setError(errorText(error, remove ? '移除失败，请重试' : '导入失败，请重试'))
    } finally {
      setBusy(undefined)
      setRevision((value) => value + 1)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-24 pt-4 md:px-8 md:pb-14">
      <Link to="/tools" className="flex w-fit items-center gap-2 text-sm text-on-surface-2 hover:text-on-surface">
        <ArrowLeft size={15} /> 工具
      </Link>
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-primary-soft text-primary">
          <IconToolNovel size={22} />
        </span>
        <div>
          <h1 className="text-xl font-bold">安娜的档案</h1>
          <p className="mt-0.5 text-sm text-on-surface-2">在应用内找书，下载 EPUB 或 PDF 后导入阅读。</p>
        </div>
      </header>
      {supported ? (
        <>
          <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-on-surface-2">{desktop
              ? '网页只提供复制地址时，请使用浏览器顶部的「粘贴链接下载」。'
              : '在网页上选好版本，完成免费通道的等待后点击下载。'}</p>
            <Button variant="primary" state={androidOpen ? 'loading' : 'idle'} onClick={() => void openBrowser()}>
              打开站点
            </Button>
          </div>
          <section className="card p-4" aria-labelledby="archive-downloads-title">
            <h2 id="archive-downloads-title" className="text-sm font-semibold">下载列表</h2>
            {(error || downloads.error) && <p role="alert" className="mt-2 text-sm text-danger">{error || downloads.error}</p>}
            {downloads.downloading && <p role="status" className="mt-2 text-sm text-on-surface-2">{transferText(downloads)}</p>}
            {downloads.items.length === 0 && !downloads.downloading && (
              <p className="mt-2 text-sm text-on-surface-2">下载完成的电子书会显示在这里。</p>
            )}
            {downloads.items.length > 0 && (
              <ul className="mt-2 divide-y divide-outline">
                {downloads.items.map((book) => (
                  <li key={book.id} className="flex flex-wrap items-center gap-2 py-2">
                    <p className="min-w-[120px] flex-1 break-words text-sm">{book.name}</p>
                    <Button size="sm" variant="outline" state={busy === book.id ? 'loading' : 'idle'}
                      disabled={busy != null} onClick={() => void useDownload(book)}>导入并阅读</Button>
                    <Button size="icon" aria-label={`移除 ${book.name}`} title="移除下载文件" disabled={busy != null}
                      onClick={() => void useDownload(book, true)}><Trash2 size={16} /></Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : <p className="card p-4 text-sm text-on-surface-2">请在 Windows 或安卓的 Kairos 应用里使用此工具。</p>}
      {desktopOpen && <DesktopArchiveBrowser close={closeDesktop} downloads={downloads} onError={setError} onStart={startDesktopDownload} />}
    </div>
  )
}
