import { useEffect, useRef, useState, type ClipboardEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  AlertTriangle,
  ClipboardPaste,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react'
import { IconToolArticle } from '@/shared/icons'
import { BackButton } from '@/shared/ui/BackButton'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { useUi } from '@/stores/ui'
import { fetchTextSmart } from '@/lib/netFetch'
import { sanitizeHtml } from '@/lib/sanitizeHtml'
import { openExternal } from '@/lib/links'
import { saveBlob } from '@/lib/saveFile'
import { importDoc, saveMarkdownDoc } from '@/db/docs'
import { db, type Doc } from '@/db/db'
import { PASTE_FALLBACK_HINT, extractArticle, extractPastedContent, type ParsedArticle } from './articleParse'
import { localizeImages, type ImageFailure } from './articleImages'
import { buildArticleMarkdown } from './articleMarkdown'
import { buildArticleEpub } from './articleEpub'

/** Windows/安卓文件名非法字符换空格（标题当文件名用） */
function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '文章'
}

/**
 * 网页文章 → 离线文档 / EPUB（v3.3）
 *
 * 抓取走 netFetch.fetchTextSmart（跨域失败走本机代理）→ articleParse 提取正文
 * （站点适配器 + Readability）→ articleImages 图片本地化（并发 4，缩到 1600）→
 * 两个出口：Markdown 进文档库（带 sourceUrl，重复抓取可更新）/ EPUB 落盘。
 * 登录墙抽不出正文时给粘贴兜底（剪贴板 text/html 或纯文本都能解析）。
 */
export function ArticleToolPage() {
  const navigate = useNavigate()
  const toast = useUi((s) => s.toast)
  const [searchParams] = useSearchParams()

  const [url, setUrl] = useState('')
  const [sourceUrl, setSourceUrl] = useState('') // 跟随重定向后的最终地址
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [article, setArticle] = useState<ParsedArticle | null>(null)
  const [capturedAt, setCapturedAt] = useState(0)
  const [previewHtml, setPreviewHtml] = useState('')
  const [imageFailures, setImageFailures] = useState<ImageFailure[]>([])
  const [existing, setExisting] = useState<Doc | null>(null)
  const [showPaste, setShowPaste] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [action, setAction] = useState('')

  const autoFetched = useRef(false)

  /** 一条解析结果的落地：图片本地化 → 预览 → 重复检测 */
  const settle = async (parsed: ParsedArticle, referer: string) => {
    if (!parsed.contentHtml) {
      toast(parsed.hint ?? PASTE_FALLBACK_HINT)
      setShowPaste(true)
      return
    }
    setStatus('正在本地化图片…')
    const loc = await localizeImages(parsed.contentHtml, {
      referer,
      onProgress: (done, total) => setStatus(`正在本地化图片 ${done}/${total}`),
    })
    setArticle({ ...parsed, contentHtml: loc.html })
    setPreviewHtml(sanitizeHtml(loc.html))
    setImageFailures(loc.failed)
    if (loc.failed.length) toast(`${loc.failed.length} 张图片下载失败，已保留原链接并标注`)
    const dup = await db.docs.where('sourceUrl').equals(referer).first()
    setExisting(dup ?? null)
    if (dup) toast(`已存在《${dup.title}》，是否更新？`, { label: '更新', run: () => void doSave(true) })
  }

  const doSave = async (update?: boolean) => {
    if (!article || action) return
    setAction('save')
    try {
      const md = buildArticleMarkdown({
        title: article.title,
        byline: article.byline,
        sourceUrl,
        capturedAt,
        contentHtml: article.contentHtml,
      })
      if (update && existing) {
        // 更新 = 重新抓取后替换该文档本体与标题（saveMarkdownDoc 连 hash/批注一起迁）
        const doc = await saveMarkdownDoc({ doc: existing, title: article.title, markdown: md })
        await db.docs.update(doc.id, { sourceUrl })
        toast(`已更新《${doc.title}》`)
      } else {
        const file = new File([md], `${safeName(article.title)}.md`, { type: 'text/markdown' })
        const { doc } = await importDoc(file)
        await db.docs.update(doc.id, { sourceUrl })
        toast('已存入文档库')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败')
    } finally {
      setAction('')
    }
  }

  const doExport = async () => {
    if (!article || action) return
    setAction('export')
    try {
      const blob = await buildArticleEpub({
        title: article.title,
        byline: article.byline || undefined,
        sourceUrl: sourceUrl || undefined,
        capturedAt,
        contentHtml: article.contentHtml,
      })
      const where = await saveBlob(blob, `${safeName(article.title)}.epub`)
      toast(`EPUB 已导出 → ${where}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : '导出失败')
    } finally {
      setAction('')
    }
  }

  async function doFetch(rawUrl?: string) {
    const target = (rawUrl ?? url).trim()
    if (!target || busy) {
      if (!target) toast('先粘贴文章链接')
      return
    }
    setBusy(true)
    setArticle(null)
    setPreviewHtml('')
    setImageFailures([])
    setExisting(null)
    try {
      setStatus('正在抓取网页…')
      const res = await fetchTextSmart(target, {
        proxyFallback: true,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      })
      const finalUrl = res.finalUrl || target
      setSourceUrl(finalUrl)
      setStatus('正在提取正文…')
      const parsed = extractArticle(res.body, finalUrl)
      setCapturedAt(Date.now())
      await settle(parsed, finalUrl)
    } catch (e) {
      toast(e instanceof Error ? e.message : '抓取失败，检查链接或网络')
      setShowPaste(true)
    } finally {
      setBusy(false)
      setStatus('')
    }
  }

  /** 粘贴兜底：优先解析剪贴板里的 text/html（全选复制带格式），否则纯文本 */
  const applyPasted = (html: string | null, text: string) => {
    const parsed = extractPastedContent(html, text, url)
    setCapturedAt(Date.now())
    setSourceUrl(url.trim())
    void (async () => {
      setBusy(true)
      try {
        await settle(parsed, url.trim())
      } finally {
        setBusy(false)
        setStatus('')
      }
    })()
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    if (html.trim() || text.trim()) {
      e.preventDefault()
      setPasteText(text)
      applyPasted(html.trim() ? html : null, text)
    }
  }

  // ?url= 预填并直接开抓（分享/深链进来少点一步）
  useEffect(() => {
    if (autoFetched.current) return
    autoFetched.current = true
    const u = searchParams.get('url')
    if (u) {
      setUrl(u)
      void doFetch(u)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="mx-auto w-full max-w-3xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <BackButton text="工具" label="返回工具" onClick={() => navigate('/tools')} className="-mt-1 w-fit" />

      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-[12px] bg-primary-soft text-primary shrink-0">
          <IconToolArticle size={22} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[20px] md:text-[22px] font-bold leading-7">文章离线</h1>
          <p className="text-[12.5px] text-on-surface-2 mt-0.5 leading-relaxed">
            粘贴文章链接，提取正文并本地化图片，存进文档库或导出 EPUB
          </p>
        </div>
      </header>

      <section className="card p-4 flex flex-col gap-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void doFetch()
          }}
          type="url"
          inputMode="url"
          placeholder="https://…（微信公众号 / 博客 / 知乎等文章链接）"
          className="w-full rounded-[12px] border border-outline bg-surface-2 px-3 py-2.5 text-[13.5px] leading-relaxed outline-none focus:border-primary/60"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => void doFetch()} disabled={busy} className="h-9 px-4">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} 抓取
          </Button>
          <Button variant="outline" onClick={() => setShowPaste((v) => !v)} className="h-9 px-3">
            <ClipboardPaste size={15} /> 粘贴正文兜底
          </Button>
          {status && (
            <span className="text-[11.5px] text-on-surface-2 inline-flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> {status}
            </span>
          )}
        </div>
        {!busy && !status && (
          <p className="text-[11.5px] text-on-surface-2 leading-relaxed">
            微信公众号 / CSDN 有专门适配；知乎、小红书等登录墙站点抽不出正文时，请用下面的粘贴兜底。
          </p>
        )}
      </section>

      {showPaste && (
        <section className="card p-4 flex flex-col gap-3">
          <p className="text-[12.5px] text-on-surface-2 leading-relaxed">
            在原网页全选复制正文后粘贴到下面（带格式的复制会连图片一起解析），或粘贴纯文本。
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            onPaste={onPaste}
            rows={6}
            placeholder="粘贴到这里…"
            className="w-full rounded-[12px] border border-outline bg-surface-2 px-3 py-2.5 text-[13.5px] leading-relaxed outline-none focus:border-primary/60 resize-y min-h-[120px]"
          />
          <Button onClick={() => applyPasted(null, pasteText)} disabled={!pasteText.trim() || busy} className="h-9 px-4 w-fit">
            解析纯文本
          </Button>
        </section>
      )}

      {article ? (
        <>
          <section className="card p-4 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-6">{article.title}</p>
                <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                  {article.byline && (
                    <span className="text-[10.5px] px-1.5 py-0.5 rounded-full bg-primary-soft text-primary font-medium">
                      {article.byline}
                    </span>
                  )}
                  <span className="text-[11px] text-on-surface-2">{article.charCount} 字</span>
                  <span className="text-[11px] text-on-surface-2">{article.imageCount} 图</span>
                  {article.usedReadability && <span className="text-[11px] text-on-surface-2">Readability 抽取</span>}
                  {imageFailures.length > 0 && (
                    <span className="text-[11px] text-danger inline-flex items-center gap-1">
                      <AlertTriangle size={11} /> {imageFailures.length} 图未下载
                    </span>
                  )}
                </div>
              </div>
            </div>

            {existing && (
              <div className="rounded-[10px] border border-outline bg-surface-2 px-3 py-2.5 text-[12.5px] leading-relaxed">
                该链接已存过文档《{existing.title}》，可更新替换其正文与标题，或另存为新文档。
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {existing ? (
                <Button onClick={() => void doSave(true)} disabled={Boolean(action)} className="h-9 px-4">
                  {action === 'save' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} 更新旧文档
                </Button>
              ) : null}
              <Button onClick={() => void doSave(false)} disabled={Boolean(action)} className="h-9 px-4">
                {action === 'save' ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                {existing ? '另存为新文档' : '存入文档库'}
              </Button>
              <Button variant="outline" onClick={() => void doExport()} disabled={Boolean(action)} className="h-9 px-4">
                {action === 'export' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} 导出 EPUB
              </Button>
              {sourceUrl && (
                <Button variant="ghost" onClick={() => openExternal(sourceUrl)} className="h-9 px-3">
                  <ExternalLink size={15} /> 打开原文
                </Button>
              )}
            </div>
            {sourceUrl && <p className="text-[11px] text-on-surface-2 break-all leading-relaxed">来源：{sourceUrl}</p>}
          </section>

          <section className="card p-4">
            <div
              className="article-preview text-[13.5px] leading-relaxed overflow-x-auto
                [&_img]:max-w-full [&_img]:rounded-[10px] [&_img]:my-2
                [&_p]:my-2 [&_h1]:text-[17px] [&_h2]:text-[15.5px] [&_h3]:text-[14px]
                [&_a]:text-primary [&_blockquote]:border-l-2 [&_blockquote]:border-outline [&_blockquote]:pl-3 [&_blockquote]:text-on-surface-2
                [&_table]:text-[12.5px] [&_td]:border [&_td]:border-outline [&_td]:px-2 [&_td]:py-1
                [&_th]:border [&_th]:border-outline [&_th]:px-2 [&_th]:py-1"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </section>
        </>
      ) : (
        !busy &&
        !showPaste && (
          <EmptyState
            icon={IconToolArticle}
            title="还没有文章"
            hint="粘贴文章链接点「抓取」，或用 ?url= 预填直接进来。"
          />
        )
      )}

      <p className="text-[11px] text-on-surface-2 leading-relaxed px-1">
        仅用于个人离线收藏，请支持原作者、不要传播存档内容。图片下载失败会保留原链接（离线后可能不显示）；
        网页版受浏览器跨域限制，大多数网站抓不了，可以直接粘贴文章正文；安卓 App / Windows 桌面版可直接抓链接。
      </p>
    </div>
  )
}
