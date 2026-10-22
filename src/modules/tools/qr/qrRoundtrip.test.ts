// @vitest-environment jsdom
/**
 * jsQR 解码往返：用 qr-code-styling 真实生成，再解码比对原文。
 *
 * jsdom 没有 canvas2d 实现（node-canvas 未安装），PNG 栅格化跑不了，
 * 所以走 svg 绘制路径拿到同步生成的模块矩阵，按「方块点型」合成像素位图
 * （等价于画到 canvas 的像素结果），再交给 jsQR——验证的是内容编码层的完整往返。
 * 样式层（圆点/Logo/渐变）的像素自检在浏览器里由 selfCheckQr 完成。
 */
import { describe, expect, it } from 'vitest'
import QRCodeStyling from 'qr-code-styling'
import jsQR from 'jsqr'
import { buildWifiContent, buildVCardContent } from './qrTemplates'
import { buildQrOptions, matrixToImageData, type QrModuleMatrix, type QrStyle } from './qrGen'

const style: QrStyle = {
  dotType: 'square',
  eyeType: 'square',
  eyeDotType: 'square',
  gradient: false,
  color: '#2C55B8',
  gradientColor: '',
  logo: null,
}

/** 走完「生成 → 像素 → jsQR」整条链，返回解出的文本 */
function roundTrip(content: string): string | null {
  const options = buildQrOptions(content, style, 280)
  const qr = new QRCodeStyling({ ...options, type: 'svg' })
  // 矩阵在 update() 里同步建好；绘制 Promise 在 jsdom 里可能失败，吞掉避免噪声
  void qr._svgDrawingPromise?.catch(() => {})
  void qr._canvasDrawingPromise?.catch(() => {})
  const matrix = qr._qr as QrModuleMatrix | undefined
  if (!matrix) throw new Error('QR 模型未生成')
  const img = matrixToImageData(matrix)
  return jsQR(img.data, img.width, img.height)?.data ?? null
}

describe('jsQR 解码往返', () => {
  it('纯文本（ASCII）', () => {
    expect(roundTrip('hello world 123')).toBe('hello world 123')
  })

  it('中文文本（UTF-8 预编码层）', () => {
    expect(roundTrip('中文测试123')).toBe('中文测试123')
    expect(roundTrip('扫码识别✅ 完成')).toBe('扫码识别✅ 完成')
  })

  it('网址', () => {
    expect(roundTrip('https://example.com/path?a=1&b=2')).toBe('https://example.com/path?a=1&b=2')
  })

  it('WiFi 配置串（含转义）', () => {
    const wifi = buildWifiContent({ ssid: '我家的;网', password: 'p:w\\,x', encryption: 'WPA' })
    expect(roundTrip(wifi)).toBe(wifi)
  })

  it('vCard 名片（CRLF 多行 + 中文 + 转义）', () => {
    const card = buildVCardContent({
      name: '张三;测试',
      org: 'ACME, Inc.',
      title: '工程师',
      phone: '13800000000',
      email: 'a@b.com',
      note: '备注\n第二行',
    })
    expect(roundTrip(card)).toBe(card)
  })

  it('长内容（高版本二维码）', () => {
    const long = '很长的内容。'.repeat(40) + 'https://example.com/' + 'x'.repeat(80)
    expect(roundTrip(long)).toBe(long)
  })
})
