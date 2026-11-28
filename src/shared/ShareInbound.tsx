import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowRight, BookOpen, Download, FileText, Globe, Link2, ListTodo } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { fmtDateTime } from '@/lib/date'
import { classifySharePayload } from '@/lib/shareRoute'
import { inferTier, parseQuickAdd } from '@/lib/nlp'
import { addTask } from '@/db/tasks'
import { useUi } from '@/stores/ui'

/**
 * 智能分享收件箱（Phase 3）：
 * 统一承接 Web Share Target（/#/share）与安卓系统 ACTION_SEND 分享，
 * 自动识别抖音/B站、番茄小说、网页文章与纯文本并一键分流到对应工具、文档库或任务清单。
 */
export function ShareInbound() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const toast = useUi((s) => s.toast)
  const [busy, setBusy] = useState<'doc' | 'task' | null>(null)

  const info = useMemo(() => {
    const all = new URLSearchParams()
    for (const [k, v] of new URLSearchParams(window.location.search)) all.set(k, v)
    for (const [k, v] of params) if (v) all.set(k, v)
    return classifySharePayload({
      title: all.get('title'),
      text: all.get('text'),
      url: all.get('url'),
    })
  }, [params])

  const hasContent = Boolean(info.rawPayload || info.url)

  const saveAsDoc = async () => {
    if (!hasContent || busy) return
    setBusy('doc')
    try {
      const { importDoc } = await import('@/db/docs')
      const content = `# ${info.title}\n\n${info.rawPayload}\n\n> 来自系统分享 · ${fmtDateTime(new Date())}\n`
      const safe = info.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim().slice(0, 60) || '分享内容'
      const file = new File([content], `${safe}.md`, { type: 'text/markdown' })
      const { doc } = await importDoc(file)
      toast('已存入文档工作站')
      navigate(`/docs/${doc.id}`, { replace: true })
    } catch {
      toast('保存文档失败，请重试')
    } finally {
      setBusy(null)
    }
  }

  const saveAsTask = async () => {
    if (!hasContent || busy) return
    setBusy('task')
    try {
      if (info.url) {
        await addTask({
          title: info.title === '分享内容' ? `稍后阅读：${info.url}` : info.title,
          tier: 'anytime',
          notes: info.rawPayload,
          tags: ['稍后读'],
        })
        toast('已存为稍后读任务')
        navigate('/tasks?tier=anytime', { replace: true })
      } else {
        const parsed = parseQuickAdd(info.rawPayload.split('\n')[0] ?? info.title)
        await addTask({
          title: parsed.title || info.title,
          tier: inferTier(parsed, 'today'),
          due: parsed.due,
          dueTime: parsed.dueTime,
          startAt: parsed.startAt,
          priority: parsed.priority,
          tags: parsed.tags,
          repeat: parsed.repeat,
          repeatDays: parsed.repeatDays,
          repeatMonthDay: parsed.repeatMonthDay,
          repeatCount: parsed.repeatCount,
          repeatTimes: parsed.repeatTimes,
          estimateMinutes: parsed.estimateMinutes,
          notes: info.rawPayload.includes('\n') ? info.rawPayload : undefined,
        })
        toast('已转为今日任务')
        navigate('/today', { replace: true })
      }
    } catch {
      toast('创建任务失败，请重试')
    } finally {
      setBusy(null)
    }
  }

  const BadgeIcon =
    info.kind === 'media'
      ? Download
      : info.kind === 'fanqie'
        ? BookOpen
        : info.kind === 'article'
          ? Globe
          : Link2

  return (
    <div className="min-h-[calc(100dvh-10rem)] grid place-items-center px-5 py-10 enter">
      <div className="card p-6 sm:p-7 max-w-md w-full flex flex-col gap-4">
        <div className="flex items-start gap-3.5">
          <span className="grid place-items-center w-11 h-11 rounded-2xl bg-primary-soft text-primary shrink-0">
            <BadgeIcon size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary-soft text-primary mb-1">
              {hasContent ? info.badge : '系统分享收件箱'}
            </span>
            <h1 className="text-[16px] font-bold leading-snug break-words">
              {hasContent ? info.title : '没有收到分享内容'}
            </h1>
          </div>
        </div>

        {hasContent ? (
          <div className="rounded-[12px] bg-surface-2 border border-outline/70 px-3 py-2.5 text-[12.5px] text-on-surface-2 leading-relaxed max-h-36 overflow-y-auto break-all whitespace-pre-wrap">
            {info.rawPayload}
          </div>
        ) : (
          <p className="text-[13px] text-on-surface-2 leading-relaxed">
            在微信、浏览器、B 站、抖音等应用中选择「分享 → Kairos」，即可自动识别并离线剪藏、解析下载、入文档库或转为待办。
          </p>
        )}

        {hasContent ? (
          <div className="flex flex-col gap-2">
            {info.primaryRoute && (
              <Button
                variant="primary"
                className="w-full justify-between"
                onClick={() => navigate(info.primaryRoute!, { replace: true })}
              >
                <span>{info.primaryLabel}</span>
                <ArrowRight size={15} />
              </Button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={info.primaryRoute ? 'outline' : 'primary'}
                disabled={busy !== null}
                onClick={() => void saveAsDoc()}
              >
                <FileText size={14} />
                {busy === 'doc' ? '保存中…' : info.url ? '存为链接笔记' : '存入文档库'}
              </Button>
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => void saveAsTask()}
              >
                <ListTodo size={14} />
                {busy === 'task' ? '创建中…' : info.url ? '存为稍后读任务' : '转为今日任务'}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="primary" onClick={() => navigate('/today', { replace: true })}>
            返回工作台
          </Button>
        )}
      </div>
    </div>
  )
}
