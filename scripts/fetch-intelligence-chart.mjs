// 每日截取 Artificial Analysis 官网首屏的智能指数图表，写入 public/intelligence/chart.png
//
// 为什么截屏：官网图表是 Recharts 客户端渲染的 SVG，没有稳定的静态图片地址；
// 应用里显示的「官方原图」只能由浏览器渲染后截取。脚本失败时保留旧图，工作流随之失败，
// 不会把半张图提交上去。
//
// 本地运行（用系统 Chrome，免下载 Playwright 浏览器）：
//   CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" node scripts/fetch-intelligence-chart.mjs
// CI 运行（先 npx playwright-core install --with-deps chromium）：
//   node scripts/fetch-intelligence-chart.mjs

import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright-core'

const PAGE = 'https://artificialanalysis.ai/'
const OUT = path.resolve('public/intelligence/chart.png')
const TMP = `${OUT}.tmp.png`
const META = path.resolve('scripts/intelligence-chart.json')
const PUBLIC_META = path.resolve('public/intelligence/chart-meta.json')
const CHROME = process.env.CHROME_PATH?.trim()
const FORCE = process.env.FORCE_CHART_SCREENSHOT === '1'
const MAX_ATTEMPTS = 3
const BLOCKED_HOSTS = /(?:google-analytics|googletagmanager|doubleclick|posthog|hotjar|clarity\.ms|segment\.io|intercom\.io|facebook\.net|tiktok\.com)/i

const browser = await chromium.launch({
  headless: true,
  ...(CHROME ? { executablePath: CHROME } : {}),
})

async function openAndLocateChart() {
  let lastError
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const context = await browser.newContext({
      // 官网首屏图表在 1920 宽度下是 1366×320；2x 输出给高分屏留足像素
      viewport: { width: 1920, height: 1200 },
      deviceScaleFactor: 2,
      locale: 'en-US',
    })
    // 拦截视频与第三方统计脚本，减少 CI 2 核环境下无关资源阻塞 Recharts 水合
    await context.route('**/*', (route) => {
      const req = route.request()
      if (req.resourceType() === 'media' || BLOCKED_HOSTS.test(req.url())) {
        return route.abort()
      }
      return route.continue()
    })
    const page = await context.newPage()
    try {
      const res = await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 90_000 })
      const status = res?.status() ?? 0
      if (status >= 400) throw new Error(`官网返回 HTTP ${status}`)
      await page.waitForSelector('svg.recharts-surface', { timeout: 60_000 })
      // 等图表入场动画与模型 Logo 图片加载完
      await page.waitForTimeout(4_000)

      const charts = page.locator('svg.recharts-surface')
      const index = await charts.evaluateAll((els) =>
        els.findIndex((el) => {
          const r = el.getBoundingClientRect()
          return r.width >= 1_000 && r.height >= 250
        }),
      )
      if (index < 0) throw new Error('首页没有找到智能指数大图，官网结构可能改了')
      return { context, page, chart: charts.nth(index) }
    } catch (err) {
      let title = ''
      try { title = await page.title() } catch { /* ignore */ }
      lastError = err
      console.warn(`第 ${attempt}/${MAX_ATTEMPTS} 次加载图表失败（url=${page.url()}, title=${JSON.stringify(title)}）：${err.message}`)
      await context.close().catch(() => {})
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, attempt * 5_000))
      }
    }
  }
  throw lastError
}

try {
  const { context, page, chart } = await openAndLocateChart()
  try {
    const chartText = (await chart.textContent()) || ''
    if (!/Claude|GPT|Gemini|Grok/i.test(chartText)) {
      throw new Error('第一张大图不像模型智能指数图，官网布局可能改了')
    }
    await chart.scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)

    // 冷启动时 Logo/字体可能比 SVG 晚到；等它们全部就绪再截，避免截出缺图
    await chart.evaluate(async (el) => {
      if (document.fonts?.ready) await document.fonts.ready
      const srcs = [...el.querySelectorAll('image')]
        .map((img) => img.getAttribute('href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href'))
        .filter(Boolean)
      await Promise.all(srcs.map((src) => new Promise((resolve) => {
        const img = new Image()
        let done = false
        const finish = () => {
          if (done) return
          done = true
          resolve()
        }
        img.onload = finish
        img.onerror = finish
        img.src = src
        window.setTimeout(finish, 4000)
      })))
    })
    await page.waitForTimeout(500)

    // 图表文本/分数/Logo/配色即内容指纹。截图抗锯齿每次会有几百分之一的像素差，
    // 只用内容判断，避免数据没变也每天提交一份新 PNG。
    const fingerprint = await chart.evaluate((el) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
      return {
        text: norm(el.textContent),
        images: [...el.querySelectorAll('image')]
          .map((img) => img.getAttribute('href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '')
          .filter(Boolean),
        fills: [...el.querySelectorAll('path, rect')]
          .map((node) => node.getAttribute('fill'))
          .filter(Boolean),
        size: `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`,
      }
    })
    const hash = createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex')

    let previous = null
    try {
      previous = JSON.parse(await fs.readFile(META, 'utf8'))
    } catch { /* 首次运行没有指纹文件 */ }
    let hasImage = true
    try {
      await fs.access(OUT)
    } catch {
      hasImage = false
    }

    if (!FORCE && previous?.fingerprint === hash && hasImage) {
      // 确保 public/intelligence/chart-meta.json 与 scripts/intelligence-chart.json 同步，方便前端读取更新时间与版本指纹
      const metaPayload = `${JSON.stringify(previous, null, 2)}\n`
      let hasPublicMeta = false
      try {
        hasPublicMeta = (await fs.readFile(PUBLIC_META, 'utf8')) === metaPayload
      } catch { /* 首次同步 */ }
      if (!hasPublicMeta) await fs.writeFile(PUBLIC_META, metaPayload, 'utf8')
      console.log('官方图表内容没有变化，跳过截图')
    } else {
      // 官网图表底色是页面白卡，SVG 本身默认 overflow:hidden 会裁掉最左侧斜排标签（如 Claude 的 C）；
      // 放开 overflow 并按 SVG 及全部子文本的联合包围盒向外微扩，确保最左文字完整且不带上方的图例或卡片边框。
      const clip = await chart.evaluate((el) => {
        el.style.overflow = 'visible'
        el.style.background = '#ffffff'
        const parent = el.parentElement
        if (parent) {
          parent.style.overflow = 'visible'
          if (!parent.style.background) parent.style.background = '#ffffff'
        }
        const base = el.getBoundingClientRect()
        let minX = base.left
        let maxX = base.right
        let maxY = base.bottom
        for (const node of el.querySelectorAll('text, tspan, image, rect, path')) {
          const r = node.getBoundingClientRect()
          if (r.width === 0 && r.height === 0) continue
          if (r.left < minX) minX = r.left
          if (r.right > maxX) maxX = r.right
          if (r.bottom > maxY) maxY = r.bottom
        }
        const x = Math.max(0, Math.floor(Math.min(base.left, minX - 8)))
        const y = Math.max(0, Math.floor(base.top))
        const right = Math.ceil(Math.max(base.right, maxX + 8))
        const bottom = Math.ceil(Math.max(base.bottom, maxY + 8))
        return {
          x,
          y,
          width: right - x,
          height: bottom - y,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        }
      })
      if (!clip || clip.width < 1_000) throw new Error(`图表尺寸异常：${clip?.width ?? 0}×${clip?.height ?? 0}`)

      await page.screenshot({
        path: TMP,
        clip: {
          x: clip.x + clip.scrollX,
          y: clip.y + clip.scrollY,
          width: clip.width,
          height: clip.height,
        },
        fullPage: true,
        animations: 'disabled',
      })
      const stat = await fs.stat(TMP)
      if (stat.size < 30_000) throw new Error(`截图文件异常过小（${stat.size} 字节），可能只截到了空白`)

      await fs.rename(TMP, OUT)
      const metaPayload = `${JSON.stringify({ fingerprint: hash, generatedAt: new Date().toISOString() }, null, 2)}\n`
      await fs.writeFile(META, metaPayload, 'utf8')
      await fs.writeFile(PUBLIC_META, metaPayload, 'utf8')
      console.log(`已更新官方图表 ${Math.round(clip.width)}×${Math.round(clip.height)} → ${OUT}（${Math.round(stat.size / 1024)} KB）`)
    }
  } finally {
    await context.close().catch(() => {})
  }
} finally {
  await browser.close()
  await fs.rm(TMP, { force: true }).catch(() => {})
}
