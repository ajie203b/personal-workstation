/**
 * 三模块互跳统一入口（方案 4.4）：模块间零直接 import，
 * 全部走声明式深链 —— 路由参数承载定位上下文，可分享、可回退。
 */
import type { DocRef } from '@/db/db'

function go(path: string) {
  window.location.hash = `#${path}`
}

/** 任务 → 文档工作站：定位到页码/块锚点并闪烁批注 */
export function openDoc(ref: DocRef, hl?: string): void {
  const params = new URLSearchParams()
  if (ref.anchor) params.set('p', ref.anchor)
  const flashId = hl ?? (ref.anchor?.includes('#') ? ref.anchor.split('#')[1] : undefined)
  if (flashId) params.set('hl', flashId)
  go(`/docs/${encodeURIComponent(ref.docId)}${params.size ? `?${params}` : ''}`)
}

/** 文档批注 → 任务清单：预填标题 + 挂载 docRef */
export function openTaskWithRef(ref: DocRef): void {
  const params = new URLSearchParams()
  params.set('presetDoc', JSON.stringify(ref))
  go(`/tasks?${params}`)
}

/** 任务 → AI 面板：带来源上下文发起会话 */
export function openAiWithSource(sourceModule: 'task' | 'doc', sourceId: string): void {
  go(`/ai?src=${sourceModule}:${encodeURIComponent(sourceId)}`)
}

/** AI 运行卡片 → 回到来源 */
export function openSource(src: string): void {
  const [mod, id] = src.split(':')
  if (mod === 'task') go(`/tasks?focus=${encodeURIComponent(id)}`)
  else if (mod === 'doc') go(`/docs/${encodeURIComponent(id)}`)
}
