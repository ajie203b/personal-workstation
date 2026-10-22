// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  PASTE_FALLBACK_HINT,
  LOGIN_WALL_HINT,
  absolutizeUris,
  cleanPageTitle,
  extractArticle,
  extractPastedContent,
  parseDocument,
  promoteLazyImages,
  siteKindOf,
} from './articleParse'
import { BLOG_HTML, CSDN_HTML, WECHAT_HTML, ZHIHU_HTML } from './fixtures'

describe('siteKindOf', () => {
  it('按 hostname 匹配站点', () => {
    expect(siteKindOf('https://mp.weixin.qq.com/s/abc')).toBe('wechat')
    expect(siteKindOf('https://blog.csdn.net/u/article')).toBe('csdn')
    expect(siteKindOf('https://zhuanlan.zhihu.com/p/1')).toBe('zhihu')
    expect(siteKindOf('https://www.xiaohongshu.com/explore/1')).toBe('xiaohongshu')
    expect(siteKindOf('https://example.com/post')).toBe('generic')
    expect(siteKindOf('not a url')).toBe('generic')
  })
})

describe('cleanPageTitle', () => {
  it('去掉站点尾巴', () => {
    expect(cleanPageTitle('微信测试文章_微信公众号')).toBe('微信测试文章')
    expect(cleanPageTitle('深入理解测试 - CSDN博客')).toBe('深入理解测试')
    expect(cleanPageTitle('普通博客文章')).toBe('普通博客文章')
  })
})

describe('promoteLazyImages', () => {
  it('data-src / data-original / data-actualsrc 提升为 src', () => {
    const doc = parseDocument(
      `<body>
        <img data-src="https://a.test/1.png">
        <img src="data:image/gif;base64,R0lGOD" data-original="https://a.test/2.png">
        <img data-actualsrc="https://a.test/3.png">
        <img src="https://a.test/real.png" data-src="https://a.test/other.png">
      </body>`,
      'https://a.test/',
    )
    const n = promoteLazyImages(doc)
    const srcs = Array.from(doc.querySelectorAll('img')).map((i) => i.getAttribute('src'))
    expect(n).toBe(3)
    expect(srcs).toEqual([
      'https://a.test/1.png',
      'https://a.test/2.png',
      'https://a.test/3.png',
      'https://a.test/real.png', // 已有真图不被 data-src 覆盖
    ])
  })

  it('删掉 noscript 里的重复副本；只存在于 noscript 的图展开保留', () => {
    const doc = parseDocument(
      `<body>
        <img data-src="https://a.test/1.png">
        <noscript><img src="https://a.test/1.png"></noscript>
        <p>段落</p>
        <noscript><img src="https://a.test/only.png"></noscript>
      </body>`,
      'https://a.test/',
    )
    promoteLazyImages(doc)
    expect(doc.querySelectorAll('noscript').length).toBe(0)
    const srcs = Array.from(doc.querySelectorAll('img')).map((i) => i.getAttribute('src'))
    expect(srcs.filter((s) => s === 'https://a.test/1.png').length).toBe(1)
    expect(srcs).toContain('https://a.test/only.png') // 唯一副本没被误删
  })
})

describe('absolutizeUris', () => {
  it('相对链接按原 URL 解析成绝对链接', () => {
    const doc = parseDocument(
      `<body><a href="/p/2">链接</a><img src="img/a.png"><a href="#top">锚点</a></body>`,
      'https://blog.test/posts/1',
    )
    absolutizeUris(doc.body, 'https://blog.test/posts/1')
    const [a1, a2] = Array.from(doc.querySelectorAll('a'))
    expect(a1.getAttribute('href')).toBe('https://blog.test/p/2')
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('https://blog.test/posts/img/a.png')
    expect(a2.getAttribute('href')).toBe('#top') // 锚点不动
  })
})

describe('extractArticle — 微信（适配器路径）', () => {
  it('从 #js_content 抽正文，data-src 提升，标题去尾巴，站点垃圾不在正文里', () => {
    const r = extractArticle(WECHAT_HTML, 'https://mp.weixin.qq.com/s/xyz')
    expect(r.site).toBe('wechat')
    expect(r.usedReadability).toBe(false) // 短文不像正文 → 适配器结果
    expect(r.title).toBe('微信测试文章')
    expect(r.byline).toBe('测试公众号')
    expect(r.contentHtml).toContain('微信正文第一段')
    expect(r.contentHtml).toContain('微信正文第三段')
    expect(r.contentHtml).toContain('src="https://mmbiz.qpic.cn/mmbiz_png/test1/0"')
    expect(r.contentHtml).not.toContain('data-src')
    expect(r.contentHtml).not.toContain('分享到朋友圈')
    expect(r.contentHtml).not.toContain('扫码关注二维码')
    expect(r.imageCount).toBe(1)
    expect(r.charCount).toBeGreaterThan(0)
    expect(r.hint).toBeUndefined()
  })
})

describe('extractArticle — CSDN（适配器 + 遮罩清理）', () => {
  it('去掉「展开阅读全文」遮罩与推荐/目录位，data-original 提升', () => {
    const r = extractArticle(CSDN_HTML, 'https://blog.csdn.net/u/article/details/1')
    expect(r.site).toBe('csdn')
    expect(r.title).toBe('深入理解测试')
    expect(r.byline).toBe('CSDN作者')
    expect(r.contentHtml).toContain('CSDN正文第一段')
    expect(r.contentHtml).toContain('CSDN正文第三段')
    expect(r.contentHtml).not.toContain('展开阅读全文')
    expect(r.contentHtml).not.toContain('相关推荐文章')
    expect(r.contentHtml).not.toContain('目录树插件')
    expect(r.contentHtml).toContain('src="https://img-blog.csdnimg.cn/test2.png"')
    expect(r.imageCount).toBe(1)
  })
})

describe('extractArticle — 普通博客（Readability 路径）', () => {
  it('Readability 抽出标题与正文，导航/页脚不进结果', () => {
    const r = extractArticle(BLOG_HTML, 'https://blog.test/posts/1')
    expect(r.site).toBe('generic')
    expect(r.usedReadability).toBe(true)
    expect(r.title).toBe('普通博客文章')
    expect(r.siteName).toBe('示例博客')
    expect(r.contentHtml).toContain('第一段')
    expect(r.contentHtml).toContain('第三段')
    expect(r.textContent).not.toContain('首页 | 归档')
    expect(r.textContent).not.toContain('© 示例博客')
    expect(r.imageCount).toBeGreaterThanOrEqual(1)
    expect(r.charCount).toBeGreaterThan(100)
    expect(r.hint).toBeUndefined()
  })

  it('Readability 前后标题一致（跑之前取的元信息没有丢）', () => {
    const doc = parseDocument(BLOG_HTML, 'https://blog.test/posts/1')
    const before = doc.title // Readability 会改写文档，之前先把标题取出来
    expect(before).toBe('普通博客文章')
    const r = extractArticle(BLOG_HTML, 'https://blog.test/posts/1')
    expect(r.title).toBe(before)
    expect(r.contentHtml.length).toBeGreaterThan(0)
  })
})

describe('extractArticle — 登录墙兜底', () => {
  it('知乎短页抽不出正文时给粘贴提示', () => {
    const r = extractArticle(ZHIHU_HTML, 'https://www.zhihu.com/question/1')
    expect(r.site).toBe('zhihu')
    expect(r.contentHtml).toBe('')
    expect(r.hint).toBe(LOGIN_WALL_HINT)
    expect(r.hint).toContain('粘贴')
  })

  it('普通站点抽不出正文也给粘贴提示', () => {
    const r = extractArticle('<html><body><p>短</p></body></html>', 'https://example.com/x')
    expect(r.hint).toBe(PASTE_FALLBACK_HINT)
  })
})

describe('extractPastedContent', () => {
  it('解析剪贴板 text/html：取 body，标题来自首个标题', () => {
    const r = extractPastedContent(
      '<meta charset="utf-8"><h1>粘贴的标题</h1><p>粘贴正文一段。</p><p>粘贴正文二段。</p>',
      '粘贴的标题\n粘贴正文一段。',
    )
    expect(r.title).toBe('粘贴的标题')
    expect(r.contentHtml).toContain('粘贴正文一段。')
    expect(r.charCount).toBeGreaterThan(0)
  })

  it('纯文本按空行分段', () => {
    const r = extractPastedContent(null, '第一段标题\n\n第二段内容甲。\n\n第三段内容乙。')
    expect(r.title).toBe('第一段标题')
    expect(r.contentHtml).toContain('<p>第二段内容甲。</p>')
    expect(r.contentHtml).toContain('<p>第三段内容乙。</p>')
    expect(r.imageCount).toBe(0)
  })

  it('粘贴 HTML 里的懒加载图也会提升', () => {
    const r = extractPastedContent('<p>正文内容足够长的一段话。</p><img data-src="https://a.test/x.png">', '')
    expect(r.contentHtml).toContain('src="https://a.test/x.png"')
  })
})
