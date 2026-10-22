import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Clapperboard, Download, Loader2, Search } from 'lucide-react'
import { BackButton } from '@/shared/ui/BackButton'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { downloadAsset, parseShareText, type ParsedMedia } from '@/lib/mediaParse'

const PLATFORM_LABEL: Record<string, string> = { douyin: '抖音', bilibili: 'B站' }

/**
 * 无水印下载（v3.3）：粘贴抖音 / B站分享文案，解析出无水印视频（图集逐张），
 * 下载到「下载/个人工作站」。取流配方见 lib/mediaParse.ts 的注释。
 */
export function MediaParsePage() {
  const navigate = useNavigate()
  const toast = useUi((s) => s.toast)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState('')
  const [media, setMedia] = useState<ParsedMedia | null>(null)

  const doParse = async () => {
    if (busy) return
    const input = text.trim()
    if (!input) {
      toast('先粘贴分享链接或整段文案')
      return
    }
    setBusy(true)
    setMedia(null)
    try {
      const result = await parseShareText(input)
      if (!result.assets.length) {
        toast('解析出了标题，但没找到可下载的视频或图片')
      }
      setMedia(result)
    } catch (e) {
      toast(e instanceof Error ? e.message : '解析失败')
    } finally {
      setBusy(false)
    }
  }

  const doDownload = async (index: number | 'all') => {
    if (!media || downloading) return
    const picks = index === 'all' ? media.assets.map((_, i) => i) : [index]
    for (const i of picks) {
      const asset = media.assets[i]
      setDownloading(asset.filename)
      try {
        const where = await downloadAsset(asset)
        toast(`已保存 ${asset.label} → ${where}`)
      } catch (e) {
        toast(`下载${asset.label}失败：${e instanceof Error ? e.message : '网络错误'}`)
      }
    }
    setDownloading('')
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <BackButton text="工具" label="返回工具" onClick={() => navigate('/tools')} className="-mt-1 w-fit" />

      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-[12px] bg-primary-soft text-primary shrink-0">
          <Clapperboard size={21} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[20px] md:text-[22px] font-bold leading-7">无水印下载</h1>
          <p className="text-[12.5px] text-on-surface-2 mt-0.5 leading-relaxed">
            抖音 / B站分享链接一键解析，视频与图集下载到「下载/个人工作站」
          </p>
        </div>
      </header>

      <section className="card p-4 flex flex-col gap-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder={'粘贴分享文案或链接，例如：\n7.12 复制打开抖音 https://v.douyin.com/xxxxx/ 看看【TA的作品】\n或 https://www.bilibili.com/video/BVxxxx…'}
          className="w-full rounded-[12px] border border-outline bg-surface-2 px-3 py-2.5 text-[13.5px] leading-relaxed outline-none focus:border-primary/60 resize-y min-h-[96px]"
        />
        <div className="flex items-center gap-2">
          <Button onClick={() => void doParse()} disabled={busy} className="h-9 px-4">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} 解析
          </Button>
          <p className="text-[11.5px] text-on-surface-2 leading-relaxed">
            整段文案直接粘贴即可，会自动找出里面的链接
          </p>
        </div>
      </section>

      {media ? (
        <section className="card p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            {media.cover && (
              <img
                src={media.cover}
                alt=""
                className="w-16 h-16 rounded-[10px] object-cover shrink-0 bg-surface-2"
                loading="lazy"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[10.5px] px-1.5 py-0.5 rounded-full bg-primary-soft text-primary font-medium">
                  {PLATFORM_LABEL[media.platform] ?? media.platform}
                </span>
                <span className="text-[11px] text-on-surface-2 truncate">{media.author}</span>
              </div>
              <p className="text-[14px] font-medium leading-6 mt-1 line-clamp-2">{media.title}</p>
              {media.note && <p className="text-[11px] text-on-surface-2 mt-1">{media.note}</p>}
            </div>
          </div>

          <ul className="flex flex-col divide-y divide-outline">
            {media.assets.map((a, i) => (
              <li key={a.url} className="flex items-center gap-2.5 py-2">
                <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-surface-2 text-on-surface-2 shrink-0">
                  <Download size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-5 truncate">{a.label}</p>
                  <p className="text-[11px] text-on-surface-2 truncate">{a.filename}</p>
                </div>
                <Button
                  onClick={() => void doDownload(i)}
                  disabled={Boolean(downloading)}
                  className={cn('h-8 px-3 text-[12.5px] shrink-0', downloading === a.filename && 'opacity-70')}
                >
                  {downloading === a.filename ? <Loader2 size={13} className="animate-spin" /> : '下载'}
                </Button>
              </li>
            ))}
          </ul>

          {media.assets.length > 1 && (
            <Button onClick={() => void doDownload('all')} disabled={Boolean(downloading)} className="h-9">
              {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              全部下载（{media.assets.length} 项）
            </Button>
          )}
        </section>
      ) : (
        !busy && (
          <EmptyState icon={Clapperboard} title="还没有解析结果" hint="粘贴抖音或 B站的分享链接，点「解析」试试。" />
        )
      )}

      <p className="text-[11px] text-on-surface-2 leading-relaxed px-1">
        仅用于个人离线收藏，请支持原作者、不要传播下载内容。抖音走移动端公开接口（常见 720P 档），B站未登录上限 720P；
        平台接口变动可能导致解析失败，届时会明确报错。
      </p>
    </div>
  )
}
