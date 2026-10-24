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
const CHROME = process.env.CHROME_PATH?.trim()
const FORCE = process.env.FORCE_CHART_SCREENSHOT === '1'

const browser = await chromium.launch({
  headless: true,
  ...(CHROME ? { executablePath: CHROME } : {}),
})

try {
  const context = await browser.newContext({
    // 官网首屏图表在 1920 宽度下是 1366×320；2x 输出给高分屏留足像素
    viewport: { width: 1920, height: 1200 },
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForSelector('svg.recharts-surface', { timeout: 45_000 })
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

  const chart = charts.nth(index)
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
    console.log('官方图表内容没有变化，跳过截图')
  } else {
    // 官网图表底色是页面白卡，SVG 本身是透明的；补上白底，深色主题下文字才看得清
    await chart.evaluate((el) => {
      el.style.background = '#ffffff'
    })
    const box = await chart.boundingBox()
    if (!box || box.width < 1_000) throw new Error(`图表尺寸异常：${box?.width ?? 0}×${box?.height ?? 0}`)

    await chart.screenshot({ path: TMP, animations: 'disabled' })
    const stat = await fs.stat(TMP)
    if (stat.size < 30_000) throw new Error(`截图文件异常过小（${stat.size} 字节），可能只截到了空白`)

    await fs.rename(TMP, OUT)
    await fs.writeFile(META, `${JSON.stringify({ fingerprint: hash, generatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
    console.log(`已更新官方图表 ${Math.round(box.width)}×${Math.round(box.height)} → ${OUT}（${Math.round(stat.size / 1024)} KB）`)
  }
} finally {
  await browser.close()
  await fs.rm(TMP, { force: true }).catch(() => {})
}
