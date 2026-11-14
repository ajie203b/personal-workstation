// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearMdDraft, mdDraftKey, readMdDraft, writeMdDraft } from './mdDraft'
import { guardNavigation, registerUnsavedGuard } from '@/lib/unsavedGuard'

beforeEach(() => {
  localStorage.clear()
  window.location.hash = '#/docs/edit/doc-1'
})

afterEach(() => {
  localStorage.clear()
})

describe('mdDraft storage helpers', () => {
  it('writes, reads, and clears drafts with distinct keys per document', () => {
    const keyNew = mdDraftKey(undefined)
    const keyDoc = mdDraftKey('doc-1')
    expect(keyNew).not.toBe(keyDoc)

    expect(writeMdDraft(keyDoc, { title: '草稿标题', markdown: '# 正文', savedAt: 1000, baseHash: 'abc' })).toBe(true)
    expect(readMdDraft(keyDoc)).toEqual({ title: '草稿标题', markdown: '# 正文', savedAt: 1000, baseHash: 'abc' })
    expect(readMdDraft(keyNew)).toBeNull()

    clearMdDraft(keyDoc)
    expect(readMdDraft(keyDoc)).toBeNull()
  })

  it('ignores malformed JSON and returns false gracefully when storage throws', () => {
    const key = mdDraftKey('broken')
    localStorage.setItem(key, '{bad-json')
    expect(readMdDraft(key)).toBeNull()

    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    expect(writeMdDraft(key, { title: 'T', markdown: 'M', savedAt: 1 })).toBe(false)
    spy.mockRestore()
  })
})

describe('unsavedGuard navigation & link interception', () => {
  it('blocks programmatic guardNavigation when dirty and runs deferred callback cleanly', () => {
    let dirty = true
    let deferred: (() => void) | null = null
    const unregister = registerUnsavedGuard((proceed) => {
      if (!dirty) return false
      deferred = proceed
      return true
    }, vi.fn())

    const onProceed = vi.fn()
    guardNavigation(onProceed)
    expect(onProceed).not.toHaveBeenCalled()
    expect(deferred).not.toBeNull()

    deferred!()
    expect(onProceed).toHaveBeenCalledTimes(1)

    dirty = false
    guardNavigation(onProceed)
    expect(onProceed).toHaveBeenCalledTimes(2)
    unregister()
  })

  it('intercepts hash NavLink clicks only when guard is active and dirty', () => {
    let dirty = true
    let deferred: (() => void) | null = null
    const navigate = vi.fn()
    const unregister = registerUnsavedGuard((proceed) => {
      if (!dirty) return false
      deferred = proceed
      return true
    }, navigate)

    const link = document.createElement('a')
    link.setAttribute('href', '#/tasks')
    document.body.appendChild(link)

    const blockedEvt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(blockedEvt)
    expect(blockedEvt.defaultPrevented).toBe(true)
    expect(deferred).not.toBeNull()
    expect(navigate).not.toHaveBeenCalled()
    deferred!()
    expect(navigate).toHaveBeenCalledWith('/tasks')

    // Modified clicks (open in new tab) are never intercepted
    const ctrlEvt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true })
    link.dispatchEvent(ctrlEvt)
    expect(ctrlEvt.defaultPrevented).toBe(false)

    // Clean state lets clicks through natively
    dirty = false
    const cleanEvt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(cleanEvt)
    expect(cleanEvt.defaultPrevented).toBe(false)

    link.remove()
    unregister()
  })
})
