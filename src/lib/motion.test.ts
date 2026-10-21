// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prefersReducedMotion } from './motion'

afterEach(() => {
  document.documentElement.classList.remove('no-motion')
  vi.unstubAllGlobals()
})

describe('motion preferences', () => {
  it('respects the application motion switch even when system motion is enabled', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    document.documentElement.classList.add('no-motion')
    expect(prefersReducedMotion()).toBe(true)
  })

  it('respects reduced motion requested by the system', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    expect(prefersReducedMotion()).toBe(true)
  })

  it('allows motion when both settings allow it', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    expect(prefersReducedMotion()).toBe(false)
  })
})
