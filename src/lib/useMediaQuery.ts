import { useEffect, useState } from 'react'

/** 响应式断点判断（tailwind 的 md = 768px）。首帧默认 false，避免桌面端先画一帧手机样式。 */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}
