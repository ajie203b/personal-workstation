/**
 * JPEG EXIF 方向（v3.3.3）：纯函数解析 + 变换矩阵，供证件照选图「真正」转正。
 *
 * 为什么不再只靠 createImageBitmap(file, { imageOrientation: 'from-image' })：
 * 各版本 Chromium / 安卓 WebView 对它的处理不一致（有的忽略 EXIF、有的老版本
 * 不认识 'from-image' 这个枚举直接抛错），结果就是「UI 说会转正，实际没转」。
 * 现在的做法是确定性的：自己读出 Orientation，把副本里的 Orientation 改成 1
 * （让浏览器一律按原始像素解码），再用下面的矩阵自己画正。
 */

export interface ExifOrientationInfo {
  /** 1~8，EXIF 标准取值 */
  orientation: number
  /** Orientation 值（2 字节 SHORT）在文件里的字节偏移，用于改写 */
  valueOffset: number
  /** TIFF 头是否小端 */
  littleEndian: boolean
}

/** 读 JPEG 的 EXIF Orientation；不是 JPEG / 没有 EXIF / 没这个标签返回 null */
export function readJpegOrientation(bytes: Uint8Array): ExifOrientationInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let off = 2
  while (off + 4 <= bytes.length) {
    if (bytes[off] !== 0xff) return null
    const marker = bytes[off + 1]
    // SOS / EOI 之后没有元数据了
    if (marker === 0xda || marker === 0xd9) return null
    const segLen = view.getUint16(off + 2)
    if (segLen < 2) return null
    if (marker === 0xe1 && off + 10 <= bytes.length) {
      // "Exif\0\0"
      const isExif =
        bytes[off + 4] === 0x45 && bytes[off + 5] === 0x78 && bytes[off + 6] === 0x69 && bytes[off + 7] === 0x66 &&
        bytes[off + 8] === 0 && bytes[off + 9] === 0
      if (isExif) {
        const tiff = off + 10
        if (tiff + 8 > bytes.length) return null
        const le = view.getUint16(tiff) === 0x4949
        const u16 = (p: number) => view.getUint16(p, le)
        const u32 = (p: number) => view.getUint32(p, le)
        const ifd0 = tiff + u32(tiff + 4)
        if (ifd0 + 2 > bytes.length) return null
        const count = u16(ifd0)
        for (let i = 0; i < count; i++) {
          const entry = ifd0 + 2 + i * 12
          if (entry + 12 > bytes.length) return null
          if (u16(entry) === 0x0112) {
            const orientation = u16(entry + 8)
            if (orientation < 1 || orientation > 8) return null
            return { orientation, valueOffset: entry + 8, littleEndian: le }
          }
        }
        return null
      }
    }
    off += 2 + segLen
  }
  return null
}

/** 返回把 Orientation 改成 1 的副本（原数组不动） */
export function resetJpegOrientation(bytes: Uint8Array, info: ExifOrientationInfo): Uint8Array {
  const copy = bytes.slice()
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength)
  view.setUint16(info.valueOffset, 1, info.littleEndian)
  return copy
}

/**
 * 按 EXIF 方向把 rawW×rawH 的原始像素画正：返回输出尺寸与 ctx.setTransform(a,b,c,d,e,f)。
 * 画法：setTransform 后 drawImage(raw, 0, 0)。
 */
export function orientationTransform(
  orientation: number,
  rawW: number,
  rawH: number,
): { width: number; height: number; matrix: [number, number, number, number, number, number] } {
  switch (orientation) {
    case 2:
      return { width: rawW, height: rawH, matrix: [-1, 0, 0, 1, rawW, 0] }
    case 3:
      return { width: rawW, height: rawH, matrix: [-1, 0, 0, -1, rawW, rawH] }
    case 4:
      return { width: rawW, height: rawH, matrix: [1, 0, 0, -1, 0, rawH] }
    case 5:
      return { width: rawH, height: rawW, matrix: [0, 1, 1, 0, 0, 0] }
    case 6:
      return { width: rawH, height: rawW, matrix: [0, 1, -1, 0, rawH, 0] }
    case 7:
      return { width: rawH, height: rawW, matrix: [0, -1, -1, 0, rawH, rawW] }
    case 8:
      return { width: rawH, height: rawW, matrix: [0, -1, 1, 0, 0, rawW] }
    default:
      return { width: rawW, height: rawH, matrix: [1, 0, 0, 1, 0, 0] }
  }
}

/** 把原始像素坐标按矩阵映射到输出坐标（单测/调试用） */
export function applyMatrix(m: [number, number, number, number, number, number], x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}
