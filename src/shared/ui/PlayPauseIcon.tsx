import { cn } from '@/lib/cn'

/**
 * 播放 ⇄ 暂停的图标变形（ui-motion 38「Play ⇄ Pause Morph」）。
 *
 * 不是两个图标硬切：左边那根竖条在「播放」态被 clip-path 削成三角形并横向拉宽，
 * 右边那根同时横向收成 0 —— 像同一块图形被捏成另一个形状。
 * 两根都是 4 顶点多边形，clip-path 才能插值；只动 transform / clip-path，不触发重排。
 */
export function PlayPauseIcon({ playing, size = 20, className }: { playing: boolean; size?: number; className?: string }) {
  const barW = Math.round(size * 0.26)
  const barH = Math.round(size * 0.86)
  const gap = Math.round(size * 0.16)
  // 播放态：左条当三角形用，要更宽一点才撑得住视觉重心
  const playWiden = 1.55
  return (
    <span
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: barH }}
      aria-hidden
    >
      <span
        className="absolute rounded-[2px] bg-current"
        style={{
          width: barW,
          height: barH,
          left: `calc(50% - ${(barW + gap / 2) * (playing ? 1 : playWiden / 2)}px)`,
          transformOrigin: 'left center',
          transform: playing ? 'scaleX(1)' : `scaleX(${playWiden})`,
          clipPath: playing
            ? 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)'
            : 'polygon(0% 0%, 100% 50%, 0% 100%, 0% 50%)',
          transition: 'transform 220ms cubic-bezier(.22,.61,.36,1), clip-path 220ms cubic-bezier(.22,.61,.36,1), left 220ms cubic-bezier(.22,.61,.36,1)',
        }}
      />
      <span
        className="absolute rounded-[2px] bg-current"
        style={{
          width: barW,
          height: barH,
          left: `calc(50% + ${gap / 2}px)`,
          transformOrigin: 'left center',
          transform: playing ? 'scaleX(1)' : 'scaleX(0)',
          opacity: playing ? 1 : 0,
          transition: 'transform 220ms cubic-bezier(.22,.61,.36,1), opacity 160ms linear',
        }}
      />
    </span>
  )
}
