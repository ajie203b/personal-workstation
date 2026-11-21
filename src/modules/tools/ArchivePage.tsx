import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import {
  ArrowLeft,
  BookOpen,
  ClipboardPaste,
  Download,
  ExternalLink,
  FileUp,
  FolderDown,
  FolderOpen,
  Globe,
  Home,
  Info,
  RotateCw,
  Trash2,
} from 'lucide-react'
import { IconToolArchive } from '@/shared/icons'
import { ToolIconTile } from '@/shared/ui/ToolIconTile'
import { Button } from '@/shared/ui/Button'
import { importDoc } from '@/db/docs'
import { openExternal } from '@/lib/links'
import { isNative, isTauri } from '@/lib/native'
import { openSavedAction } from '@/lib/saveFile'
import { cn } from '@/lib/cn'
import { BackButton } from '@/shared/ui/BackButton'
import { useUi } from '@/stores/ui'
import {
  archiveFileExt, canImportArchiveBook, controlDesktopArchive, downloadArchiveLink,
  listArchiveDownloads, openAndroidArchive, openDesktopDownloadsDir, readArchiveDownload,
  removeArchiveDownload, saveArchiveDownloadToLocal, setDesktopArchiveTarget,
  type ArchiveBook, type ArchiveDownloads, type ArchiveDownloadTarget,
} from '@/lib/archiveBrowser'

const RELEASES_URL = 'https://github.com/ajie203b/personal-workstation/releases'
const TARGET_STORAGE_KEY = 'kairos:archive-download-target'

function loadSavedTarget(): ArchiveDownloadTarget {
  try {
    return localStorage.getItem(TARGET_STORAGE_KEY) === 'local' ? 'local' : 'app'
  } catch {
    return 'app'
  }
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function errorText(error: unknown, fallback: string): string {
  if (typeof error === 'string') return error
  return error instanceof Error ? error.message : fallback
}

function transferText({ downloading, progress, items, target }: ArchiveDownloads): string {
  const dest = target === 'local' ? '到本地下载目录' : '到 Kairos'
  if (progress) {
    if (progress.received === 0) return `正在连接下载服务器（下载${dest}）…`
    const size = `${(progress.received / 1048576).toFixed(1)} MB`
    return progress.total
      ? `正在下载${dest} ${Math.floor(progress.received / progress.total * 100)}%`
      : `已下载 ${size}（${dest}）`
  }
  if (downloading) return `正在下载文件${dest}…`
  return items.length ? '下载列表中有已保存的文件，可导入 Kairos 或另存到本地' : ''
}

function TargetSwitch({
  target,
  onChange,
  compact = false,
}: {
  target: ArchiveDownloadTarget
  onChange: (next: ArchiveDownloadTarget) => void
  compact?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label="选择下载位置"
      className={cn(
        'inline-flex items-center rounded-[10px] border border-outline bg-surface-2/80 p-0.5 shrink-0',
        compact ? 'text-[11.5px]' : 'text-xs',
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={target === 'app'}
        onClick={() => onChange('app')}
        className={cn(
          'inline-flex items-center gap-1 rounded-[8px] font-medium transition-colors cursor-pointer whitespace-nowrap',
          compact ? 'h-7 px-2' : 'h-8 px-2.5',
          target === 'app' ? 'bg-surface text-primary shadow-xs' : 'text-on-surface-2 hover:text-on-surface',
        )}
      >
        <BookOpen size={13} /> 下载到 Kairos
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={target === 'local'}
        onClick={() => onChange('local')}
        className={cn(
          'inline-flex items-center gap-1 rounded-[8px] font-medium transition-colors cursor-pointer whitespace-nowrap',
          compact ? 'h-7 px-2' : 'h-8 px-2.5',
          target === 'local' ? 'bg-surface text-primary shadow-xs' : 'text-on-surface-2 hover:text-on-surface',
        )}
      >
        <FolderDown size={13} /> 下载到本地
      </button>
    </div>
  )
}

function DesktopArchiveBrowser({ close, downloads, target, onTargetChange, onError, onStart }: {
  close: () => void
  downloads: ArchiveDownloads
  target: ArchiveDownloadTarget
  onTargetChange: (next: ArchiveDownloadTarget) => void
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
      await downloadArchiveLink(link, target)
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
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-1.5 border-b border-outline px-2 sm:px-4">
        <Button size="icon" title="返回上一页或工具" aria-label="返回" onClick={() => action('back')}><ArrowLeft size={18} /></Button>
        <Button size="icon" title="首页" aria-label="首页" onClick={() => action('home')}><Home size={17} /></Button>
        <Button size="icon" title="刷新" aria-label="刷新" onClick={() => action('reload')}><RotateCw size={17} /></Button>
        <span className="hidden font-semibold lg:inline">安娜的档案</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <TargetSwitch target={target} onChange={onTargetChange} compact />
          <Button variant="outline" size="sm" className="shrink-0" aria-expanded={showLink}
            onClick={() => { setLinkError(''); setShowLink((open) => !open) }}>
            <ClipboardPaste size={15} /> 粘贴链接
          </Button>
          <Button variant="outline" size="sm" className="shrink-0" onClick={close}>
            <Download size={15} /> 下载列表{downloads.items.length > 0 ? ` (${downloads.items.length})` : ''}
          </Button>
        </div>
      </header>
      {showLink && (
        <form className="shrink-0 border-b border-outline px-3 py-2 sm:px-4" onSubmit={(event) => {
          event.preventDefault()
          void startLinkDownload()
        }}>
          <label htmlFor="archive-download-link" className="text-xs text-on-surface-2">
            网页显示「已复制」或右键复制下载链接后，粘贴到下方并点击「开始下载」（当前将下载到：{target === 'local' ? '系统下载目录' : 'Kairos 软件内'}）。
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input id="archive-download-link" type="text" inputMode="url" autoFocus autoComplete="off" spellCheck={false}
              aria-label="电子书下载地址" value={link} onChange={(event) => setLink(event.target.value)}
              placeholder="粘贴电子书或文档直链（支持 EPUB / PDF / MOBI / AZW3 / TXT / ZIP 等）"
              className="h-9 min-w-0 flex-1 rounded-[10px] border border-outline bg-surface px-3 text-sm" />
            <Button type="submit" size="sm" variant="primary" className="shrink-0" disabled={!link.trim() || downloads.downloading}
              state={starting ? 'loading' : 'idle'}>开始下载</Button>
          </div>
          {linkError && <p role="alert" className="mt-1.5 text-xs text-danger">{linkError}</p>}
        </form>
      )}
      {browserError || downloads.error ? (
        <p role="alert" className="shrink-0 border-b border-outline px-4 py-2 text-xs text-danger">{browserError || downloads.error}</p>
      ) : downloads.lastSavedPath && !downloads.downloading ? (
        <div role="status" className="shrink-0 flex items-center justify-between gap-2 border-b border-outline bg-primary-soft/40 px-4 py-1.5 text-xs text-on-surface">
          <span className="min-w-0 truncate">已保存到本地：{downloads.lastSavedPath}</span>
          <button
            type="button"
            onClick={() => void openDesktopDownloadsDir().catch(() => {})}
            className="inline-flex items-center gap-1 shrink-0 text-primary hover:underline cursor-pointer"
          >
            <FolderOpen size={13} /> 打开下载目录
          </button>
        </div>
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
  const [target, setTarget] = useState<ArchiveDownloadTarget>(loadSavedTarget)
  const [downloads, setDownloads] = useState<ArchiveDownloads>({ items: [], downloading: false, target: loadSavedTarget() })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string>()
  const [revision, setRevision] = useState(0)
  const closeDesktop = useRef(() => setDesktopOpen(false)).current

  useEffect(() => {
    if (!desktop) return
    void setDesktopArchiveTarget(target).catch(() => {})
  }, [desktop, target])

  const handleTargetChange = (next: ArchiveDownloadTarget) => {
    setTarget(next)
    setDownloads((current) => ({ ...current, target: next }))
    try { localStorage.setItem(TARGET_STORAGE_KEY, next) } catch { /* ignore */ }
    if (desktop) {
      void setDesktopArchiveTarget(next).catch((err) => setError(errorText(err, '无法切换下载位置')))
    }
  }

  const startDesktopDownload = () => {
    setError('')
    setDownloads((current) => ({
      ...current,
      downloading: true,
      target,
      progress: { received: 0, total: null },
      error: null,
      lastSavedPath: target === 'local' ? null : current.lastSavedPath,
    }))
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

  async function importToKairos(book: ArchiveBook) {
    setBusy(`import:${book.id}`)
    setError('')
    try {
      const { doc } = await importDoc(await readArchiveDownload(book))
      try { await removeArchiveDownload(book.id) }
      catch { toast('已导入文档，下载列表中的副本仍可手动移除') }
      navigate(`/docs/${doc.id}`)
    } catch (error) {
      setError(errorText(error, '导入失败，请重试'))
    } finally {
      setBusy(undefined)
      setRevision((value) => value + 1)
    }
  }

  async function saveToLocal(book: ArchiveBook) {
    setBusy(`local:${book.id}`)
    setError('')
    try {
      const savedPath = await saveArchiveDownloadToLocal(book)
      if (!savedPath) return
      const action = openSavedAction()
      toast(`已保存到本地：${savedPath}`, action)
    } catch (error) {
      setError(errorText(error, '保存到本地失败，请重试'))
    } finally {
      setBusy(undefined)
      setRevision((value) => value + 1)
    }
  }

  async function removeDownload(book: ArchiveBook) {
    setBusy(`remove:${book.id}`)
    setError('')
    try {
      await removeArchiveDownload(book.id)
      setDownloads((current) => ({ ...current, items: current.items.filter(({ id }) => id !== book.id) }))
    } catch (error) {
      setError(errorText(error, '移除失败，请重试'))
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
      setError(errorText(e, '导入文件失败，请确认格式受 Kairos 支持（EPUB / PDF / TXT / MD / DOCX / PPTX）'))
    } finally {
      setImportingLocal(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const androidOpenAction = !desktop ? openSavedAction() : undefined

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-24 pt-4 md:px-8 md:pb-14">
      <BackButton text="工具" label="返回工具" onClick={() => navigate('/tools')} className="hidden md:inline-flex -mt-1 w-fit" />
      <header className="flex items-start gap-3.5">
        <ToolIconTile icon={IconToolArchive} />
        <div>
          <h1 className="hidden md:block text-[24px] font-bold tracking-[-0.02em] leading-7">安娜的档案</h1>
          <p className="mt-0.5 text-sm text-on-surface-2">
            支持各种电子书与文档格式（EPUB / PDF / MOBI / AZW3 / DJVU / FB2 / TXT / ZIP 等），可选择保存到本地或导入 Kairos 阅读。
          </p>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".epub,.pdf,.docx,.pptx,.txt,.md,.markdown,application/epub+zip,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => void handleLocalFiles(e.target.files)}
      />

      {supported ? (
        <>
          <div className="card flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 flex-[1_1_18rem] text-sm text-on-surface-2 leading-relaxed">
                {desktop
                  ? '可在下方或浏览器顶栏切换下载到「Kairos 软件内」或「本地下载目录」；若页面只给出复制链接，可点击顶栏「粘贴链接」。'
                  : '在站内点击下载后，可自由选择「保存到本地（下载/个人工作站）」或「下载到 Kairos」，支持各种格式。'}
              </p>
              <div className="flex max-w-full flex-wrap items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" state={importingLocal ? 'loading' : 'idle'} onClick={() => fileInputRef.current?.click()}>
                  <FileUp size={15} /> 导入本地文档
                </Button>
                <Button variant="primary" state={androidOpen ? 'loading' : 'idle'} onClick={() => void openBrowser()}>
                  <Globe size={15} /> 打开站点
                </Button>
              </div>
            </div>
            {desktop && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-outline/60">
                <span className="text-xs text-on-surface-2">默认下载位置：</span>
                <TargetSwitch target={target} onChange={handleTargetChange} />
              </div>
            )}
            <div className="rounded-[10px] bg-surface-2/80 border border-outline/70 px-3 py-2 text-xs text-on-surface-2 leading-relaxed flex items-start gap-2">
              <Info size={14} className="shrink-0 mt-0.5 text-primary" />
              <span>
                网络与格式提示：主域名访问较慢时可在站内切换镜像（如 .org / .se / .li）；EPUB / PDF / TXT / MD / DOCX / PPTX 可直接导入 Kairos 阅读，MOBI / AZW3 / DJVU / FB2 / ZIP 等所有格式均可保存到本地使用。
              </span>
            </div>
          </div>

          <section className="card p-4" aria-labelledby="archive-downloads-title">
            <div className="flex items-center justify-between gap-2">
              <h2 id="archive-downloads-title" className="text-sm font-semibold">下载列表</h2>
              {desktop && (
                <button
                  type="button"
                  onClick={() => void openDesktopDownloadsDir().catch(() => toast('无法打开系统下载目录'))}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer"
                >
                  <FolderOpen size={13} /> 打开系统下载目录
                </button>
              )}
            </div>
            {(error || downloads.error) && <p role="alert" className="mt-2 text-sm text-danger">{error || downloads.error}</p>}
            {downloads.downloading && <p role="status" className="mt-2 text-sm text-on-surface-2">{transferText(downloads)}</p>}
            {downloads.lastSavedPath && !downloads.downloading && (
              <div role="status" className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-primary-soft/50 px-3 py-2 text-xs text-on-surface">
                <span className="min-w-0 flex-1 break-all">最近已保存到本地：{downloads.lastSavedPath}</span>
                {desktop ? (
                  <button
                    type="button"
                    onClick={() => void openDesktopDownloadsDir().catch(() => toast('无法打开系统下载目录'))}
                    className="inline-flex items-center gap-1 shrink-0 font-medium text-primary hover:underline cursor-pointer"
                  >
                    <FolderOpen size={13} /> 打开目录
                  </button>
                ) : androidOpenAction && (
                  <button
                    type="button"
                    onClick={androidOpenAction.run}
                    className="inline-flex items-center gap-1 shrink-0 font-medium text-primary hover:underline cursor-pointer"
                  >
                    <FolderOpen size={13} /> {androidOpenAction.label}
                  </button>
                )}
              </div>
            )}
            {downloads.items.length === 0 && !downloads.downloading && (
              <p className="mt-2 text-sm text-on-surface-2">
                下载到软件内的文件会显示在这里，可随时导入 Kairos 文档库阅读，或另存到本地目录。
              </p>
            )}
            {downloads.items.length > 0 && (
              <ul className="mt-2 divide-y divide-outline">
                {downloads.items.map((book) => {
                  const ext = archiveFileExt(book.name)
                  const readable = canImportArchiveBook(book.name)
                  const sizeLabel = formatFileSize(book.size)
                  return (
                    <li key={book.id} className="flex flex-wrap items-center gap-2 py-2.5">
                      <div className="min-w-[140px] flex-1">
                        <p className="break-words text-sm">{book.name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-on-surface-2">
                          {ext && (
                            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono uppercase text-[10px] text-on-surface-2">
                              {ext}
                            </span>
                          )}
                          {sizeLabel && <span>{sizeLabel}</span>}
                          {!readable && <span>· 建议保存到本地用其他阅读器打开</span>}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {readable && (
                          <Button
                            size="sm"
                            variant="primary"
                            state={busy === `import:${book.id}` ? 'loading' : 'idle'}
                            disabled={busy != null}
                            onClick={() => void importToKairos(book)}
                          >
                            <BookOpen size={14} /> 导入 Kairos
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant={readable ? 'outline' : 'primary'}
                          state={busy === `local:${book.id}` ? 'loading' : 'idle'}
                          disabled={busy != null}
                          onClick={() => void saveToLocal(book)}
                        >
                          <FolderDown size={14} /> 保存到本地
                        </Button>
                        <Button
                          size="icon"
                          aria-label={`移除 ${book.name}`}
                          title="移除下载文件"
                          disabled={busy != null}
                          onClick={() => void removeDownload(book)}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </li>
                  )
                })}
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
              <FileUp size={16} /> 导入本地文档到文档库
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
      {desktopOpen && (
        <DesktopArchiveBrowser
          close={closeDesktop}
          downloads={downloads}
          target={target}
          onTargetChange={handleTargetChange}
          onError={setError}
          onStart={startDesktopDownload}
        />
      )}
    </div>
  )
}
