import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Update } from '@tauri-apps/plugin-updater'
import type { AvailableUpdate } from '@/lib/appUpdateClient'
import { useAppUpdate } from './appUpdate'

function desktopUpdate(version: string) {
  const close = vi.fn().mockResolvedValue(undefined)
  const update: AvailableUpdate = {
    platform: 'desktop', version, currentVersion: '3.3.5', notes: '',
    tauriUpdate: { close } as unknown as Update,
  }
  return { update, close }
}

beforeEach(() => {
  useAppUpdate.setState({ update: null, open: false, busy: false })
})

describe('update handle ownership', () => {
  it('keeps an active installation handle when a later check supplies another update', () => {
    const active = desktopUpdate('3.4.0')
    const late = desktopUpdate('3.4.0')
    useAppUpdate.getState().show(active.update)
    useAppUpdate.getState().setBusy(true)

    useAppUpdate.getState().show(late.update)

    expect(useAppUpdate.getState().update).toBe(active.update)
    expect(active.close).not.toHaveBeenCalled()
    expect(late.close).toHaveBeenCalledOnce()
  })

  it('does not dispose the active handle when the same result is shown again', () => {
    const active = desktopUpdate('3.4.0')
    useAppUpdate.getState().show(active.update)
    useAppUpdate.getState().setBusy(true)
    useAppUpdate.getState().show(active.update)
    expect(useAppUpdate.getState().update).toBe(active.update)
    expect(active.close).not.toHaveBeenCalled()
  })

  it('releases an old idle handle when it can safely accept a replacement', () => {
    const old = desktopUpdate('3.4.0')
    const replacement = desktopUpdate('3.5.0')
    useAppUpdate.getState().show(old.update)
    useAppUpdate.getState().setBusy(true)
    useAppUpdate.getState().setBusy(false)
    useAppUpdate.getState().show(replacement.update)
    expect(useAppUpdate.getState().update).toBe(replacement.update)
    expect(old.close).toHaveBeenCalledOnce()
    expect(replacement.close).not.toHaveBeenCalled()
  })
})
