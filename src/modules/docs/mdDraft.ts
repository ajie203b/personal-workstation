/**
 * Markdown 编辑器本地草稿持久化，防意外刷新 / 崩溃丢失未保存内容。
 */
export interface MdDraft {
  title: string
  markdown: string
  savedAt: number
  baseHash?: string
}

const DRAFT_PREFIX = 'app:md-draft:'

export function mdDraftKey(docId?: string): string {
  return `${DRAFT_PREFIX}${docId || 'new'}`
}

export function readMdDraft(key: string): MdDraft | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MdDraft> | null
    if (
      !parsed ||
      typeof parsed.title !== 'string' ||
      typeof parsed.markdown !== 'string' ||
      typeof parsed.savedAt !== 'number'
    ) {
      return null
    }
    return {
      title: parsed.title,
      markdown: parsed.markdown,
      savedAt: parsed.savedAt,
      baseHash: typeof parsed.baseHash === 'string' ? parsed.baseHash : undefined,
    }
  } catch {
    return null
  }
}

export function writeMdDraft(key: string, draft: MdDraft): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    localStorage.setItem(key, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

export function clearMdDraft(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
