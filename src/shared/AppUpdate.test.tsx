// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AvailableUpdate, CheckResult } from '@/lib/appUpdateClient'
import { useAppUpdate } from '@/stores/appUpdate'
import { AppUpdateCard, AppUpdateHost } from './AppUpdate'

const client = vi.hoisted(() => ({
  check: vi.fn(),
  install: vi.fn(),
  dispose: vi.fn(),
}))

// Keep React, the update store and the real settings switch/dialog together;
// only the platform/network boundary is replaced.
vi.mock('@/lib/appUpdateClient', () => ({
  checkAppUpdate: client.check,
  installAppUpdate: client.install,
  disposeUpdate: client.dispose,
  supportsInAppUpdate: () => true,
  getUpdatePlatform: () => 'desktop',
  getCurrentAppVersion: () => '3.3.5',
  getAutoCheckEnabled: () => localStorage.getItem('kairos.update.autoCheck') !== '0',
  setAutoCheckEnabled: (enabled: boolean) => localStorage.setItem('kairos.update.autoCheck', enabled ? '1' : '0'),
  shouldAutoCheckNow: () => localStorage.getItem('kairos.update.autoCheck') !== '0',
  canInstallPackages: async () => false,
}))

vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const availableUpdate: AvailableUpdate = {
  platform: 'desktop',
  version: '3.4.0',
  currentVersion: '3.3.5',
  notes: '更新测试',
}

describe('AppUpdateHost automatic-check preference', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.clearAllMocks()
    localStorage.clear()
    useAppUpdate.setState({ update: null, open: false, busy: false })
    client.check.mockResolvedValue({ status: 'latest', currentVersion: '3.3.5' })
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    container.remove()
    vi.clearAllTimers()
    vi.useRealTimers()
    localStorage.clear()
    useAppUpdate.setState({ update: null, open: false, busy: false })
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  async function renderSettings() {
    await act(async () => {
      root.render(React.createElement(React.Fragment, null,
        React.createElement(AppUpdateHost),
        React.createElement(AppUpdateCard),
      ))
    })
  }

  async function disableAutomaticChecks() {
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')
    expect(toggle?.getAttribute('aria-checked')).toBe('true')
    await act(async () => { toggle!.click() })
    expect(toggle?.getAttribute('aria-checked')).toBe('false')
  }

  async function clickButton(label: string) {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((element) => element.textContent?.trim() === label)
    expect(button, `button ${label} is available`).toBeDefined()
    await act(async () => { button!.click() })
  }

  it('does not check when the user disables automatic checks during the startup delay', async () => {
    await renderSettings()
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })

    await disableAutomaticChecks()
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })

    expect(client.check).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('disposes an unused pending automatic-check result after the user disables automatic checks', async () => {
    const pending = deferred<CheckResult>()
    const unused: AvailableUpdate = {
      ...availableUpdate,
      tauriUpdate: { close: vi.fn() } as unknown as AvailableUpdate['tauriUpdate'],
    }
    client.check.mockReturnValue(pending.promise)
    await renderSettings()
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000) })
    expect(client.check).toHaveBeenCalledTimes(1)

    await disableAutomaticChecks()
    await act(async () => { pending.resolve({ status: 'available', update: unused }) })

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(useAppUpdate.getState().open).toBe(false)
    expect(client.dispose).toHaveBeenCalledExactlyOnceWith(unused)
  })

  it('keeps a shared manual-check result when automatic checks are disabled while both callers wait', async () => {
    const pending = deferred<CheckResult>()
    const shared: AvailableUpdate = {
      ...availableUpdate,
      notes: '自动和手动检查共享的结果',
      tauriUpdate: { close: vi.fn() } as unknown as AvailableUpdate['tauriUpdate'],
    }
    // Host attaches its .then first; the settings click subsequently awaits the
    // same Promise, matching the real client's in-flight request coalescing.
    client.check.mockReturnValue(pending.promise)
    await renderSettings()
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000) })
    expect(client.check).toHaveBeenCalledTimes(1)

    await clickButton('检查更新')
    expect(client.check).toHaveBeenCalledTimes(2)
    await disableAutomaticChecks()
    await act(async () => { pending.resolve({ status: 'available', update: shared }) })

    expect(useAppUpdate.getState().update).toBe(shared)
    expect(useAppUpdate.getState().open).toBe(true)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('自动和手动检查共享的结果')
    expect(client.dispose).not.toHaveBeenCalledWith(shared)
  })

  it('shows an available update after the startup delay when automatic checks remain enabled', async () => {
    client.check.mockResolvedValue({ status: 'available', update: availableUpdate })
    await renderSettings()
    expect(client.check).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(6_000) })

    expect(client.check).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('发现新版本 v3.4.0')
    expect(useAppUpdate.getState().open).toBe(true)
  })

  it('opens and installs the current update after an automatic result replaces the completed manual check', async () => {
    const manual: AvailableUpdate = {
      ...availableUpdate,
      notes: '手动检查 A',
      tauriUpdate: { close: vi.fn() } as unknown as AvailableUpdate['tauriUpdate'],
    }
    const automatic: AvailableUpdate = {
      ...availableUpdate,
      notes: '自动检查 B',
      tauriUpdate: { close: vi.fn() } as unknown as AvailableUpdate['tauriUpdate'],
    }
    client.check
      .mockResolvedValueOnce({ status: 'available', update: manual })
      .mockResolvedValueOnce({ status: 'available', update: automatic })
    client.install.mockResolvedValue('restarting')
    await renderSettings()

    await clickButton('检查更新')
    expect(useAppUpdate.getState().update).toBe(manual)
    await clickButton('稍后')

    await act(async () => { await vi.advanceTimersByTimeAsync(6_000) })
    expect(useAppUpdate.getState().update).toBe(automatic)
    expect(client.dispose).toHaveBeenCalledWith(manual)
    await clickButton('稍后')

    await clickButton('查看更新')
    expect(useAppUpdate.getState().update).toBe(automatic)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('自动检查 B')
    await clickButton('立即更新')
    expect(client.install).toHaveBeenCalledWith(automatic, expect.any(Function))
    expect(client.dispose).not.toHaveBeenCalledWith(automatic)
  })
})
