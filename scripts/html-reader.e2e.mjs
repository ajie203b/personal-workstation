import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const server = await createServer({ optimizeDeps: { entries: ['index.html'] }, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage()
  await page.addInitScript(() => localStorage.setItem('ws-onboarded-v2', '1'))
  const source = `<!doctype html><html lang="zh"><style>
    @keyframes move { to { transform: translateX(10px) } } canvas { animation: move 1s infinite alternate }
    </style><button onclick="this.textContent='已经运行'">运行动画</button><canvas></canvas>
    <script>document.querySelector('canvas').getContext('2d').fillRect(0,0,10,10)</script></html>`
  await page.goto(server.resolvedUrls.local[0] + '#/docs', { waitUntil: 'commit' })
  const picker = page.locator('input[type=file][accept*=".htm"]').first()
  await picker.waitFor({ state: 'attached', timeout: 90000 })
  await picker.setInputFiles({ name: '演示.HTM', mimeType: 'text/html', buffer: Buffer.from(source) })
  await page.getByRole('button', { name: '阅读 演示', exact: true }).click()
  const frame = page.frameLocator('iframe[title="演示"]')
  await frame.getByRole('button', { name: '运行动画' }).click()
  await frame.getByRole('button', { name: '已经运行' }).waitFor()
  assert.equal(await frame.locator('canvas').evaluate(canvas => getComputedStyle(canvas).animationName), 'move')
  assert.equal(await frame.locator('canvas').evaluate(canvas => canvas.getContext('2d').getImageData(1,1,1,1).data[3]), 255)
  assert.equal(await page.locator('iframe[title="演示"]').getAttribute('sandbox'), 'allow-scripts')
  await page.reload({ waitUntil: 'commit' })
  await frame.getByRole('button', { name: '运行动画' }).waitFor()
  await page.getByRole('button', { name: '返回文档库' }).click()
  await page.getByRole('button', { name: '阅读 演示', exact: true }).waitFor()
  console.log('PASS HTML library import, CSS animation, Canvas, button, sandbox, reload and return')
} finally {
  await browser?.close()
  await server.close()
}
