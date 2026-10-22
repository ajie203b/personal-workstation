// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type Annotation, type Doc } from '@/db/db'
import { useDocAnnotations } from './useDocAnnotations'

// Notification scheduling is a native boundary, unrelated to the persisted source link.
vi.mock('@/lib/notify', () => ({ syncTaskNotification: async () => undefined }))

let root: Root
let container: HTMLDivElement

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  await db.delete()
  await db.open()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  act(() => root.unmount())
  container.remove()
  await db.delete()
})

describe('creating a task from a reading annotation', () => {
  it('persists the EPUB chapter locator and full excerpt on the created task', async () => {
    const doc: Doc = {
      id: 'epub-document', hash: 'epub-content', kind: 'epub', title: '阅读材料', size: 1, addedAt: 1,
    }
    const annotation: Annotation = {
      id: 'chapter-highlight', docHash: doc.hash, blockIdx: 1,
      text: '第一章摘录\n\n下一章摘录', color: 'green', createdAt: 1,
    }
    let actions: ReturnType<typeof useDocAnnotations> | undefined
    function Harness() {
      actions = useDocAnnotations({
        doc, selection: null, clearSelection: vi.fn(), toast: vi.fn(), onExported: vi.fn(),
      })
      return null
    }
    act(() => root.render(createElement(Harness)))
    act(() => actions!.task.open(annotation))
    act(() => actions!.task.setTitle('跟进阅读摘录'))

    await act(async () => actions!.task.submit())

    const tasks = await db.tasks.toArray()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      title: '跟进阅读摘录',
      notes: `批注：${annotation.text}`,
      docRef: { docId: doc.id, label: doc.title, anchor: `f1#${annotation.id}` },
    })
  })
})
