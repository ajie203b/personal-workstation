import { useUi } from '@/stores/ui'
import { isNative } from '@/lib/native'

export type HapticKind = 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error'

/**
 * 跨端触觉反馈：安卓壳内走 Capacitor Haptics，网页端回退 navigator.vibrate
 * （iOS Safari 无振动 API，静默跳过）。
 * 全部 fire-and-forget：反馈等一帧就不叫反馈了。
 */
let cached: typeof import('@capacitor/haptics') | null = null

async function nativeHaptic(kind: HapticKind): Promise<void> {
  const { Haptics, ImpactStyle, NotificationType } = (cached ??= await import('@capacitor/haptics'))
  switch (kind) {
    case 'selection':
      await Haptics.selectionChanged()
      return
    case 'success':
      await Haptics.notification({ type: NotificationType.Success })
      return
    case 'warning':
      await Haptics.notification({ type: NotificationType.Warning })
      return
    case 'error':
      await Haptics.notification({ type: NotificationType.Error })
      return
    case 'heavy':
      await Haptics.impact({ style: ImpactStyle.Heavy })
      return
    case 'medium':
      await Haptics.impact({ style: ImpactStyle.Medium })
      return
    default:
      await Haptics.impact({ style: ImpactStyle.Light })
  }
}

/** 网页端振动模式（毫秒），与原生档位语义对齐 */
const VIBE: Record<HapticKind, number | number[]> = {
  light: 8,
  medium: 16,
  heavy: 26,
  selection: 5,
  success: [10, 40, 12],
  warning: [14, 30, 14],
  error: [30, 40, 30],
}

export function haptic(kind: HapticKind = 'light'): void {
  if (!useUi.getState().haptics) return
  try {
    if (isNative()) {
      void nativeHaptic(kind).catch(() => navigator.vibrate?.(VIBE[kind]))
      return
    }
    navigator.vibrate?.(VIBE[kind])
  } catch {
    /* 没有反馈能力也不能影响功能 */
  }
}
