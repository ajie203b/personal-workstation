import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Link2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { fmtDateTime } from '@/lib/date'

/**
 * PWA share_target 落地页（v1.3）：
 * 系统分享文本/链接到工作站 → /#/share → 创建 MD 文档。
 * 注意：Web Share Target 的 GET 参数可能落在 hash 前（./?title=x#/share），
 * 因此同时读 hash 内 search 与 location.search。
 */
export function ShareInbound() {
  const navigate = useNavigate()
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
          [`# ${title}\n\n${body}\n\n> 来自系统分享 · ${fmtDateTime(new Date())}\n`],
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
    <div className="min-h-[calc(100dvh-10rem)] grid place-items-center px-6 py-12">
      <div className="card p-8 max-w-sm w-full text-center flex flex-col items-center gap-3.5">
        <span className="grid place-items-center w-12 h-12 rounded-2xl bg-primary-soft text-primary">
          <Link2 size={22} />
        </span>
        <h1 className="text-[17px] font-bold">
          {saved ? '已收进文档工作站' : failed ? '保存失败' : body ? '正在收进文档工作站…' : '没有收到分享内容'}
        </h1>
        <p className="text-[13px] text-on-surface-2 break-all">{body ? title : '从其他应用分享文本或链接，即可存入文档库。'}</p>
        <Button variant="primary" onClick={() => navigate('/docs')}>
          前往查看
        </Button>
      </div>
    </div>
  )
}
