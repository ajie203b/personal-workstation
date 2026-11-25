/** 判断当前环境是否为 Apple 平台（macOS / iOS / iPadOS），用于展示对应的修饰键符号 */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '')
}

/** 生成平台匹配的修饰快捷键文案，例如 macOS 显示 `⌘K`，Windows/Linux 显示 `Ctrl K` */
export function modKeyLabel(key: string): string {
  return isApplePlatform() ? `⌘${key}` : `Ctrl ${key}`
}
