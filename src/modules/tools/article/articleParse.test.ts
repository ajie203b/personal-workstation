// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  PASTE_FALLBACK_HINT,
  LOGIN_WALL_HINT,
  absolutizeUris,
  cleanPageTitle,
  extractArticle,
  extractPastedContent,
  normalizeArticleUrl,
  parseDocument,
  promoteLazyImages,
  siteKindOf,
} from './articleParse'
import { BLOG_HTML, CSDN_HTML, WECHAT_HTML, ZHIHU_HTML } from './fixtures'

describe('siteKindOf', () => {
  it('按 hostname 匹配站点', () => {
    expect(siteKindOf('https://mp.weixin.qq.com/s/abc')).toBe('wechat')
    expect(siteKindOf('https://blog.csdn.net/u/article')).toBe('csdn')
    expect(siteKindOf('https://juejin.cn/post/123')).toBe('juejin')
    expect(siteKindOf('https://github.com/owner/repo')).toBe('github')
    expect(siteKindOf('https://www.cnblogs.com/u/p/1.html')).toBe('cnblogs')
    expect(siteKindOf('https://www.jianshu.com/p/abc')).toBe('jianshu')
    expect(siteKindOf('https://zhuanlan.zhihu.com/p/1')).toBe('zhihu')
    expect(siteKindOf('https://www.bilibili.com/read/cv123')).toBe('bilibili')
    expect(siteKindOf('https://www.xiaohongshu.com/explore/1')).toBe('xiaohongshu')
    expect(siteKindOf('https://example.com/post')).toBe('generic')
    expect(siteKindOf('not a url')).toBe('generic')
  })

  it('normalizeArticleUrl：补全裸域名协议并拦截非 http(s) 协议', () => {
    expect(normalizeArticleUrl('mp.weixin.qq.com/s/xyz')).toBe('https://mp.weixin.qq.com/s/xyz')
    expect(normalizeArticleUrl('http://blog.test/1')).toBe('http://blog.test/1')
    expect(normalizeArticleUrl('')).toBe('')
    expect(() => normalizeArticleUrl('javascript:alert(1)')).toThrow()
    expect(() => normalizeArticleUrl('ftp://example.com/a')).toThrow()
    expect(() => normalizeArticleUrl('invalid url')).toThrow()
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

describe('extractArticle — 扩展技术站点适配器、代码块语言与短篇回退', () => {
  it('Readability 保留代码块 language-* 类名', () => {
    const longPara = '<p>' + '这是一段足够长的正文内容用于满足 Readability 阈值要求。'.repeat(20) + '</p>'
    const html = `<html><head><title>TS 笔记</title></head><body><article><h1>TS 笔记</h1>${longPara}<pre><code class="language-typescript hljs">const x: number = 1</code></pre></article></body></html>`
    const r = extractArticle(html, 'https://blog.test/ts')
    expect(r.usedReadability).toBe(true)
    expect(r.contentHtml).toContain('class="language-typescript"')
  })

  it('短篇 <article> 被 isProbablyReaderable 拒绝时回退容器正文', () => {
    const html = `<html><head><title>短文</title></head><body><nav>导航链接</nav><article><p>这是一篇简短的技术随笔，说明某个关键技巧的使用方法。</p></article><footer>版权</footer></body></html>`
    const r = extractArticle(html, 'https://blog.test/short')
    expect(r.contentHtml).toContain('简短的技术随笔')
    expect(r.textContent).not.toContain('导航链接')
    expect(r.textContent).not.toContain('版权')
  })

  it('适配掘金、GitHub、博客园、简书、知乎专栏、B站专栏并清除站点杂项', () => {
    const juejin = extractArticle(
      `<title>掘金笔记 - 掘金</title><h1 class="article-title">掘金笔记</h1><div class="markdown-body"><button class="copy-code-btn">复制</button><p>掘金正文内容展示，包含足够字符长度，确保顺利通过正文最小字数校验。</p></div>`,
      'https://juejin.cn/post/1',
    )
    expect(juejin.site).toBe('juejin')
    expect(juejin.title).toBe('掘金笔记')
    expect(juejin.contentHtml).toContain('掘金正文内容展示')
    expect(juejin.contentHtml).not.toContain('copy-code-btn')

    const github = extractArticle(
      `<title>README - GitHub</title><div id="readme"><article class="markdown-body"><h1>项目说明<a class="anchor" href="#x">#</a></h1><p>这是一个本地优先工具箱的说明文档，涵盖核心架构与离线使用方法说明。</p></article></div>`,
      'https://github.com/foo/bar',
    )
    expect(github.site).toBe('github')
    expect(github.contentHtml).toContain('本地优先工具箱')
    expect(github.contentHtml).not.toContain('class="anchor"')

    const cnblogs = extractArticle(
      `<title>博客园文章 - 博客园</title><h1 id="cb_post_title_url">博客园文章</h1><div id="cnblogs_post_body"><p>博客园正文内容足够长以通过最小字数限制，包含详细示例讲解与说明。</p></div><div id="blog_post_info_block">推荐关注</div>`,
      'https://www.cnblogs.com/u/p/1.html',
    )
    expect(cnblogs.site).toBe('cnblogs')
    expect(cnblogs.contentHtml).toContain('博客园正文内容')

    const jianshu = extractArticle(
      `<title>简书随笔 - 简书</title><h1 class="_1RuRku">简书随笔</h1><article class="_2rhmJa"><p>简书正文段落，包含充足的正文字符数，确保可以顺利完成正文抽取流程。</p></article>`,
      'https://www.jianshu.com/p/123',
    )
    expect(jianshu.site).toBe('jianshu')
    expect(jianshu.contentHtml).toContain('简书正文段落')

    const zhuanlan = extractArticle(
      `<title>专栏文章 - 知乎</title><h1 class="Post-Title">专栏文章</h1><div class="Post-RichText"><p>知乎专栏深度长文内容在这里展示完整细节，帮助大家深入理解底层原理。</p></div>`,
      'https://zhuanlan.zhihu.com/p/999',
    )
    expect(zhuanlan.site).toBe('zhihu')
    expect(zhuanlan.title).toBe('专栏文章')
    expect(zhuanlan.contentHtml).toContain('知乎专栏深度长文')

    const bili = extractArticle(
      `<title>B站专栏 - 哔哩哔哩</title><h1 class="title">B站专栏</h1><div id="read-article-holder"><p>哔哩哔哩专栏正文内容足够长以顺利抽取，这里补充更多技术细节说明。</p></div>`,
      'https://www.bilibili.com/read/cv123',
    )
    expect(bili.site).toBe('bilibili')
    expect(bili.contentHtml).toContain('哔哩哔哩专栏正文')
  })
})
