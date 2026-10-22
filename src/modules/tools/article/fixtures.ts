/**
 * 解析测试用的站点 HTML 样本（结构照抄真实页面的关键骨架）：
 * - 微信公众号：#js_content 正文 + data-src 懒加载图 + 标题带「_微信公众号」尾巴
 * - CSDN：#content_views 正文 + 「展开阅读全文」遮罩 + 推荐/目录垃圾位
 * - 普通博客：<article> 长文，走 Readability 路径
 * - 知乎：登录墙短页，验证粘贴兜底提示
 */

export const WECHAT_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>微信测试文章_微信公众号</title>
  <meta property="og:title" content="微信测试文章">
  <meta property="og:article:author" content="张三">
</head>
<body>
  <h1 id="activity-name">微信测试文章_微信公众号</h1>
  <span id="js_name">测试公众号</span>
  <div id="js_content">
    <p>微信正文第一段，介绍工具的使用背景。</p>
    <p>微信正文第二段，稍作展开说明。</p>
    <img class="rich_pages" data-src="https://mmbiz.qpic.cn/mmbiz_png/test1/0">
    <p>微信正文第三段，收尾。</p>
  </div>
  <div class="rich_media_tool">分享到朋友圈</div>
  <div id="js_pc_qr_code">扫码关注二维码</div>
</body>
</html>`

export const CSDN_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>深入理解测试 - CSDN博客</title>
  <meta name="author" content="CSDN作者">
</head>
<body>
  <h1 class="title-article" id="articleContentId">深入理解测试</h1>
  <a class="follow-nickName">CSDN作者</a>
  <div id="content_views">
    <div class="hide-article-box text-center"><span>展开阅读全文</span></div>
    <p>CSDN正文第一段，讲解问题的来龙去脉。</p>
    <p>CSDN正文第二段，给出解决思路。</p>
    <img data-original="https://img-blog.csdnimg.cn/test2.png">
    <p>CSDN正文第三段，总结。</p>
  </div>
  <div class="recommend-box">相关推荐文章</div>
  <div id="treeSkill">目录树插件</div>
</body>
</html>`

/** 长文普通博客：三个 200+ 字段落（Readability 默认 charThreshold 500，总长要够），走 Readability 路径 */
export const BLOG_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>普通博客文章</title>
  <meta property="og:title" content="普通博客文章">
  <meta property="og:site_name" content="示例博客">
</head>
<body>
  <header><nav>首页 | 归档 | 关于</nav></header>
  <article>
    <h1>普通博客文章</h1>
    <p>第一段：这是一篇普通的博客文章，用来验证 Readability 抽取路径是否能够正确拿到标题与正文内容，并且不会把导航栏、页脚这些站点装饰一并收进结果里。正文本身要足够长才会被判定为可读正文，因此这一段把来龙去脉都交代清楚，包括为什么要离线保存、怎么挑选正文、图片要不要本地化，以及最终导出成什么格式方便日后翻阅。</p>
    <p>第二段：继续补充说明，同样的长句结构是为了让 Readability 的打分逻辑认为这里是文章主体，而不是什么侧边栏或者广告单元。真实的博客文章动辄上千字，测试样本也应该尽量贴近真实长度，避免因为阈值抖动导致抽取结果不稳定，这一点在自动化测试里尤其重要，偶发失败比一直失败更让人头疼。</p>
    <p>第三段：收尾总结，再次强调这是一段足够长的正文文本，确保抽取结果稳定。离线文档的价值在于多年以后依然能打开、能读、不依赖原站存活，所以正文、图片、来源信息三者都要在导出的那一刻完整落盘，链接失效也不影响阅读体验，这正是这个工具存在的意义。</p>
    <img src="https://cdn.example.com/pic.png" alt="配图">
    <noscript><img src="https://cdn.example.com/pic.png" alt="配图"></noscript>
  </article>
  <footer>© 示例博客</footer>
</body>
</html>`

/** 知乎登录墙短页：抽不出正文，应给粘贴兜底提示 */
export const ZHIHU_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>知乎问题 - 知乎</title>
</head>
<body>
  <div class="SignFlowHomepage">登录后才能阅读全文</div>
  <p>折叠摘要。</p>
</body>
</html>`
