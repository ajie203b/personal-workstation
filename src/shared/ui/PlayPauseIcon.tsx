import { cn } from '@/lib/cn'

/**
 * 播放 ⇄ 暂停图标（v3.2）。
 *
 * 播放键以居中的等边三角形为基础，用同色圆角描边柔化三个尖角。
 *
 * 尺寸按**黄金分割**：三角形的外接圆直径 = 画布的 0.618（半径 0.309），
 * 等边三角形的边长 = 0.618 × √3/2 ≈ 0.535 × 画布边长。
 * 番茄钟中画布取 32px，播放三角形边长约 17px；外层按钮直径 44px，
 * 与旁边 17px 的重置图标保持接近的视觉大小。
 *
 * 旧实现用 clip-path + scaleX 近似：clip 的百分比参照的是**变换前**的盒子，
 * 再叠加 border-radius 削角，Chromium 里渲染出来的三角既不等边、看着也偏左。
 * 改用 SVG 直接给坐标，等边、居中、比例都是算出来的，不用跟渲染顺序较劲。
 *
 * 暂停键是两根圆角竖条，整体居中；两态之间用淡入 + 轻微缩放衔接
 * （--dur-2 / --ease-standard，与站内其它动效同一套令牌）。
 */

/** 黄金分割：外接圆直径占画布的比例 */
const PHI = 0.618

export function PlayPauseIcon({ playing, size = 20, className }: { playing: boolean; size?: number; className?: string }) {
  const transition = 'opacity var(--dur-2) var(--ease-standard), transform var(--dur-2) var(--ease-spring)'
  // 画布 24 单位；三角形外接圆半径 = 0.309 × 24
  const r = (PHI / 2) * 24
  const cx = 12
  const cy = 12
  // 三个顶点：正右 + 左上 + 左下（等边，外接圆圆心 = 重心 = 画布中心）
  const p1 = `${(cx + r).toFixed(2)} ${cy}`
  const p2 = `${(cx - r / 2).toFixed(2)} ${(cy - (r * Math.sqrt(3)) / 2).toFixed(2)}`
  const p3 = `${(cx - r / 2).toFixed(2)} ${(cy + (r * Math.sqrt(3)) / 2).toFixed(2)}`
  return (
    <span
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* 播放：居中的等边三角形，三个顶点做轻微圆角 */}
      <svg
        viewBox="0 0 24 24"
        className="absolute inset-0 h-full w-full"
        style={{
          opacity: playing ? 0 : 1,
          transform: playing ? 'scale(.78) rotate(-10deg)' : 'scale(1) rotate(0deg)',
          transition,
        }}
      >
        <path
          d={`M${p1} L${p2} L${p3} Z`}
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      {/* 暂停：两根圆角竖条，整体居中 */}
      <svg
        viewBox="0 0 24 24"
        className="absolute inset-0 h-full w-full"
        style={{
          opacity: playing ? 1 : 0,
          transform: playing ? 'scale(1) rotate(0deg)' : 'scale(.78) rotate(10deg)',
          transition,
        }}
      >
        <rect x="7.4" y="6.8" width="3.4" height="10.4" rx="1.3" fill="currentColor" />
        <rect x="13.2" y="6.8" width="3.4" height="10.4" rx="1.3" fill="currentColor" />
      </svg>
    </span>
  )
}
