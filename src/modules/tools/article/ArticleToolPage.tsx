import { useEffect, useRef, useState, type ClipboardEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  AlertTriangle,
  ClipboardPaste,
  Download,
  ExternalLink,
  FileDown,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
} from 'lucide-react'
import { IconToolArticle } from '@/shared/icons'
import { ToolIconTile } from '@/shared/ui/ToolIconTile'
import { BackButton } from '@/shared/ui/BackButton'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { TopProgressLine } from '@/shared/ui/TopProgressLine'
import { useUi } from '@/stores/ui'
import { fetchTextSmart } from '@/lib/netFetch'
import { sanitizeHtml } from '@/lib/sanitizeHtml'
import { openExternal } from '@/lib/links'
import { isSaveCancelled, openSavedAction, saveBlob } from '@/lib/saveFile'
import { importDoc, saveMarkdownDoc } from '@/db/docs'
import { db, type Doc } from '@/db/db'
import {
  PASTE_FALLBACK_HINT,
  extractArticle,
  extractPastedContent,
  extractVisibleText,
  htmlImageCount,
  normalizeArticleUrl,
  type ParsedArticle,
} from './articleParse'
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
  const [progress, setProgress] = useState<number | null>(null)
  const [article, setArticle] = useState<ParsedArticle | null>(null)
  const [capturedAt, setCapturedAt] = useState(0)
  const [previewHtml, setPreviewHtml] = useState('')
  const [imageFailures, setImageFailures] = useState<ImageFailure[]>([])
  const [existing, setExisting] = useState<Doc | null>(null)
  const [showPaste, setShowPaste] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [action, setAction] = useState('')

  const lastAutoUrlRef = useRef('')

  /** 一条解析结果的落地：图片本地化 → 白名单清洗 → 预览 → 重复检测 */
  const settle = async (parsed: ParsedArticle, referer: string, capAt: number) => {
    if (!parsed.contentHtml) {
      toast(parsed.hint ?? PASTE_FALLBACK_HINT)
      setShowPaste(true)
      return
    }
    setStatus('正在本地化图片…')
    setProgress(null)
    const loc = await localizeImages(parsed.contentHtml, {
      referer,
      onProgress: (done, total) => {
        setStatus(`正在本地化图片 ${done}/${total}`)
        setProgress(total > 0 ? done / total : null)
      },
    })
    setProgress(null)
    const cleanHtml = sanitizeHtml(loc.html)
    const cleanText = extractVisibleText(cleanHtml)
    const cleanCount = cleanText.replace(/\s+/g, '').length
    const nextArticle: ParsedArticle = {
      ...parsed,
      contentHtml: cleanHtml,
      textContent: cleanText.trim(),
      charCount: cleanCount,
      imageCount: htmlImageCount(cleanHtml),
    }
    setArticle(nextArticle)
    setPreviewHtml(cleanHtml)
    setShowPaste(false)
    setImageFailures(loc.failed)
    if (loc.failed.length) toast(`${loc.failed.length} 张图片下载失败，已保留原链接并标注`)
    const dup = referer ? await db.docs.where('sourceUrl').equals(referer).filter(d => !d.deletedAt).first() : undefined
    setExisting(dup ?? null)
    if (dup) {
      toast(`已存在《${dup.title}》，是否更新？`, {
        label: '更新',
        run: () => void doSave(true, { article: nextArticle, existing: dup, sourceUrl: referer, capturedAt: capAt }),
      })
    }
  }

  const doSave = async (
    update?: boolean,
    override?: { article: ParsedArticle; existing: Doc | null; sourceUrl: string; capturedAt: number },
  ) => {
    const targetArticle = override?.article ?? article
    const targetExisting = override ? override.existing : existing
    const targetSourceUrl = override?.sourceUrl ?? sourceUrl
    const targetCapturedAt = override?.capturedAt ?? capturedAt
    if (!targetArticle || action) return
    setAction('save')
    try {
      const title = targetArticle.title.trim() || '无标题文章'
      const byline = targetArticle.byline.trim()
      const md = buildArticleMarkdown({
        title,
        byline,
        sourceUrl: targetSourceUrl,
        capturedAt: targetCapturedAt,
        contentHtml: targetArticle.contentHtml,
      })
      if (update && targetExisting) {
        // 更新 = 重新抓取后替换该文档本体与标题（saveMarkdownDoc 连 hash/批注一起迁）
        const doc = await saveMarkdownDoc({ doc: targetExisting, title, markdown: md })
        await db.docs.update(doc.id, { sourceUrl: targetSourceUrl })
        setExisting({ ...doc, sourceUrl: targetSourceUrl })
        toast(`已更新《${doc.title}》`, { label: '立即阅读', run: () => navigate(`/docs/${doc.id}`) })
      } else {
        const file = new File([md], `${safeName(title)}.md`, { type: 'text/markdown' })
        const { doc } = await importDoc(file)
        await db.docs.update(doc.id, { sourceUrl: targetSourceUrl })
        setExisting({ ...doc, sourceUrl: targetSourceUrl })
        toast('已存入文档库', { label: '立即阅读', run: () => navigate(`/docs/${doc.id}`) })
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
      const title = article.title.trim() || '无标题文章'
      const byline = article.byline.trim()
      const blob = await buildArticleEpub({
        title,
        byline: byline || undefined,
        sourceUrl: sourceUrl || undefined,
        capturedAt,
        contentHtml: article.contentHtml,
      })
      const where = await saveBlob(blob, `${safeName(title)}.epub`)
      toast(`EPUB 已导出 → ${where}`, openSavedAction())
    } catch (e) {
      if (!isSaveCancelled(e)) toast(e instanceof Error ? e.message : '导出失败')
    } finally {
      setAction('')
    }
  }

  async function doFetch(rawUrl?: string) {
    const raw = (rawUrl ?? url).trim()
    if (!raw || busy) {
      if (!raw) toast('先粘贴文章链接')
      return
    }
    let target: string
    try {
      target = normalizeArticleUrl(raw)
    } catch (e) {
      toast(e instanceof Error ? e.message : '请输入有效的网页链接')
      return
    }
    if (!rawUrl && target !== url) setUrl(target)

    setBusy(true)
    setProgress(null)
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
      const now = Date.now()
      setCapturedAt(now)
      await settle(parsed, finalUrl, now)
    } catch (e) {
      toast(e instanceof Error ? e.message : '抓取失败，检查链接或网络')
      setShowPaste(true)
    } finally {
      setBusy(false)
      setStatus('')
      setProgress(null)
    }
  }

  /** 粘贴兜底：优先解析剪贴板里的 text/html（全选复制带格式），否则纯文本 */
  const applyPasted = (html: string | null, text: string) => {
    if (busy) return
    let ref = ''
    try {
      ref = normalizeArticleUrl(url)
    } catch {
      ref = url.trim()
    }
    const parsed = extractPastedContent(html, text, ref)
    const now = Date.now()
    setCapturedAt(now)
    setSourceUrl(ref)
    void (async () => {
      setBusy(true)
      setProgress(null)
      try {
        await settle(parsed, ref, now)
      } finally {
        setBusy(false)
        setStatus('')
        setProgress(null)
      }
    })()
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (busy) return
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    if (html.trim() || text.trim()) {
      e.preventDefault()
      setPasteText(text)
      applyPasted(html.trim() ? html : null, text)
    }
  }

  // ?url= 预填并直接开抓（分享/深链进来少点一步，参数变化时自动响应）
  const urlParam = searchParams.get('url') ?? ''
  useEffect(() => {
    if (!urlParam || lastAutoUrlRef.current === urlParam) return
    lastAutoUrlRef.current = urlParam
    setUrl(urlParam)
    void doFetch(urlParam)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlParam])

  return (
    <div className="mx-auto w-full max-w-4xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <BackButton text="工具" label="返回工具" onClick={() => navigate('/tools')} className="hidden md:inline-flex -mt-1 w-fit" />

      <header className="flex items-start gap-3.5">
        <ToolIconTile icon={IconToolArticle} />
        <div className="min-w-0">
          <h1 className="hidden md:block text-[24px] font-bold tracking-[-0.02em] leading-7">文章离线</h1>
          <p className="text-[12.5px] text-on-surface-2 mt-0.5 leading-relaxed">
            粘贴文章链接，提取正文并本地化图片，存进文档库或导出 EPUB
          </p>
        </div>
      </header>

      <section className="card relative overflow-hidden p-4 flex flex-col gap-3">
        <TopProgressLine active={busy} progress={progress} label={status || '抓取网页文章'} />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void doFetch()
          }}
          type="text"
          inputMode="url"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="粘贴文章链接"
          className="w-full rounded-[12px] border border-outline bg-surface-2 px-3 py-2.5 text-[13.5px] leading-relaxed outline-none focus:border-primary/60"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="primary" onClick={() => void doFetch()} disabled={busy} className="h-9 px-4">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} 抓取
          </Button>
          <Button variant="outline" onClick={() => setShowPaste((v) => !v)} className="h-9 px-3">
            <ClipboardPaste size={15} /> 粘贴正文
          </Button>
          {status && (
            <span className="text-[11.5px] text-on-surface-2 inline-flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> {status}
            </span>
          )}
        </div>
        {!busy && !status && (
          <p className="text-[11.5px] text-on-surface-2 leading-relaxed">
            已适配微信公众号、掘金、CSDN、博客园、简书、GitHub、知乎专栏、B站专栏；登录墙抽不出正文时可用粘贴兜底。
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
          <Button variant="primary" onClick={() => applyPasted(null, pasteText)} disabled={!pasteText.trim() || busy} className="h-9 px-4 w-fit">
            解析纯文本
          </Button>
        </section>
      )}

      {article ? (
        <>
          <section className="card relative overflow-hidden p-4 flex flex-col gap-3">
            <TopProgressLine active={Boolean(action)} label={action === 'export' ? '正在导出 EPUB' : '正在保存文档'} />
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 rounded-[10px] border border-outline/70 bg-surface-2/60 px-2.5 py-1.5 focus-within:border-primary/60">
                <Pencil size={13} className="text-on-surface-2 shrink-0" aria-hidden />
                <input
                  value={article.title}
                  onChange={(e) => setArticle((prev) => (prev ? { ...prev, title: e.target.value } : null))}
                  aria-label="文章标题"
                  placeholder="输入文章标题"
                  className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold leading-6 outline-none"
                />
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="inline-flex items-center gap-1.5 rounded-full border border-outline/70 bg-surface-2 px-2.5 py-0.5 text-[11px] focus-within:border-primary/60">
                  <span className="text-on-surface-2">作者</span>
                  <input
                    value={article.byline}
                    onChange={(e) => setArticle((prev) => (prev ? { ...prev, byline: e.target.value } : null))}
                    aria-label="作者"
                    placeholder="可选"
                    className="w-28 bg-transparent text-[11px] font-medium text-primary outline-none placeholder:text-on-surface-2/60"
                  />
                </label>
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

            {existing && (
              <div className="rounded-[10px] border border-outline bg-surface-2 px-3 py-2.5 text-[12.5px] leading-relaxed">
                该链接已存过文档《{existing.title}》，可更新替换其正文与标题，或另存为新文档。
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {existing ? (
                <Button variant="primary" onClick={() => void doSave(true)} disabled={Boolean(action)} className="h-9 px-4">
                  {action === 'save' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} 更新旧文档
                </Button>
              ) : null}
              <Button variant={existing ? 'outline' : 'primary'} onClick={() => void doSave(false)} disabled={Boolean(action)} className="h-9 px-4">
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

          <section className="card p-5 md:p-7">
            <div
              className="article-preview md-body text-[15px] leading-[1.82]
                [&_div]:max-w-full [&_section]:max-w-full [&_table]:w-full"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </section>
        </>
      ) : (
        !busy &&
        !showPaste && (
          <EmptyState
            icon={FileDown}
            title="还没有文章"
            hint="粘贴文章链接后，点「抓取」。"
          />
        )
      )}

      <p className="text-[11px] text-on-surface-2 leading-relaxed px-1">
        仅用于个人离线收藏，请支持原作者、不要传播存档内容。图片下载失败会保留原链接（离线后可能不显示）；
      </p>
    </div>
  )
}
