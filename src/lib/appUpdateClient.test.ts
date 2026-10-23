import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({
  platform: 'desktop' as 'desktop' | 'android',
  check: vi.fn(),
  relaunch: vi.fn(),
  native: {
    checkUpdate: vi.fn(),
    downloadApk: vi.fn(),
    installApk: vi.fn(),
    addListener: vi.fn(),
    canInstallPackages: vi.fn(),
  },
  removeListener: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => boundary.platform },
  registerPlugin: () => boundary.native,
}))
vi.mock('./native', () => ({
  isTauri: () => boundary.platform === 'desktop',
  isNative: () => boundary.platform === 'android',
}))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: boundary.check }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: boundary.relaunch }))

function desktopUpdate() {
  return {
    version: '3.4.0',
    body: 'Update notes',
    close: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
  }
}

function androidUpdate() {
  return {
    platform: 'android' as const,
    version: '3.4.0',
    currentVersion: '3.3.5',
    notes: '',
    apkUrl: 'https://github.com/ajie203b/personal-workstation/releases/download/v3.4.0/personal-workstation-v3.4.0.apk',
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.stubGlobal('__APP_VERSION__', '3.3.5')
  boundary.platform = 'desktop'
  boundary.native.addListener.mockResolvedValue({ remove: boundary.removeListener })
  boundary.removeListener.mockResolvedValue(undefined)
  boundary.native.downloadApk.mockResolvedValue({ path: '/cache/updates/new.apk', size: 10, versionName: '3.4.0' })
  boundary.native.installApk.mockResolvedValue({ status: 'started' })
  boundary.relaunch.mockResolvedValue(undefined)
})

afterEach(() => vi.unstubAllGlobals())

describe('checkAppUpdate concurrency', () => {
  it('shares one desktop check result and native Update handle between overlapping callers', async () => {
    let resolveCheck!: (value: ReturnType<typeof desktopUpdate>) => void
    boundary.check.mockReturnValue(new Promise((resolve) => { resolveCheck = resolve }))
    // Resolve the mocked external module before exercising our request lifecycle.
    await import('@tauri-apps/plugin-updater')
    const { checkAppUpdate } = await import('./appUpdateClient')

    const startupCheck = checkAppUpdate()
    const manualCheck = checkAppUpdate()
    await vi.waitFor(() => expect(boundary.check).toHaveBeenCalled())
    resolveCheck(desktopUpdate())
    const [startupResult, manualResult] = await Promise.all([startupCheck, manualCheck])

    expect(boundary.check).toHaveBeenCalledTimes(1)
    expect(startupResult).toBe(manualResult)
    expect(startupResult.status).toBe('available')
  })

  it('allows a fresh check after a failed shared request', async () => {
    boundary.check.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null)
    const { checkAppUpdate } = await import('./appUpdateClient')
    expect((await checkAppUpdate()).status).toBe('error')
    expect((await checkAppUpdate()).status).toBe('latest')
    expect(boundary.check).toHaveBeenCalledTimes(2)
  })
})

describe('Android update package validation and recovery', () => {
  beforeEach(() => { boundary.platform = 'android' })

  it('passes the advertised target version to download and installation validation', async () => {
    const { installAppUpdate } = await import('./appUpdateClient')
    await expect(installAppUpdate(androidUpdate(), vi.fn())).resolves.toBe('installer-started')
    expect(boundary.native.downloadApk).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: '3.4.0' }))
    expect(boundary.native.installApk).toHaveBeenCalledWith(expect.objectContaining({
      path: '/cache/updates/new.apk', expectedVersion: '3.4.0',
    }))
  })

  it('reuses the downloaded file after permission is granted and revalidates it before installation', async () => {
    boundary.native.installApk.mockResolvedValueOnce({ status: 'needPermission' }).mockResolvedValueOnce({ status: 'started' })
    const { installAppUpdate } = await import('./appUpdateClient')
    const update = androidUpdate()
    await expect(installAppUpdate(update, vi.fn())).resolves.toBe('need-permission')
    await expect(installAppUpdate(update, vi.fn())).resolves.toBe('installer-started')
    expect(boundary.native.downloadApk).toHaveBeenCalledTimes(1)
    expect(boundary.native.installApk).toHaveBeenNthCalledWith(2, expect.objectContaining({
      path: '/cache/updates/new.apk', expectedVersion: '3.4.0',
    }))
  })

  it('downloads again on retry when a cached file is missing or fails native validation', async () => {
    boundary.native.installApk.mockRejectedValueOnce(new Error('安装包不存在，请重新下载'))
      .mockResolvedValueOnce({ status: 'started' })
    const { installAppUpdate } = await import('./appUpdateClient')
    const update = androidUpdate()
    await expect(installAppUpdate(update, vi.fn())).rejects.toThrow('安装包不存在')
    await expect(installAppUpdate(update, vi.fn())).resolves.toBe('installer-started')
    expect(boundary.native.downloadApk).toHaveBeenCalledTimes(2)
  })

  it('removes progress listeners on download failure and permits a new download', async () => {
    boundary.native.downloadApk.mockRejectedValueOnce(new Error('下载验证失败'))
      .mockResolvedValueOnce({ path: '/cache/updates/retry.apk', size: 10, versionName: '3.4.0' })
    const { installAppUpdate } = await import('./appUpdateClient')
    const update = androidUpdate()
    await expect(installAppUpdate(update, vi.fn())).rejects.toThrow('下载验证失败')
    expect(boundary.removeListener).toHaveBeenCalledTimes(1)
    await expect(installAppUpdate(update, vi.fn())).resolves.toBe('installer-started')
    expect(boundary.native.installApk).toHaveBeenCalledWith(expect.objectContaining({ path: '/cache/updates/retry.apk' }))
    expect(boundary.removeListener).toHaveBeenCalledTimes(2)
  })
})
