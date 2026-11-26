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
  const chapters = ['c1', 'c2', 'c3', '第四章', 'c5']
  const links = chapters.map((id, i) => `<a href="#${encodeURIComponent(id)}">${i + 1}</a>`).join(' ')
  const sections = chapters.map((id, i) => `<section id="${id}">章节 ${i + 1}</section>`).join('')
  const source = `<!doctype html><html lang="zh"><style>
    nav { position:sticky; top:0; background:white } section { height:110vh; scroll-margin-top:40px }
    @keyframes move { to { transform: translateX(10px) } } canvas { animation: move 1s infinite alternate }
    </style><base href="https://example.invalid/export/"><nav>${links} <a href="#legacy">旧式锚点</a> <a href="#">顶部</a> <a href="#missing">缺失章节</a></nav>
    <button onclick="this.textContent='已经运行'">运行动画</button><canvas></canvas>
    ${sections}<a name="legacy">附录</a>
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
  const readerUrl = page.url()
  for (const [i, id] of chapters.entries()) {
    await frame.getByRole('link', { name: String(i + 1), exact: true }).click()
    const target = frame.locator('section:target')
    await target.waitFor({ timeout: 3000 })
    assert.equal(await target.getAttribute('id'), id)
    assert(await target.evaluate(el => Math.abs(el.getBoundingClientRect().top) < 60))
    assert.equal(page.url(), readerUrl)
    assert.equal(await frame.locator('button').textContent(), '已经运行')
  }
  await frame.getByRole('link', { name: '旧式锚点' }).click()
  assert(await frame.locator('[name=legacy]').evaluate(el => el.getBoundingClientRect().top < innerHeight))
  await frame.getByRole('link', { name: '顶部' }).click()
  assert.equal(await frame.locator('body').evaluate(() => scrollY), 0)
  await frame.getByRole('link', { name: '缺失章节' }).click()
  assert.equal(await frame.locator('button').textContent(), '已经运行')
  await page.setViewportSize({ width: 390, height: 844 })
  await frame.getByRole('link', { name: '3', exact: true }).focus()
  await page.keyboard.press('Enter')
  await frame.locator('section#c3:target').waitFor()
  assert.equal(page.url(), readerUrl)
  await page.reload({ waitUntil: 'commit' })
  await frame.getByRole('button', { name: '运行动画' }).waitFor()
  await page.getByRole('button', { name: '返回文档库' }).click()
  await page.getByRole('button', { name: '阅读 演示', exact: true }).waitFor()
  // Android providers may omit the extension. Older versions saved these pages as Markdown.
  const legacyId = await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts')
    const { importDoc } = await import('/src/db/docs.ts')
    const html = '<!doctype html><button>旧网页</button>'
    const { doc } = await importDoc(new File([html], '安卓文档', { type: 'application/octet-stream' }))
    if (doc.kind !== 'html') throw new Error('extensionless HTML was not recognized')
    const note = await importDoc(new File([html + '\n'], '示例.md'))
    if (note.doc.kind !== 'md') throw new Error('Markdown example was reclassified')
    await db.docs.update(doc.id, { kind: 'md' })
    return doc.id
  })
  for (const path of [`/docs/${legacyId}`, `/docs/edit/${legacyId}`]) {
    await page.evaluate(async id => {
      const { db } = await import('/src/db/db.ts')
      await db.docs.update(id, { kind: 'md' })
    }, legacyId)
    await page.goto(server.resolvedUrls.local[0] + '#' + path)
    await page.frameLocator('iframe[title="安卓文档"]').getByRole('button', { name: '旧网页' }).waitFor()
    assert(page.url().endsWith('#/docs/' + legacyId))
    await page.getByRole('button', { name: '返回文档库' }).click()
    await page.getByRole('button', { name: '阅读 安卓文档', exact: true }).waitFor()
  }
  console.log('PASS HTML import, animation state, five section links, Chinese and legacy anchors, top, missing target, keyboard, mobile width, reload and return')
} finally {
  await browser?.close()
  await server.close()
}
