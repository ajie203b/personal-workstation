import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router'
import {
  ArrowLeft, Bot, Copy, RefreshCw, Send, Sparkles, Square,
} from 'lucide-react'
import { db, type AiMessage, type AiProvider, type AiSession } from '@/db/db'
import { addMessage, createSession, getDefaultProvider, recordUsage, updateMessage } from '@/db/ai'
import { useAi } from '@/stores/ai'
import { estimateCost, streamChat, type ChatTurn } from '@/lib/aiGateway'
import { Button } from '@/shared/ui/Button'
import { openSource } from '@/shared/DeepLink'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'

interface Props {
  sessionId: string | null
  /** 从任务/文档深链带来的来源上下文 */
  source: { module: 'task' | 'doc'; id: string; label: string; prefill: string } | null
  onBack: () => void
}

const STATE_BADGE: Record<AiMessage['state'], { label: string; cls: string }> = {
  queued: { label: '排队中', cls: 'bg-surface-3 text-on-surface-2' },
  streaming: { label: '生成中', cls: 'bg-primary-soft text-primary' },
  done: { label: '', cls: '' },
  cancelled: { label: '已停止', cls: 'bg-surface-3 text-on-surface-2' },
  failed: { label: '失败', cls: 'bg-danger/10 text-danger' },
}

/** 会话视图：消息五态渲染 + 流式输出 + 模型切换不丢上下文 */
export function ChatView({ sessionId, source, onBack }: Props) {
  const navigate = useNavigate()
  const toast = useUi((s) => s.toast)
  const sessions = useLiveQuery(() => db.aiSessions.orderBy('updatedAt').reverse().toArray(), [], [] as AiSession[])
  const session = sessions.find((s) => s.id === sessionId) ?? null
  const messages = useLiveQuery(
    () => (sessionId ? db.aiMessages.where('sessionId').equals(sessionId).sortBy('createdAt') : Promise.resolve([] as AiMessage[])),
    [sessionId],
    [] as AiMessage[],
  )
  const providers = useLiveQuery(() => db.aiProviders.toArray(), [], [] as AiProvider[])

  const [draft, setDraft] = useState('')
  const [streamText, setStreamText] = useState('')
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const run = useAi((s) => s.running[sessionId ?? ''])
  const scrollRef = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)

  // 深链预填（任务拆解 / 文档问答）
  useEffect(() => {
    if (startedRef.current || !source) return
    startedRef.current = true
    setDraft(source.prefill)
  }, [source])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length, streamText])

  const activeModel = session?.model ?? session?.model ?? ''
  const provider = providers.find((p) => p.id === session?.providerId)

  const send = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? draft).trim()
    if (!text) return
    let sid = sessionId
    let currentProvider = provider
    let model = activeModel

    // 新会话：需要默认 Provider；来源信息从深链带入
    if (!sid) {
      currentProvider = currentProvider ?? (await getDefaultProvider())
      if (!currentProvider) {
        toast('请先在「资产」页配置一个 AI 服务商')
        return
      }
      model = model || currentProvider.models[0] || ''
      const s = await createSession({
        title: text.slice(0, 24),
        providerId: currentProvider.id,
        model,
        sourceModule: source?.module,
        sourceId: source?.id,
        sourceLabel: source?.label,
      })
      sid = s.id
    }
    if (!currentProvider || !model) {
      toast('会话缺少可用模型，请检查资产配置')
      return
    }

    setDraft('')
    // 划词问AI：用户消息已由 startDocAiSession 写入，传入 overrideText 时不再重复添加
    const userMsg = overrideText
      ? { id: 'prefilled', content: text, state: 'done' as const, role: 'user' as const, sessionId: sid, createdAt: 0 }
      : await addMessage({ sessionId: sid, role: 'user', content: text, state: 'done' })
    const assistantMsg = await addMessage({
      sessionId: sid,
      role: 'assistant',
      content: '',
      state: 'streaming',
      model,
    })
    if (!sessionId && sid) {
      // 首条消息创建会话后，把 URL 换成会话深链（可分享/可回退）
      navigate(`/ai?s=${sid}`, { replace: true })
    }

    // 组装上下文：历史 + 本轮（中途切模型不丢上下文：消息各自带 model，发送取全部历史）
    const turns: ChatTurn[] = [
      ...messages.filter((m) => (m.state === 'done' || m.state === 'cancelled') && m.content).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: userMsg.content },
    ].filter((t) => t.content)

    const controller = new AbortController()
    useAi.getState().start({
      sessionId: sid,
      title: text.slice(0, 20),
      model,
      providerName: currentProvider.name,
      startedAt: Date.now(),
      tokens: 0,
      controller,
    })
    setStreamingId(assistantMsg.id)
    setStreamText('')
    const startedAt = Date.now()
    let acc = ''
    const usageRef: { current: { tokensIn: number; tokensOut: number } | null } = { current: null }

    await streamChat(currentProvider, model, turns, controller.signal, {
      onDelta: (delta) => {
        acc += delta
        setStreamText(acc)
        useAi.getState().updateTokens(sid!, acc.length)
      },
      onUsage: (usage) => {
        usageRef.current = usage
        const latency = Date.now() - startedAt
        void recordUsage({
          provider: currentProvider!.name,
          model,
          tokensIn: usage.tokensIn,
          tokensOut: usage.tokensOut,
          cost: estimateCost(currentProvider, usage.tokensIn, usage.tokensOut),
          latencyMs: latency,
          module: (source?.module as 'task' | 'doc') ?? 'chat',
          ok: true,
        })
      },
      onError: (message) => {
        void updateMessage(assistantMsg.id, { state: 'failed', content: acc, error: message, latencyMs: Date.now() - startedAt })
      },
    })

    // 正常/中断收尾
    const finalState = controller.signal.aborted ? 'cancelled' : 'done'
    void updateMessage(assistantMsg.id, {
      state: finalState,
      content: acc,
      latencyMs: Date.now() - startedAt,
      tokensIn: usageRef.current?.tokensIn,
      tokensOut: usageRef.current?.tokensOut,
    })
    setStreamingId(null)
    setStreamText('')
    useAi.getState().finish(sid)
  }, [draft, sessionId, provider, activeModel, messages, source, toast, navigate])

  // 划词问AI：会话里只有一条用户消息且无回复时，自动触发生成
  const autoSentRef = useRef<string | null>(null)
  useEffect(() => {
    if (!sessionId || streamingId) return
    if (autoSentRef.current === sessionId) return
    if (messages.length === 1 && messages[0].role === 'user' && messages[0].state === 'done') {
      autoSentRef.current = sessionId
      void send(messages[0].content)
    }
  }, [sessionId, messages, streamingId, send])

  const retry = useCallback(async (msg: AiMessage) => {
    if (!session || !provider) return
    // 找到该 assistant 消息之前的用户消息，重发生成（保留已生成内容直到新内容开始）
    void updateMessage(msg.id, { state: 'streaming', error: undefined })
    const turns: ChatTurn[] = messages
      .filter((m) => m.id !== msg.id && (m.state === 'done' || m.state === 'cancelled'))
      .map((m) => ({ role: m.role, content: m.content }))
    const controller = new AbortController()
    useAi.getState().start({
      sessionId: session.id, title: session.title, model: msg.model ?? session.model,
      providerName: provider.name, startedAt: Date.now(), tokens: 0, controller,
    })
    setStreamingId(msg.id)
    setStreamText('')
    let acc = ''
    const usageRef: { current: { tokensIn: number; tokensOut: number } | null } = { current: null }
    const startedAt = Date.now()
    await streamChat(provider, msg.model ?? session.model, turns, controller.signal, {
      onDelta: (d) => { acc += d; setStreamText(acc) },
      onUsage: (u) => { usageRef.current = u },
      onError: (message) => void updateMessage(msg.id, { state: 'failed', content: acc, error: message }),
    })
    void updateMessage(msg.id, {
      state: controller.signal.aborted ? 'cancelled' : 'done',
      content: acc,
      latencyMs: Date.now() - startedAt,
      tokensIn: usageRef.current?.tokensIn,
      tokensOut: usageRef.current?.tokensOut,
    })
    setStreamingId(null)
    setStreamText('')
    useAi.getState().finish(session.id)
  }, [session, provider, messages])

  // 新会话（无 sessionId）也直接进入对话界面：发送时才创建会话

  return (
    <div className="flex flex-col h-full">
      {/* 会话头 */}
      <div className="flex items-center gap-2 h-12 shrink-0 border-b border-outline/70 px-1">
        <button aria-label="返回会话列表" onClick={onBack} className="md:hidden grid place-items-center w-9 h-9 rounded-[10px] text-on-surface-2 hover:bg-surface-3">
          <ArrowLeft size={17} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold truncate leading-tight">{session?.title ?? (source ? '来自来源的新会话' : '新会话')}</p>
          <p className="text-[11px] text-on-surface-2 leading-tight">
            {provider?.name ?? '未配置服务商'} · {activeModel || '发送时自动选择模型'}
            {run && <span className="text-primary ml-1.5">· 生成中 {run.tokens} 字</span>}
          </p>
        </div>
        {session?.sourceModule && (
          <button
            onClick={() => openSource(`${session.sourceModule}:${session.sourceId}`)}
            className="text-[11px] px-2 py-1 rounded-full bg-primary-soft text-primary hover:opacity-80 cursor-pointer"
            title={`回到来源${session.sourceLabel ? `：${session.sourceLabel}` : ''}`}
          >
            {session.sourceModule === 'task' ? '任务' : '文档'} · {session.sourceLabel?.slice(0, 10) ?? '来源'}
          </button>
        )}
        {run && sessionId && (
          <Button size="sm" variant="outline" onClick={() => useAi.getState().stop(sessionId)}>
            <Square size={12} /> 停止
          </Button>
        )}
      </div>

      {/* 消息列表 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 md:px-5 py-4 min-h-0">
        {messages.length === 0 && (
          <div className="h-full grid place-items-center text-center text-on-surface-2">
            <div>
              <Bot size={28} className="mx-auto mb-2 opacity-60" />
              <p className="text-[13.5px]">输入第一条消息开始对话</p>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-3 max-w-[760px] mx-auto">
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              msg={m}
              isStreaming={streamingId === m.id}
              streamText={streamText}
              onRetry={() => void retry(m)}
              onCopy={() => {
                void navigator.clipboard.writeText(m.content)
                toast('已复制')
              }}
            />
          ))}
        </div>
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-outline/70 p-3">
        <div className="max-w-[760px] mx-auto card flex items-end gap-2 px-3 py-2 focus-within:border-primary/50 transition-colors">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
            rows={Math.min(5, draft.split('\n').length)}
            placeholder={source ? '已带入来源上下文，直接发送即可…' : '给 AI 发消息…（Enter 发送，Shift+Enter 换行）'}
            className="flex-1 bg-transparent outline-none resize-none text-[14px] leading-relaxed py-1.5 min-h-[36px] max-h-32"
          />
          <button
            aria-label="发送"
            onClick={() => void send()}
            disabled={!draft.trim()}
            className="grid place-items-center w-9 h-9 rounded-[10px] bg-primary text-on-primary disabled:opacity-40 shrink-0 cursor-pointer"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({
  msg, isStreaming, streamText, onRetry, onCopy,
}: {
  msg: AiMessage
  isStreaming: boolean
  streamText: string
  onRetry: () => void
  onCopy: () => void
}) {
  const shown = isStreaming ? streamText : msg.content
  const badge = STATE_BADGE[msg.state]
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[16px] rounded-br-[6px] bg-primary text-on-primary px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap break-words">
          {msg.content}
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] card px-3.5 py-2.5">
        {msg.role === 'assistant' && msg.model && (
          <p className="text-[10.5px] text-on-surface-2 mb-1 flex items-center gap-1">
            <Sparkles size={10} /> {msg.model}
            {badge.label && !isStreaming && (
              <span className={cn('px-1.5 py-0.5 rounded-full text-[10px]', badge.cls)}>{badge.label}</span>
            )}
          </p>
        )}
        <div className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">
          {shown || (isStreaming ? '' : (msg.error ? `⚠️ ${msg.error}` : '（空）'))}
          {isStreaming && <span className="inline-block w-[2px] h-4 bg-primary align-[-2px] ml-0.5 animate-ai-pulse" />}
        </div>
        {!isStreaming && (msg.state === 'done' || msg.state === 'cancelled') && shown && (
          <div className="flex items-center gap-2 mt-1.5 text-on-surface-2">
            <button aria-label="复制" onClick={onCopy} className="hover:text-on-surface cursor-pointer"><Copy size={12} /></button>
            <span className="text-[10.5px]">
              {msg.tokensOut != null ? `${msg.tokensOut} tokens` : ''}
              {msg.latencyMs ? ` · ${(msg.latencyMs / 1000).toFixed(1)}s` : ''}
            </span>
          </div>
        )}
        {msg.state === 'failed' && (
          <div className="flex items-center gap-2 mt-2">
            <Button size="sm" variant="outline" onClick={onRetry}><RefreshCw size={12} /> 重试</Button>
            {msg.content && <span className="text-[11px] text-on-surface-2">已保留部分生成内容</span>}
          </div>
        )}
      </div>
    </div>
  )
}
