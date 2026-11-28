// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TopProgressLine } from './TopProgressLine'

describe('TopProgressLine', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    container.remove()
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it('renders nothing when inactive', async () => {
    await act(async () => {
      root.render(React.createElement(TopProgressLine, { active: false, progress: 0.5 }))
    })
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('renders determinate scaleX hairline with aria-valuenow', async () => {
    await act(async () => {
      root.render(React.createElement(TopProgressLine, {
        active: true,
        progress: 0.42,
        label: '媒体下载进度',
      }))
    })
    const bar = container.querySelector<HTMLElement>('[role="progressbar"]')
    expect(bar).not.toBeNull()
    expect(bar?.getAttribute('aria-label')).toBe('媒体下载进度')
    expect(bar?.getAttribute('aria-valuenow')).toBe('42')
    const inner = bar?.firstElementChild as HTMLElement | null
    expect(inner?.style.transform).toBe('scaleX(0.42)')
  })

  it('renders smooth indeterminate sliding bar when progress is null or omitted', async () => {
    await act(async () => {
      root.render(React.createElement(TopProgressLine, { active: true, progress: null }))
    })
    const bar = container.querySelector<HTMLElement>('[role="progressbar"]')
    expect(bar).not.toBeNull()
    expect(bar?.getAttribute('aria-valuenow')).toBeNull()
    expect(bar?.querySelector('.top-progress-indeterminate')).not.toBeNull()
  })

  it('applies danger/ok tones and sticky/fixed placements', async () => {
    await act(async () => {
      root.render(React.createElement(TopProgressLine, {
        active: true,
        progress: 1,
        tone: 'danger',
        placement: 'sticky',
      }))
    })
    const bar = container.querySelector<HTMLElement>('[role="progressbar"]')
    expect(bar?.className).toContain('sticky')
    expect(bar?.firstElementChild?.className).toContain('bg-danger')
  })
})
