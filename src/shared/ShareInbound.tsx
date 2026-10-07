import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Link2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'

/**
 * PWA share_target 落地页（v1.3）：
 * 系统分享文本/链接到工作站 → /#/share → 创建 MD 文档。
 * 注意：Web Share Target 的 GET 参数可能落在 hash 前（./?title=x#/share），
 * 因此同时读 hash 内 search 与 location.search。
 */
export function ShareInbound() {
  const [params] = useSearchParams()
  const [saved, setSaved] = useState(false)
  const [failed, setFailed] = useState(false)

  const merged = (() => {
    const all = new URLSearchParams()
    for (const [k, v] of new URLSearchParams(window.location.search)) all.set(k, v)
    for (const [k, v] of params) if (v) all.set(k, v)
    return all
  })()
  const title = (merged.get('title') ?? '').trim() || '分享内容'
  const text = (merged.get('text') ?? '').trim()
  const url = (merged.get('url') ?? '').trim()
  const body = [text, url && text !== url ? url : ''].filter(Boolean).join('\n\n')

  useEffect(() => {
    if (saved || failed || !body) return
    void import('@/db/docs').then(async ({ importDoc }) => {
      try {
        const file = new File(
          [`# ${title}\n\n${body}\n\n> 来自系统分享 · ${new Date().toLocaleString('zh-CN')}\n`],
          `${title}.md`,
          { type: 'text/markdown' },
        )
        await importDoc(file)
        setSaved(true)
      } catch {
        setFailed(true)
      }
    })
  }, [saved, failed, title, body])

  return (
    <div className="h-full grid place-items-center px-6">
      <div className="card p-8 max-w-sm text-center flex flex-col items-center gap-3">
        <span className="grid place-items-center w-12 h-12 rounded-full bg-primary-soft text-primary">
          <Link2 size={22} />
        </span>
        <h1 className="text-[17px] font-bold">
          {saved ? '已收进文档工作站' : failed ? '保存失败' : '正在收进文档工作站…'}
        </h1>
        <p className="text-[13px] text-on-surface-2 break-all">{title}</p>
        <Button variant="primary" onClick={() => { window.location.hash = '#/docs' }}>
          前往查看
        </Button>
      </div>
    </div>
  )
}
