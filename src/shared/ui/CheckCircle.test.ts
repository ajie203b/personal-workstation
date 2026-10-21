// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CheckCircle } from './CheckCircle'

vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.documentElement.classList.remove('no-motion')
  vi.unstubAllGlobals()
})

describe('task completion feedback', () => {
  it('commits immediately instead of waiting for the visual effect', () => {
    const complete = vi.fn()
    act(() => root.render(createElement(CheckCircle, { checked: false, onChange: complete })))
    act(() => container.querySelector('button')!.click())
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('does not lose completion when the task row unmounts immediately', () => {
    const complete = vi.fn()
    act(() => root.render(createElement(CheckCircle, { checked: false, onChange: complete })))
    act(() => {
      container.querySelector('button')!.click()
      root.render(null)
    })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('also commits immediately when application motion is disabled', () => {
    document.documentElement.classList.add('no-motion')
    const complete = vi.fn()
    act(() => root.render(createElement(CheckCircle, { checked: false, onChange: complete })))
    act(() => container.querySelector('button')!.click())
    expect(complete).toHaveBeenCalledTimes(1)
  })
})
