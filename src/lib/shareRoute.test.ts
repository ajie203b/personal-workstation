import { describe, expect, it } from 'vitest'
import { classifySharePayload, extractFirstHttpUrl } from './shareRoute'

describe('extractFirstHttpUrl', () => {
  it('提取文本中首个 http/https 链接并剥离尾部标点', () => {
    expect(extractFirstHttpUrl('快看这个链接（https://example.com/post/123）。')).toBe('https://example.com/post/123')
    expect(extractFirstHttpUrl('分享 http://b23.tv/abc123!')).toBe('http://b23.tv/abc123')
  })

  it('拒绝非 http/https 协议与无链接文本', () => {
    expect(extractFirstHttpUrl('javascript:alert(1)')).toBe('')
    expect(extractFirstHttpUrl('file:///C:/secret.txt')).toBe('')
    expect(extractFirstHttpUrl('普通文字没有链接')).toBe('')
  })
})

describe('classifySharePayload', () => {
  it('识别抖音分享口令并直达无水印解析', () => {
    const text = '7.15 复制打开抖音，看看【测试作品】 https://v.douyin.com/iRNBxyz/ 复制此链接'
    const res = classifySharePayload({ text })
    expect(res.kind).toBe('media')
    expect(res.url).toBe('https://v.douyin.com/iRNBxyz/')
    expect(res.primaryRoute).toBe(`/tools/media?q=${encodeURIComponent(text)}`)
    expect(res.badge).toBe('抖音 / B 站链接')
  })

  it('识别 B 站链接与纯文本 BV 号', () => {
    const byUrl = classifySharePayload({ url: 'https://www.bilibili.com/video/BV1xx411c7mD' })
    expect(byUrl.kind).toBe('media')
    expect(byUrl.primaryRoute).toContain('/tools/media?q=')

    const byBv = classifySharePayload({ text: '周末补完 BV1ab411c7mD 这个教程' })
    expect(byBv.kind).toBe('media')
    expect(byBv.url).toBe('')
    expect(byBv.badge).toBe('B 站 BV 号')
    expect(byBv.primaryRoute).toContain('BV1ab411c7mD')
  })

  it('识别番茄小说链接并直达番茄小说下载', () => {
    const url = 'https://fanqienovel.com/page/7123456789'
    const res = classifySharePayload({ title: '某部小说', url })
    expect(res.kind).toBe('fanqie')
    expect(res.title).toBe('某部小说')
    expect(res.primaryRoute).toBe(`/tools/fanqie?q=${encodeURIComponent(url)}`)
  })

  it('识别普通网页文章链接并直达离线剪藏', () => {
    const url = 'https://mp.weixin.qq.com/s/abcdef123'
    const res = classifySharePayload({ title: '深度好文', text: `推荐阅读 ${url}` })
    expect(res.kind).toBe('article')
    expect(res.url).toBe(url)
    expect(res.primaryRoute).toBe(`/tools/article?url=${encodeURIComponent(url)}`)
  })

  it('纯文本分享无主工具分流，交由用户存文档或转任务', () => {
    const res = classifySharePayload({ text: '明天14:00 提交实验报告 #学业' })
    expect(res.kind).toBe('text')
    expect(res.url).toBe('')
    expect(res.primaryRoute).toBeNull()
    expect(res.rawPayload).toBe('明天14:00 提交实验报告 #学业')
  })
})
