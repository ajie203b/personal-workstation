/** PWA 安装：捕获 beforeinstallprompt，供设置页「安装到设备」按钮触发 */

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()

export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    listeners.forEach((fn) => fn())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((fn) => fn())
  })
}

export function canInstall(): boolean {
  return deferred != null
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  await deferred.prompt()
  const { outcome } = await deferred.userChoice
  deferred = null
  listeners.forEach((fn) => fn())
  return outcome === 'accepted'
}

export function onInstallAvailabilityChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
