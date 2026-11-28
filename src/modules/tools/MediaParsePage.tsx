import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  Archive,
  Clapperboard,
  ClipboardPaste,
  Download,
  History,
  Image as ImageIcon,
  Layers,
  Loader2,
  Music,
  Search,
  Trash2,
  Video,
  X,
} from 'lucide-react'
import { IconToolDownload } from '@/shared/icons'
import { ToolIconTile } from '@/shared/ui/ToolIconTile'
import { BackButton } from '@/shared/ui/BackButton'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { TopProgressLine } from '@/shared/ui/TopProgressLine'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import { isNative } from '@/lib/native'
import {
  buildCoverAsset,
  downloadAsset,
  downloadImagesAsZip,
  formatMediaError,
  parseShareText,
  WEB_CORS_HINT,
  type MediaPlatform,
  type ParsedAsset,
  type ParsedMedia,
  type ParseShareOptions,
} from '@/lib/mediaParse'
import { isSaveCancelled, openSavedAction } from '@/lib/saveFile'

const PLATFORM_LABEL: Record<string, string> = { douyin: '抖音', bilibili: 'B站' }
const HISTORY_KEY = 'kairos:media-history-v1'
const MAX_HISTORY = 8

interface MediaHistoryEntry {
  id: string
  input: string
  platform: MediaPlatform
  title: string
  author: string
  cover?: string
  parsedAt: number
}

function loadHistory(): MediaHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : []
  } catch {
    return []
  }
}

function saveHistory(items: MediaHistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)))
  } catch {
    /* ignore quota errors */
  }
}

function CoverThumb({ src, className }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  if (!src || failed) {
    return (
      <span
        className={cn('grid place-items-center bg-surface-2 text-on-surface-2 shrink-0', className)}
        aria-hidden
      >
        <ImageIcon size={18} />
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn('object-cover shrink-0 bg-surface-2', className)}
      loading="lazy"
    />
  )
}

function assetIcon(kind: ParsedAsset['kind']) {
  if (kind === 'video') return <Video size={15} />
  if (kind === 'audio') return <Music size={15} />
  return <ImageIcon size={15} />
}

/**
 * 无水印下载：粘贴抖音 / B站分享文案、BV/av 号或作品 ID，解析出无水印视频、图集与音频。
 */
export function MediaParsePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const toast = useUi((s) => s.toast)
  const [text, setText] = useState('')
  const [lastInput, setLastInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [parseError, setParseError] = useState('')
  const [downloading, setDownloading] = useState('')
  const [dlProgress, setDlProgress] = useState<{
    label: string
    loaded: number
    total: number
    index?: number
    count?: number
  } | null>(null)
  const [zipState, setZipState] = useState<{ done: number; total: number } | null>(null)
  const zipProgress = zipState ? `${zipState.done}/${zipState.total}` : ''
  const [media, setMedia] = useState<ParsedMedia | null>(null)
  const [previewImg, setPreviewImg] = useState<string | null>(null)
  const [history, setHistory] = useState<MediaHistoryEntry[]>(() => loadHistory())
  const abortRef = useRef<AbortController | null>(null)
  const lastAutoQueryRef = useRef('')

  const saveLocationText = isNative() ? '「下载/个人工作站」' : '所选保存位置或下载目录'

  useEffect(() => () => { abortRef.current?.abort() }, [])

  // ?q= 或 ?url= 预填并自动解析（从分享收件箱或深链直达）
  const incomingParam = (searchParams.get('q') ?? searchParams.get('url') ?? '').trim()
  useEffect(() => {
    if (!incomingParam || lastAutoQueryRef.current === incomingParam) return
    lastAutoQueryRef.current = incomingParam
    setText(incomingParam)
    void runParse(incomingParam)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingParam])

  useEffect(() => {
    if (!previewImg) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreviewImg(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewImg])

  const recordHistory = (input: string, result: ParsedMedia) => {
    setHistory((prev) => {
      const next: MediaHistoryEntry[] = [
        {
          id: `${result.platform}:${result.title}:${Date.now()}`,
          input,
          platform: result.platform,
          title: result.title,
          author: result.author,
          cover: result.cover,
          parsedAt: Date.now(),
        },
        ...prev.filter((item) => item.input !== input),
      ].slice(0, MAX_HISTORY)
      saveHistory(next)
      return next
    })
  }

  const runParse = async (rawInput: string, opts?: Omit<ParseShareOptions, 'signal'>) => {
    if (busy) return
    const input = rawInput.trim()
    if (!input) {
      toast('先粘贴分享链接、BV/av 号或作品 ID')
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy(true)
    setParseError('')
    if (!opts) setMedia(null)
    try {
      const result = await parseShareText(input, { ...opts, signal: ctrl.signal })
      if (!result.assets.length) {
        toast('解析出了标题，但没找到可下载的视频、图片或音频')
      }
      setMedia(result)
      setLastInput(input)
      recordHistory(input, result)
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        toast('已取消解析')
      } else {
        const msg = formatMediaError(e, '解析失败')
        setParseError(msg)
        toast(msg)
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null
      setBusy(false)
    }
  }

  const cancelParse = () => {
    abortRef.current?.abort()
  }

  const pasteFromClipboard = async () => {
    try {
      const clip = await navigator.clipboard?.readText()
      if (!clip?.trim()) {
        toast('剪贴板为空')
        return
      }
      setText(clip)
      setParseError('')
    } catch {
      toast('无法自动读取剪贴板，请长按或 Ctrl+V 粘贴')
    }
  }

  const clearInput = () => {
    abortRef.current?.abort()
    setText('')
    setLastInput('')
    setMedia(null)
    setParseError('')
  }

  const doDownload = async (asset: ParsedAsset) => {
    if (downloading || zipState) return
    setDownloading(asset.filename)
    setDlProgress({ label: asset.label, loaded: 0, total: 0 })
    try {
      const where = await downloadAsset(asset, undefined, (loaded, total) => {
        setDlProgress({ label: asset.label, loaded, total })
      })
      toast(`已保存 ${asset.label} → ${where}`, openSavedAction())
    } catch (e) {
      if (!isSaveCancelled(e)) toast(`下载${asset.label}失败：${formatMediaError(e, '网络错误')}`)
    } finally {
      setDownloading('')
      setDlProgress(null)
    }
  }

  const doDownloadAll = async () => {
    if (!media || downloading || zipState) return
    const totalCount = media.assets.length
    for (let i = 0; i < totalCount; i++) {
      const asset = media.assets[i]
      setDownloading(asset.filename)
      setDlProgress({ label: asset.label, loaded: 0, total: 0, index: i + 1, count: totalCount })
      try {
        const where = await downloadAsset(asset, undefined, (loaded, total) => {
          setDlProgress({ label: asset.label, loaded, total, index: i + 1, count: totalCount })
        })
        toast(`已保存 ${asset.label} → ${where}`, openSavedAction())
      } catch (e) {
        if (isSaveCancelled(e)) break
        toast(`下载${asset.label}失败：${formatMediaError(e, '网络错误')}`)
      }
    }
    setDownloading('')
    setDlProgress(null)
  }

  const doDownloadZip = async () => {
    if (!media || downloading || zipState) return
    const total = media.assets.filter((a) => a.kind === 'image').length
    setZipState({ done: 0, total })
    try {
      const where = await downloadImagesAsZip(media, (done, sum) => setZipState({ done, total: sum }))
      toast(`已保存图集 ZIP → ${where}`, openSavedAction())
    } catch (e) {
      if (!isSaveCancelled(e)) toast(`打包图集失败：${formatMediaError(e, '网络错误')}`)
    } finally {
      setZipState(null)
    }
  }

  const coverAsset = useMemo(() => (media ? buildCoverAsset(media) : null), [media])
  const imageAssets = useMemo(() => (media ? media.assets.filter((a) => a.kind === 'image') : []), [media])
  const displayAssets = useMemo(
    () => (media ? (coverAsset ? [...media.assets, coverAsset] : media.assets) : []),
    [media, coverAsset],
  )

  const downloadRatio: number | null = zipState
    ? (zipState.total > 0 ? zipState.done / zipState.total : null)
    : dlProgress
      ? dlProgress.count && dlProgress.count > 1
        ? dlProgress.total > 0
          ? ((dlProgress.index! - 1) + Math.min(1, dlProgress.loaded / dlProgress.total)) / dlProgress.count
          : (dlProgress.index ?? 1) > 1
            ? (dlProgress.index! - 1) / dlProgress.count
            : null
        : dlProgress.total > 0
          ? dlProgress.loaded / dlProgress.total
          : null
      : null

  const downloadCaption = zipState
    ? `正在打包图集 ${zipState.done}/${zipState.total}…`
    : dlProgress
      ? (() => {
          const prefix = dlProgress.count && dlProgress.count > 1
            ? `正在下载（${dlProgress.index}/${dlProgress.count}）${dlProgress.label}`
            : `正在下载 ${dlProgress.label}`
          if (dlProgress.total > 0) {
            const pct = Math.min(100, Math.round((dlProgress.loaded / dlProgress.total) * 100))
            return `${prefix} · ${pct}%（${formatBytes(dlProgress.loaded)} / ${formatBytes(dlProgress.total)}）`
          }
          return dlProgress.loaded > 0 ? `${prefix} · 已下载 ${formatBytes(dlProgress.loaded)}` : `${prefix}…`
        })()
      : ''

  return (
    <div className="mx-auto w-full max-w-3xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <BackButton text="工具" label="返回工具" onClick={() => navigate('/tools')} className="hidden md:inline-flex -mt-1 w-fit" />

      <header className="flex items-start gap-3.5">
        <ToolIconTile icon={IconToolDownload} />
        <div className="min-w-0">
          <h1 className="hidden md:block text-[24px] font-bold tracking-[-0.02em] leading-7">无水印下载</h1>
          <p className="text-[12.5px] text-on-surface-2 mt-0.5 leading-relaxed">
            抖音 / B站分享链接一键解析，视频、图集与音频保存到{saveLocationText}
          </p>
        </div>
      </header>

      <section className="card relative overflow-hidden p-4 flex flex-col gap-3">
        <TopProgressLine active={busy} label="正在解析媒体链接" />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          aria-label="分享文案、链接或作品 ID"
          placeholder={'粘贴分享文案、链接或作品 ID\n例如：https://v.douyin.com/xxxxx/\nBV1xx411c7mD / av170001'}
          className="w-full rounded-[12px] border border-outline bg-surface-2 px-3 py-2.5 text-[13.5px] leading-relaxed outline-none focus:border-primary/60 resize-y min-h-[96px]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" state={busy ? 'loading' : 'idle'} onClick={() => void runParse(text)} className="h-9 px-4 shrink-0">
            <Search size={15} /> 解析
          </Button>
          {busy && (
            <Button variant="outline" size="sm" onClick={cancelParse} className="h-9 shrink-0">
              取消
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void pasteFromClipboard()} disabled={busy} className="h-9 shrink-0">
            <ClipboardPaste size={14} /> 一键粘贴
          </Button>
          {(text || media || parseError) && (
            <Button variant="ghost" size="sm" onClick={clearInput} className="h-9 shrink-0">
              <X size={14} /> 清空
            </Button>
          )}
          <p className="text-[11.5px] text-on-surface-2 leading-relaxed sm:ml-auto">
            支持整段文案、短链（b23.tv / bili2233.cn）、BV / av 号及纯数字 ID
          </p>
        </div>

        {parseError && (
          <div className="rounded-[10px] border border-danger/25 bg-danger/5 px-3 py-2.5 text-[12.5px] text-danger leading-relaxed" role="alert">
            <p>{parseError}</p>
            {parseError === WEB_CORS_HINT && (
              <p className="mt-1 text-[11.5px] text-on-surface-2">
                提示：本地代理示例命令或客户端下载地址可在 Kairos 仓库查看；Windows 桌面端与安卓客户端可直接解析与落盘。
              </p>
            )}
          </div>
        )}
      </section>

      {media ? (
        <section className="card relative overflow-hidden p-4 flex flex-col gap-3">
          <TopProgressLine
            active={Boolean(dlProgress || zipState)}
            progress={downloadRatio}
            label={downloadCaption || '媒体下载进度'}
          />
          {downloadCaption && (
            <p role="status" className="text-[11.5px] text-primary tabular-nums leading-relaxed">
              {downloadCaption}
            </p>
          )}
          <div className="flex items-start gap-3">
            <CoverThumb src={media.cover} className="w-16 h-16 rounded-[10px]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10.5px] px-1.5 py-0.5 rounded-full bg-primary-soft text-primary font-medium shrink-0">
                  {PLATFORM_LABEL[media.platform] ?? media.platform}
                </span>
                <span className="text-[11px] text-on-surface-2 truncate">{media.author || '未知作者'}</span>
              </div>
              <p className="text-[14px] font-medium leading-6 mt-1 line-clamp-2 break-words">{media.title}</p>
              {media.note && <p className="text-[11px] text-on-surface-2 mt-1 leading-relaxed">{media.note}</p>}
            </div>
          </div>

          {media.platform === 'bilibili' && (
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-outline/60">
              {media.pages && media.pages.length > 1 && (
                <>
                  <label className="inline-flex items-center gap-1.5 text-[12px] text-on-surface-2 min-w-0 max-w-full">
                    <span className="shrink-0">分 P：</span>
                    <select
                      aria-label="选择 B站分 P"
                      value={media.currentPage ?? 1}
                      disabled={busy}
                      onChange={(e) => void runParse(lastInput || text, { page: Number(e.target.value) })}
                      className="h-8 max-w-[210px] rounded-[8px] border border-outline bg-surface-2 px-2 text-[12px] text-on-surface outline-none focus:border-primary/60 truncate"
                    >
                      {media.pages.map((p) => (
                        <option key={p.cid} value={p.page}>
                          P{p.page} · {p.part}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void runParse(lastInput || text, { allPages: true })}
                    className="h-8 shrink-0"
                  >
                    <Layers size={13} /> 拉取全部 {media.pages.length} P
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void runParse(lastInput || text, { page: media.currentPage ?? 1, audioOnly: true })}
                className="h-8 shrink-0"
              >
                <Music size={13} /> 提取纯音频 (.m4a)
              </Button>
            </div>
          )}

          {imageAssets.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-1">
              {imageAssets.map((img) => (
                <button
                  key={img.url}
                  type="button"
                  onClick={() => setPreviewImg(img.url)}
                  aria-label={`预览 ${img.label}`}
                  className="group relative aspect-square rounded-[10px] overflow-hidden bg-surface-2 border border-outline cursor-pointer"
                >
                  <CoverThumb src={img.url} className="w-full h-full group-hover:scale-[1.03] transition-transform" />
                  <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-[5px] bg-black/60 text-white text-[10px] leading-none">
                    {img.label}
                  </span>
                </button>
              ))}
            </div>
          )}

          <ul className="flex flex-col divide-y divide-outline">
            {displayAssets.map((a) => (
              <li key={`${a.label}:${a.url}`} className="flex items-center gap-2.5 py-2">
                <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-surface-2 text-on-surface-2 shrink-0">
                  {assetIcon(a.kind)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-5 truncate">{a.label}</p>
                  <p className="text-[11px] text-on-surface-2 truncate">{a.filename}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void doDownload(a)}
                  disabled={Boolean(downloading) || Boolean(zipProgress)}
                  className={cn('h-8 px-3 text-[12.5px] shrink-0', downloading === a.filename && 'opacity-70')}
                >
                  {downloading === a.filename ? <Loader2 size={13} className="animate-spin" /> : '下载'}
                </Button>
              </li>
            ))}
          </ul>

          {(media.assets.length > 1 || imageAssets.length > 1) && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {media.assets.length > 1 && (
                <Button
                  variant="primary"
                  onClick={() => void doDownloadAll()}
                  disabled={Boolean(downloading) || Boolean(zipProgress)}
                  className="h-9 flex-1 min-w-[160px] justify-center shrink-0"
                >
                  {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                  全部下载（{media.assets.length} 项）
                </Button>
              )}
              {imageAssets.length > 1 && (
                <Button
                  variant="outline"
                  onClick={() => void doDownloadZip()}
                  disabled={Boolean(downloading) || Boolean(zipProgress)}
                  className="h-9 shrink-0"
                >
                  {zipProgress ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />}
                  {zipProgress ? `打包中 ${zipProgress}` : `打包下载 ZIP（${imageAssets.length} 张）`}
                </Button>
              )}
            </div>
          )}
        </section>
      ) : (
        !busy && (
          <EmptyState icon={Clapperboard} title="还没有解析结果" hint="粘贴抖音或 B站的分享链接、BV/av 号或作品 ID，点「解析」试试。" />
        )
      )}

      {history.length > 0 && (
        <section className="card p-4 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="inline-flex items-center gap-1.5 text-[13px] font-semibold">
              <History size={14} className="text-on-surface-2" /> 最近解析
            </h2>
            <button
              type="button"
              onClick={() => {
                setHistory([])
                saveHistory([])
              }}
              className="inline-flex items-center gap-1 text-[11.5px] text-on-surface-2 hover:text-danger transition-colors cursor-pointer"
            >
              <Trash2 size={12} /> 清空记录
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {history.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={busy}
                onClick={() => {
                  setText(item.input)
                  void runParse(item.input)
                }}
                className="flex items-center gap-2.5 p-2 rounded-[10px] border border-outline/80 bg-surface-2/60 hover:bg-surface-3 text-left transition-colors cursor-pointer min-w-0"
              >
                <CoverThumb src={item.cover} className="w-10 h-10 rounded-[7px]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-primary-soft text-primary font-medium shrink-0">
                      {PLATFORM_LABEL[item.platform] ?? item.platform}
                    </span>
                    <span className="text-[12.5px] font-medium truncate">{item.title}</span>
                  </div>
                  <p className="text-[11px] text-on-surface-2 truncate mt-0.5">{item.author || item.input}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <p className="text-[11px] text-on-surface-2 leading-relaxed px-1">
        仅用于个人离线收藏，请支持原作者、不要传播下载内容。抖音走移动端公开接口（常见 720P 档），B站未登录上限 720P；
        平台接口变动可能导致解析失败，届时会明确报错。
      </p>

      {previewImg && (
        <div
          className="fixed inset-0 z-50 bg-black/80 grid place-items-center p-4 cursor-zoom-out"
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          onClick={() => setPreviewImg(null)}
        >
          <button
            type="button"
            aria-label="关闭"
            onClick={() => setPreviewImg(null)}
            className="absolute top-4 right-4 grid place-items-center w-9 h-9 rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors cursor-pointer"
          >
            <X size={18} aria-hidden />
          </button>
          <img
            src={previewImg}
            alt="图集大图预览"
            referrerPolicy="no-referrer"
            className="max-w-full max-h-[88dvh] rounded-[10px] shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
