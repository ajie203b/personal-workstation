import QRCodeStyling, { type Options } from 'qr-code-styling'
import { blobToImageData, decodeWithJsQr } from './qrScan'

/**
 * 二维码生成侧：把「内容 + 样式」变成 qr-code-styling 的配置，
 * 负责预览渲染、PNG/SVG 导出与生成后的 jsQR 容错自检。
 */

export type QrDotType = 'dots' | 'rounded' | 'square'
export type QrEyeType = 'dot' | 'extra-rounded' | 'square'
export type QrEyeDotType = 'dot' | 'square'

export interface QrStyle {
  dotType: QrDotType
  /** 码眼外框形状 */
  eyeType: QrEyeType
  /** 码眼中心点形状 */
  eyeDotType: QrEyeDotType
  gradient: boolean
  /** 主色；空字符串 = 跟随当前强调色 --primary */
  color: string
  /** 渐变终点色；空字符串 = 从主色自动派生一档亮色 */
  gradientColor: string
  /** 中间 Logo（data URL）；空 = 不加 */
  logo: string | null
}

/** Logo 边长占比上限：0.2 → 面积占比 4%，即使按「面积不超过 20%」的口径也合规 */
const LOGO_IMAGE_SIZE = 0.2

/* ---------------- 颜色工具（纯函数） ---------------- */

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** WCAG 相对亮度，0=全黑 1=全白 */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  const lin = rgb.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

/**
 * 把颜色压暗到可扫描的亮度（深色主题的 --primary 是浅色，直接当码色会白底浅码扫不出）。
 * 只降亮度、不动色相；非 hex 输入原样返回，交给自检兜底。
 */
export function qrSafeColor(hex: string, maxLuminance = 0.36): string {
  const trimmed = hex.trim()
  const rgb = parseHex(trimmed)
  if (!rgb) return trimmed
  let [r, g, b] = rgb
  let scale = 1
  while (relativeLuminance(toHex(r, g, b)) > maxLuminance && scale > 0.02) {
    scale -= 0.06
    r = rgb[0] * scale
    g = rgb[1] * scale
    b = rgb[2] * scale
  }
  // 本来就够深就保留原写法，只在压暗过才重建 hex
  return scale === 1 ? trimmed : toHex(r, g, b)
}

/** 提亮（或压暗）一个 hex 颜色，amount 为 -1~1 的相对幅度 */
export function shadeHex(hex: string, amount: number): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex.trim()
  const f = amount >= 0 ? 255 : 0
  const t = Math.abs(amount)
  return toHex(rgb[0] + (f - rgb[0]) * t, rgb[1] + (f - rgb[1]) * t, rgb[2] + (f - rgb[2]) * t)
}

/** 读当前强调色（--primary）。拿不到时退一个稳的深蓝 */
export function readPrimaryColor(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
  return v || '#2C55B8'
}

/** 解析「跟随强调色」的默认主色 */
function resolveBaseColor(style: QrStyle): string {
  return style.color.trim() ? style.color.trim() : qrSafeColor(readPrimaryColor())
}

/* ---------------- 配置构建 ---------------- */

/**
 * 内容 → 二维码字节串。
 *
 * qr-code-styling 底层 qrcode-generator 的默认 stringToBytes 是 `charCodeAt(i) & 0xff`
 * （Latin-1 截断），中文会被编成错误字节，扫出来是乱码甚至空。先把内容转成
 * UTF-8 字节的二进制串（每个字符即一个字节），Byte 模式写入的才是正确 UTF-8 字节，
 * jsQR / 微信等按 UTF-8 解码即可还原原文。纯 ASCII 内容不受影响。
 */
export function toQrByteString(content: string): string {
  return Array.from(new TextEncoder().encode(content), (b) => String.fromCharCode(b)).join('')
}

/** 把内容 + 样式变成 qr-code-styling 配置；size 是导出/预览的边长像素 */
export function buildQrOptions(content: string, style: QrStyle, size: number): Options {
  const base = resolveBaseColor(style)
  // 用户显式选的色原样用（自检会提示扫不出）；自动派生的终点色保底压到可扫亮度
  const end = style.gradientColor.trim() ? style.gradientColor.trim() : shadeHex(base, 0.22)
  const withLogo = Boolean(style.logo)

  const fill = style.gradient
    ? {
        gradient: {
          type: 'linear' as const,
          rotation: 0,
          colorStops: [
            { offset: 0, color: base },
            { offset: 1, color: end },
          ],
        },
        color: base,
      }
    : { color: base }

  return {
    type: 'canvas',
    width: size,
    height: size,
    margin: Math.max(4, Math.round(size / 64)),
    data: toQrByteString(content),
    qrOptions: {
      // 加 Logo 时强制最高容错：Logo 会盖住中间的码点
      errorCorrectionLevel: withLogo ? 'H' : 'M',
    },
    ...(withLogo
      ? {
          image: style.logo as string,
          imageOptions: {
            hideBackgroundDots: true,
            imageSize: LOGO_IMAGE_SIZE,
            margin: Math.max(2, Math.round(size / 128)),
          },
        }
      : {}),
    dotsOptions: { type: style.dotType, ...fill },
    cornersSquareOptions: { type: style.eyeType, ...fill },
    cornersDotOptions: { type: style.eyeDotType, ...fill },
    backgroundOptions: { color: '#ffffff' },
  }
}

/** 二维码模块矩阵（qr-code-styling 内部的 qrcode-generator 模型） */
export interface QrModuleMatrix {
  getModuleCount(): number
  isDark(row: number, col: number): boolean
}

export interface SyntheticImageData {
  data: Uint8ClampedArray
  width: number
  height: number
}

/**
 * 按模块矩阵合成像素位图（方块点型的等价像素）。
 * 生产自检走真实 canvas 渲染；这个出口给无 canvas 环境（jsdom 测试）做内容往返验证。
 */
export function matrixToImageData(matrix: QrModuleMatrix, scale = 4, quiet = 4): SyntheticImageData {
  const count = matrix.getModuleCount()
  const width = (count + quiet * 2) * scale
  const data = new Uint8ClampedArray(width * width * 4).fill(255)
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!matrix.isDark(row, col)) continue
      const x0 = (col + quiet) * scale
      const y0 = (row + quiet) * scale
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = ((y0 + dy) * width + x0 + dx) * 4
          data[i] = 0
          data[i + 1] = 0
          data[i + 2] = 0
        }
      }
    }
  }
  return { data, width, height: width }
}

/* ---------------- 自检与导出 ---------------- */

export type SelfCheckResult = 'ok' | 'unreadable' | 'mismatch'

/**
 * 容错自检：把样式渲染结果（含点型与 Logo）画到 canvas，交给 jsQR 试扫。
 * 扫不出 / 扫出的内容对不上都要明确报出来——Logo 压住关键区域时内容可能被破坏。
 */
export async function selfCheckQr(options: Options, expect: string): Promise<SelfCheckResult> {
  const qr = new QRCodeStyling(options)
  const blob = (await qr.getRawData('png')) as Blob | null
  if (!blob) return 'unreadable'
  const imageData = await blobToImageData(blob)
  const decoded = await decodeWithJsQr(imageData)
  if (decoded === null) return 'unreadable'
  return decoded === expect ? 'ok' : 'mismatch'
}

/** 生成导出用实例并取原始数据；extension 决定 png / svg */
export async function renderQrBlob(content: string, style: QrStyle, size: number, extension: 'png' | 'svg'): Promise<Blob> {
  const options = buildQrOptions(content, style, size)
  const qr = new QRCodeStyling(extension === 'svg' ? { ...options, type: 'svg' } : options)
  const blob = (await qr.getRawData(extension)) as Blob | null
  if (!blob) throw new Error('二维码渲染失败')
  return blob
}

/** 导出文件名：qrcode-20261022-1530.png 这样，一眼看出时间 */
export function qrFileName(ext: string): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `qrcode-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`
}
