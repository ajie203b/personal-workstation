import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import {
  ArrowLeft,
  ClipboardPaste,
  Download,
  ExternalLink,
  FileUp,
  Globe,
  Home,
  Info,
  RotateCw,
  Trash2,
} from 'lucide-react'
import { IconToolNovel } from '@/shared/icons'
import { Button } from '@/shared/ui/Button'
import { importDoc } from '@/db/docs'
import { openExternal } from '@/lib/links'
import { isNative, isTauri } from '@/lib/native'
import { BackButton } from '@/shared/ui/BackButton'
import { useUi } from '@/stores/ui'
import {
  controlDesktopArchive, downloadArchiveLink, listArchiveDownloads, openAndroidArchive, readArchiveDownload,
  removeArchiveDownload, type ArchiveBook, type ArchiveDownloads,
} from '@/lib/archiveBrowser'

const RELEASES_URL = 'https://github.com/ajie203b/personal-workstation/releases'

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
        <Button size="icon" title="返回上一页或工具" aria-label="返回" onClick={() => action('back')}><ArrowLeft size={18} /></Button>
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
            网页显示「已复制」或右键复制下载链接后，粘贴到下方并点击「开始下载」。
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const desktop = isTauri()
  const supported = desktop || isNative()
  const [desktopOpen, setDesktopOpen] = useState(false)
  const [androidOpen, setAndroidOpen] = useState(false)
  const [importingLocal, setImportingLocal] = useState(false)
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

  async function consumeDownload(book: ArchiveBook, remove = false) {
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

  async function handleLocalFiles(files: FileList | null) {
    if (!files?.length || importingLocal) return
    setImportingLocal(true)
    setError('')
    try {
      const list = Array.from(files)
      let lastDocId = ''
      let lastTitle = ''
      let dupCount = 0
      for (const file of list) {
        const res = await importDoc(file)
        lastDocId = res.doc.id
        lastTitle = res.doc.title
        if (res.duplicated) dupCount++
      }
      if (list.length === 1 && lastDocId) {
        toast(dupCount ? `文档已存在，直接打开：《${lastTitle}》` : `已导入文档：《${lastTitle}》`)
        navigate(`/docs/${lastDocId}`)
      } else {
        toast(`已处理 ${list.length} 个文件${dupCount ? `（含 ${dupCount} 个已存在文档）` : ''}`)
        navigate('/docs')
      }
    } catch (e) {
      setError(errorText(e, '导入电子书失败，请确认文件格式为 EPUB 或 PDF'))
    } finally {
      setImportingLocal(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-24 pt-4 md:px-8 md:pb-14">
      <BackButton text="工具" label="返回工具" onClick={() => navigate('/tools')} className="hidden md:inline-flex -mt-1 w-fit" />
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-primary-soft text-primary">
          <IconToolNovel size={22} />
        </span>
        <div>
          <h1 className="hidden md:block text-[22px] font-bold leading-7">安娜的档案</h1>
          <p className="mt-0.5 text-sm text-on-surface-2">在应用内找书，下载 EPUB 或 PDF 后直接导入文档库阅读。</p>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".epub,.pdf,application/epub+zip,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => void handleLocalFiles(e.target.files)}
      />

      {supported ? (
        <>
          <div className="card flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-on-surface-2 min-w-0 flex-1 leading-relaxed">
                {desktop
                  ? '在站内选好版本并等待免费通道倒计时；若页面只给出复制链接，可点击顶栏「粘贴链接下载」。'
                  : '在站内选好版本，完成免费通道倒计时后点击下载，应用会自动识别并入库。'}
              </p>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" state={importingLocal ? 'loading' : 'idle'} onClick={() => fileInputRef.current?.click()}>
                  <FileUp size={15} /> 导入本地 EPUB / PDF
                </Button>
                <Button variant="primary" state={androidOpen ? 'loading' : 'idle'} onClick={() => void openBrowser()}>
                  <Globe size={15} /> 打开站点
                </Button>
              </div>
            </div>
            <div className="rounded-[10px] bg-surface-2/80 border border-outline/70 px-3 py-2 text-xs text-on-surface-2 leading-relaxed flex items-start gap-2">
              <Info size={14} className="shrink-0 mt-0.5 text-primary" />
              <span>
                网络提示：主域名访问较慢或打不开时，可在站内切换镜像线路（常见后缀如 .org / .se / .li）；若下载页返回网页而非电子书，导入时会自动拦截并提示更换版本。
              </span>
            </div>
          </div>

          <section className="card p-4" aria-labelledby="archive-downloads-title">
            <h2 id="archive-downloads-title" className="text-sm font-semibold">下载列表</h2>
            {(error || downloads.error) && <p role="alert" className="mt-2 text-sm text-danger">{error || downloads.error}</p>}
            {downloads.downloading && <p role="status" className="mt-2 text-sm text-on-surface-2">{transferText(downloads)}</p>}
            {downloads.items.length === 0 && !downloads.downloading && (
              <p className="mt-2 text-sm text-on-surface-2">下载完成的电子书会显示在这里，点击即可自动校验格式并导入阅读。</p>
            )}
            {downloads.items.length > 0 && (
              <ul className="mt-2 divide-y divide-outline">
                {downloads.items.map((book) => (
                  <li key={book.id} className="flex flex-wrap items-center gap-2 py-2">
                    <p className="min-w-[120px] flex-1 break-words text-sm">{book.name}</p>
                    <Button size="sm" variant="outline" state={busy === book.id ? 'loading' : 'idle'}
                      disabled={busy != null} onClick={() => void consumeDownload(book)}>导入并阅读</Button>
                    <Button size="icon" aria-label={`移除 ${book.name}`} title="移除下载文件" disabled={busy != null}
                      onClick={() => void consumeDownload(book, true)}><Trash2 size={16} /></Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <section className="card p-5 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <span className="grid place-items-center w-9 h-9 rounded-[10px] bg-surface-2 text-on-surface-2 shrink-0">
              <Info size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold">内置找书浏览器仅在客户端提供</h2>
              <p className="mt-1.5 text-sm text-on-surface-2 leading-relaxed">
                网页版受浏览器的同源策略、内嵌框架限制（X-Frame-Options / CSP）以及跨域文件校验限制，无法在浏览器页内直接拉起站内下载器。
                请下载 Kairos Windows 桌面端或 Android 客户端使用完整内置浏览器；若你已自行下载好电子书文件，也可以直接导入本地文档库阅读。
              </p>
            </div>
          </div>

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="primary"
              state={importingLocal ? 'loading' : 'idle'}
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0"
            >
              <FileUp size={16} /> 导入本地 EPUB / PDF 到文档库
            </Button>
            <Button
              variant="outline"
              onClick={() => openExternal(RELEASES_URL)}
              className="shrink-0"
            >
              <ExternalLink size={15} /> 获取 Kairos 客户端
            </Button>
          </div>
        </section>
      )}
      {desktopOpen && <DesktopArchiveBrowser close={closeDesktop} downloads={downloads} onError={setError} onStart={startDesktopDownload} />}
    </div>
  )
}
