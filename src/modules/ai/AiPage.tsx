import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSearchParams } from 'react-router'
import { MessageSquare, Plus, Square, Trash2 } from 'lucide-react'
import { db, type AiSession } from '@/db/db'
import { deleteSession } from '@/db/ai'
import { useAi } from '@/stores/ai'
import { useUi } from '@/stores/ui'
import { Segmented } from '@/shared/ui/Segmented'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/lib/cn'
import { ChatView } from './ChatView'
import { ProviderCards } from './ProviderCards'
import { UsageDashboard } from './UsageDashboard'

type Tab = 'chat' | 'assets' | 'usage'

interface Source {
  module: 'task' | 'doc'
  id: string
  label: string
  prefill: string
}

/** AI 助手面板（M3 改版）：资产优先 —— 会员订阅 / API 套餐管理为主，对话为辅 */
export function AiPage() {
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>('assets')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [showListMobile, setShowListMobile] = useState(true)
  const [source, setSource] = useState<Source | null>(null)
  const sessions = useLiveQuery(() => db.aiSessions.orderBy('updatedAt').reverse().toArray(), [], [] as AiSession[])
  const running = useAi((s) => s.running)

  // 深链：?s=会话id 直达；?src=task:12 / doc:8 带来源上下文
  useEffect(() => {
    const s = params.get('s')
    if (s) {
      setSessionId(s)
      setShowListMobile(false)
      setTab('chat')
      return
    }
    const src = params.get('src')
    if (!src) return
    setTab('chat')
    const [module, id] = src.split(':')
    if (module !== 'task' && module !== 'doc') return
    void (async () => {
      let label = ''
      let prefill = ''
      if (module === 'task') {
        const task = await db.tasks.get(id)
        label = task?.title ?? ''
        prefill = `请帮我拆解任务「${task?.title ?? ''}」：给出可执行的子任务建议（含优先级与预估用时）。${task?.notes ? `\n\n任务备注：${task.notes}` : ''}`
      } else {
        const doc = await db.docs.get(id)
        label = doc?.title ?? ''
        prefill = `请总结文档《${doc?.title ?? ''}》的核心要点，并给出 3 个可执行的后续行动建议。`
      }
      setSource({ module: module as 'task' | 'doc', id, label, prefill })
    })()
  }, [params])

  const runningList = useMemo(() => Object.values(running), [running])

  return (
    <div className="mx-auto w-full max-w-5xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter h-[calc(100dvh-3.5rem-3.5rem)] md:h-[calc(100dvh-0px)] md:pt-6 min-h-0">
      <div className="flex items-center gap-3 shrink-0">
        <h1 className="text-[22px] font-bold leading-8">AI 助手</h1>
        <Segmented
          className="sm:ml-auto"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'assets', label: '资产' },
            { value: 'chat', label: '对话' },
            { value: 'usage', label: '用量' },
          ]}
        />
      </div>

      {tab === 'assets' && <ProviderCards />}
      {tab === 'usage' && <UsageDashboard />}

      {tab === 'chat' && (
        <div className="flex-1 flex gap-4 min-h-0">
          {/* 会话列表 */}
          <aside
            className={cn(
              'w-full md:w-64 shrink-0 flex flex-col min-h-0',
              showListMobile ? 'flex' : 'hidden md:flex',
            )}
          >
            <Button variant="primary" size="sm" className="mb-2.5" onClick={() => { setSessionId(null); setShowListMobile(false); setSource(null) }}>
              <Plus size={14} /> 新会话
            </Button>

            {/* 运行中任务卡片（方案 2.3） */}
            {runningList.length > 0 && (
              <div className="flex flex-col gap-1.5 mb-2.5">
                {runningList.map((r) => (
                  <button
                    key={r.sessionId}
                    onClick={() => { setSessionId(r.sessionId); setShowListMobile(false) }}
                    className="card px-3 py-2 text-left cursor-pointer border-primary/40"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ai-pulse" />
                      <span className="text-[12px] font-medium truncate flex-1">{r.title}</span>
                      <button
                        aria-label="停止生成"
                        onClick={(e) => { e.stopPropagation(); useAi.getState().stop(r.sessionId) }}
                        className="text-on-surface-2 hover:text-danger cursor-pointer"
                      >
                        <Square size={11} />
                      </button>
                    </span>
                    <span className="text-[10.5px] text-on-surface-2 mt-0.5 block">
                      {r.providerName} · {r.model} · {r.tokens} 字
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-1.5 pr-0.5">
              {sessions.length === 0 && (
                <p className="text-[12px] text-on-surface-2 text-center py-6 leading-relaxed">
                  还没有会话。<br />发消息或从任务/文档发起。
                </p>
              )}
              {sessions.map((s) => {
                const active = sessionId === s.id
                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setSessionId(s.id); setShowListMobile(false) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setSessionId(s.id); setShowListMobile(false) } }}
                    className={cn(
                      'group flex items-start gap-1 px-3 py-2.5 rounded-[12px] transition-colors cursor-pointer',
                      active ? 'bg-primary-soft' : 'hover:bg-surface-3',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {s.sourceModule && <MessageSquare size={11} className={active ? 'text-primary shrink-0' : 'text-on-surface-2 shrink-0'} />}
                        <span className={cn('text-[13px] truncate flex-1', active && 'text-primary font-medium')}>{s.title}</span>
                      </span>
                      <span className="block text-[10.5px] text-on-surface-2 mt-0.5 truncate">
                        {s.model}
                        {s.sourceLabel ? ` · 来自${s.sourceModule === 'task' ? '任务' : '文档'}` : ''}
                      </span>
                    </div>
                    <button
                      aria-label="删除会话"
                      onClick={(e) => {
                        e.stopPropagation()
                        void deleteSession(s.id).then(() => {
                          if (sessionId === s.id) setSessionId(null)
                          useUi.getState().toast('会话已删除')
                        })
                      }}
                      className={cn(
                        'grid place-items-center w-6 h-6 rounded-lg text-on-surface-2 hover:text-danger hover:bg-danger/10 cursor-pointer shrink-0',
                        active ? 'opacity-70' : 'opacity-0 group-hover:opacity-70',
                      )}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          </aside>

          {/* 聊天区 */}
          <div className={cn('flex-1 min-w-0 card overflow-hidden', showListMobile && 'hidden md:block')}>
            <ChatView
              sessionId={sessionId}
              source={source}
              onBack={() => setShowListMobile(true)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
