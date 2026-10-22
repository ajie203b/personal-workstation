/**
 * 测试用极简 PNG 编码器（仅供 *.test.ts 引用，不进应用包）。
 *
 * zlib 流用 DEFLATE「存储块」手写——不依赖 node:zlib（tsconfig 只带 vite/client 类型），
 * 产出的 PNG 是标准格式，pdf-lib 的 embedPng 能严格解析通过。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function adler32(buf: Uint8Array): number {
  let s1 = 1
  let s2 = 0
  for (let i = 0; i < buf.length; i++) {
    s1 = (s1 + buf[i]) % 65521
    s2 = (s2 + s1) % 65521
  }
  return ((s2 << 16) | s1) >>> 0
}

function be32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length)
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i)
  body.set(data, 4)
  const out = new Uint8Array(4 + body.length + 4)
  out.set(be32(data.length), 0)
  out.set(body, 4)
  out.set(be32(crc32(body)), 4 + body.length)
  return out
}

/**
 * 生成纯色（含 alpha）RGBA PNG。
 * @param rgba [r, g, b, a] 各 0~255
 */
export function makePng(width: number, height: number, rgba: [number, number, number, number]): Uint8Array {
  // 每行前缀 filter=0，再是 RGBA 像素
  const raw = new Uint8Array(height * (1 + width * 4))
  let p = 0
  for (let y = 0; y < height; y++) {
    raw[p++] = 0
    for (let x = 0; x < width; x++) {
      raw[p++] = rgba[0]
      raw[p++] = rgba[1]
      raw[p++] = rgba[2]
      raw[p++] = rgba[3]
    }
  }
  // DEFLATE 存储块：0x01=最后一块+BTYPE=00，LEN/NLEN 小端
  const len = raw.length
  const nlen = len ^ 0xffff
  // zlib 头 2 字节 + 块头 1 + LEN/NLEN 4 + 数据 + adler32 4
  const z = new Uint8Array(2 + 5 + len + 4)
  z[0] = 0x78
  z[1] = 0x01
  z[2] = 0x01
  z[3] = len & 0xff
  z[4] = (len >>> 8) & 0xff
  z[5] = nlen & 0xff
  z[6] = (nlen >>> 8) & 0xff
  z.set(raw, 7)
  z.set(be32(adler32(raw)), 7 + len)

  const ihdr = new Uint8Array(13)
  ihdr.set(be32(width), 0)
  ihdr.set(be32(height), 4)
  ihdr[8] = 8 // 位深
  ihdr[9] = 6 // 颜色类型 RGBA
  // 10~12: 压缩/过滤/隔行 全 0

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))]
  const total = parts.reduce((n, part) => n + part.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const part of parts) {
    out.set(part, off)
    off += part.length
  }
  return out
}
