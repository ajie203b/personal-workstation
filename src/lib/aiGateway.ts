import type { AiMessage, AiProvider } from '@/db/db'

export interface StreamCallbacks {
  onDelta: (text: string) => void
  onUsage: (usage: { tokensIn: number; tokensOut: number }) => void
  onDone?: () => void
  onError: (message: string) => void
}

export interface ChatTurn {
  role: AiMessage['role']
  content: string
}

/** 粗略 token 估算：CJK ≈ 0.6 token/字，其他 ≈ 1/4 token/字符 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) ?? []).length
  return Math.max(1, Math.ceil(cjk * 0.6 + (text.length - cjk) / 4))
}

export function estimateCost(p: AiProvider | undefined, tokensIn: number, tokensOut: number): number {
  if (!p?.pricePrompt || !p?.priceCompletion) return 0
  return (tokensIn / 1e6) * p.pricePrompt + (tokensOut / 1e6) * p.priceCompletion
}

/**
 * OpenAI 兼容流式对话（SSE）。通过 signal 支持随时 Stop；
 * usage 优先用服务端返回值（stream_options.include_usage），缺失时本地估算。
 */
export async function streamChat(
  provider: AiProvider,
  model: string,
  turns: ChatTurn[],
  signal: AbortSignal,
  cb: StreamCallbacks,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: turns.map((t) => ({ role: t.role === 'system' ? 'system' : t.role, content: t.content })),
        stream: true,
        stream_options: { include_usage: true },
      }),
    })
  } catch (e) {
    if (signal.aborted) return
    cb.onError(e instanceof Error ? `网络错误：${e.message}` : '网络错误')
    return
  }

  if (!res.ok || !res.body) {
    let detail = `HTTP ${res.status}`
    try {
      const json = (await res.json()) as { error?: { message?: string } }
      if (json.error?.message) detail = json.error.message
    } catch {
      /* 保留 HTTP 状态码信息 */
    }
    cb.onError(detail)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let usage: { tokensIn: number; tokensOut: number } | null = null

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''
      for (const line of parts) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[]
            usage?: { prompt_tokens?: number; completion_tokens?: number }
          }
          const delta = json.choices?.[0]?.delta?.content
          if (delta) {
            text += delta
            cb.onDelta(delta)
          }
          if (json.usage) {
            usage = {
              tokensIn: json.usage.prompt_tokens ?? 0,
              tokensOut: json.usage.completion_tokens ?? 0,
            }
          }
        } catch {
          /* 忽略无法解析的行 */
        }
      }
    }
    if (!usage) {
      usage = {
        tokensIn: estimateTokens(turns.map((t) => t.content).join('\n')),
        tokensOut: estimateTokens(text),
      }
    }
    cb.onUsage(usage)
    cb.onDone?.()
  } catch (e) {
    if (signal.aborted) {
      // 用户主动 Stop：交出已生成内容与用量
      cb.onUsage(usage ?? { tokensIn: estimateTokens(turns.map((t) => t.content).join('\n')), tokensOut: estimateTokens(text) })
      cb.onDone?.()
      return
    }
    cb.onError(e instanceof Error ? e.message : '流式读取失败')
  }
}
