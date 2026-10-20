import { isNative } from './native'

/**
 * 外部入口（v2.0）：安卓桌面快捷方式与通知点击都从这里进。
 * - 快捷方式走自定义 scheme：com.personal.workstation://quickadd / today
 * - 通知带 extra.taskId，点开后定位到对应任务详情
 * 冷启动与运行中各有一条路径，统一转换成应用内路由。
 */
export function parseAppUrl(url: string): string | null {
  if (!url) return null
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(url)
  if (!m) return null
  const host = m[1].toLowerCase()
  if (host === 'quickadd') return '/today?quickadd=1'
  if (host === 'today') return '/today'
  return null
}

export function routeForNotification(extra: unknown): string | null {
  if (!extra || typeof extra !== 'object') return null
  const e = extra as { taskId?: unknown; tier?: unknown; focus?: unknown }
  if (typeof e.taskId === 'string' && e.taskId) {
    const tier = typeof e.tier === 'string' ? e.tier : 'today'
    return `/tasks?tier=${tier}&focus=${e.taskId}`
  }
  if (e.focus) return '/today'
  return null
}

/** 注册启动 URL / 运行中深链 / 通知点击；返回清理函数（网页端直接空操作） */
export async function initAppActions(onRoute: (route: string) => void): Promise<() => void> {
  if (!isNative()) return () => {}
  const cleanups: (() => void)[] = []
  const { App } = await import('@capacitor/app')

  try {
    const launch = await App.getLaunchUrl()
    const route = launch?.url ? parseAppUrl(launch.url) : null
    if (route) onRoute(route)
  } catch { /* 没有启动 URL */ }

  const urlHandle = await App.addListener('appUrlOpen', ({ url }) => {
    const route = parseAppUrl(url)
    if (route) onRoute(route)
  })
  cleanups.push(() => { void urlHandle.remove() })

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const notifHandle = await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      const route = routeForNotification(action.notification.extra)
      if (route) onRoute(route)
    })
    cleanups.push(() => { void notifHandle.remove() })
  } catch { /* 通知插件不可用时不影响其它入口 */ }

  return () => cleanups.forEach((fn) => fn())
}
