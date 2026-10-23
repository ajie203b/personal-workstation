// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import { AddTaskSheet } from './AddTaskSheet'

vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))
vi.mock('@/lib/notify', () => ({ syncTaskNotification: vi.fn() }))

let root: Root
let container: HTMLDivElement

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(callback, 0))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
  // Freeze the user's local date while keeping IndexedDB and focus timers real.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 22, 15, 25))
  await db.delete()
  await db.open()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(createElement(AddTaskSheet, {
    open: true,
    onOpenChange: vi.fn(),
  })))
})

afterEach(async () => {
  act(() => root.unmount())
  container.remove()
  await db.delete()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function edit(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function taskText() {
  return document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!
}

function dateField(label: string) {
  return document.querySelector<HTMLButtonElement>(`button[aria-label="${label}日期"]`)!
}

function timeButton(label: string) {
  return dateField(label).parentElement!.parentElement!.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]:not([aria-label])')!
}

function chooseDate(label: string, day: string) {
  act(() => dateField(label).click())
  const date = new Date(`${day}T00:00`)
  const aria = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
  act(() => document.querySelector<HTMLButtonElement>(`[data-date-panel] button[aria-label="${aria}"]`)!.click())
}

async function saveTask() {
  const save = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
    .find((button) => ['添加任务', '添加打卡任务'].includes(button.textContent?.trim() ?? ''))!
  await act(async () => {
    save.click()
    await vi.waitFor(async () => expect(await db.tasks.count()).toBe(1))
  })
  return (await db.tasks.toArray())[0]
}

describe('添加任务的自然语言时间与手动表单', () => {
  it('把识别到的明天 14:00 回填到截止字段，并保持开始字段未设置', () => {
    edit(taskText(), '明天14:00 交报告 P1 #工作')

    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('明天 14:00')
    expect(dateField('截止时间').value).toBe('2026-10-23')
    expect(timeButton('截止时间').textContent).toContain('14:00')
    expect(dateField('开始时间').value).toBe('')
  })

  it('尚未手动改日期时，正文的新日期会继续更新截止字段', () => {
    edit(taskText(), '明天14:00 交报告')
    edit(taskText(), '后天18:00 交报告')

    expect(dateField('截止时间').value).toBe('2026-10-24')
    expect(timeButton('截止时间').textContent).toContain('18:00')
  })

  it('手动覆盖截止日期后，继续修改正文不会重置用户选择', async () => {
    edit(taskText(), '明天14:00 交报告')
    chooseDate('截止时间', '2026-10-30')
    act(() => timeButton('截止时间').click())
    const preset = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === '18:00')!
    act(() => preset.click())
    edit(taskText(), '后天10:00 交最终报告 P1 #工作')

    expect(dateField('截止时间').value).toBe('2026-10-30')
    expect(timeButton('截止时间').textContent).toContain('18:00')
    const task = await saveTask()
    expect(task).toMatchObject({ due: '2026-10-30', dueTime: '18:00', title: '交最终报告' })
  })

  it('用户没有设置开始时间时，保存的数据不补创建时间', async () => {
    edit(taskText(), '整理桌面')

    const task = await saveTask()

    expect(task.startAt).toBeUndefined()
    expect(task.due).toBeUndefined()
  })

  it('重复任务也以用户手动选择的截止时间为准', async () => {
    edit(taskText(), '每天8点喝水')
    chooseDate('截止时间', '2026-10-30')
    act(() => timeButton('截止时间').click())
    const preset = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === '18:00')!
    act(() => preset.click())

    const save = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((button) => button.textContent?.trim() === '添加打卡任务')!
    await act(async () => {
      save.click()
      await vi.waitFor(async () => expect(await db.tasks.count()).toBe(1))
    })
    expect((await db.tasks.toArray())[0]).toMatchObject({ due: '2026-10-30', dueTime: '18:00', repeat: 'daily' })
  })

  it('用户手动选的开始日期按本地时间保存', async () => {
    edit(taskText(), '整理桌面')
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="时间设置"]')!.click())
    chooseDate('开始时间', '2026-10-24')

    const task = await saveTask()

    expect(task.startAt).toBe(new Date(2026, 9, 24, 0, 0).getTime())
  })

  it('无时间描述默认收起；识别后自动展开；可手动收起', () => {
    const toggle = document.querySelector<HTMLButtonElement>('button[aria-label="时间设置"]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    edit(taskText(), '整理桌面')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    edit(taskText(), '星期5下午三点二十分整理桌面')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(timeButton('截止时间').textContent).toContain('15:20')
    act(() => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    edit(taskText(), '星期6下午四点整理桌面')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    edit(taskText(), '整理桌面')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('自动识别的打卡时间点可以清空，不会在保存时重新回填', async () => {
    edit(taskText(), '每天8点喝水')
    const remove = document.querySelector<HTMLButtonElement>('button[aria-label="移除 08:00"]')!
    act(() => remove.click())
    const task = await saveTask()
    expect(task.dueTime).toBeUndefined()
    expect(task.repeatTimes).toBeUndefined()
  })
})
