import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'

// Start `npm run dev -- --host 127.0.0.1 --port 5174` first.
mkdirSync('testdata-sample.docs', { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const results = []
try {
  for (const width of [390, 1440, 320, 768]) {
    const mobile = width < 1024
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: mobile, isMobile: mobile })
    await context.addInitScript(() => localStorage.setItem('ws-onboarded-v2', '1'))
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('http://127.0.0.1:5174/#/docs')
    await page.waitForLoadState('networkidle')
    await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts')
      const now = Date.now()
      await db.folders.put({ id: 'folder', name: '学习资料', createdAt: now, updatedAt: now })
      await db.docs.bulkPut(['a', 'b', 'c'].map(id => ({ id, hash: id, title: `文档 ${id}`, kind: 'md', size: 10, addedAt: now })))
      for (const id of ['a', 'b', 'c']) await db.blobs.put({ hash: id, blob: new Blob([String.raw`# 数学测试

答案 \(1&lt;a\\le 2\)

\[\frac{a}{b}\]`], { type: 'text/markdown' }) })
    })
    const source = page.locator('[data-draggable-doc="a"]')
    await source.waitFor()
    const drop = id => page.locator(`[data-doc-drop="${id}"]:visible`)
    async function drag(source, target) {
      await source.scrollIntoViewIfNeeded()
      const a = await source.boundingBox(), b = await target.boundingBox()
      const x = a.x + a.width * .35, y = a.y + a.height * .5
      const tx = b.x + b.width * .5, ty = b.y + b.height * .5
      if (mobile) {
        const cdp = await context.newCDPSession(page)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
        await page.waitForTimeout(420)
        for (let i = 1; i <= 15; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (tx-x)*i/15, y: y + (ty-y)*i/15 }] })
          await page.waitForTimeout(20)
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await cdp.detach()
      } else {
        await page.mouse.move(x, y); await page.mouse.down()
        await page.mouse.move(tx, ty, { steps: 20 }); await page.mouse.up()
      }
      await page.waitForTimeout(500)
    }
    await drag(source, drop('folder'))
    assert.equal(await source.count(), 0, `drag into folder at ${width}`)
    assert.equal(await page.evaluate(async () => (await (await import('/src/db/db.ts')).db.docs.get('a')).folderId), 'folder')
    assert(page.url().endsWith('/docs'), 'drag must not open a document')
    await drag(page.locator('[data-draggable-doc="b"]'), drop('__trash__'))
    assert.equal(await page.locator('[data-draggable-doc="b"]').count(), 0)
    await drop('__trash__').click()
    await page.getByRole('region', { name: '回收站', exact: true }).waitFor()
    await page.getByRole('button', { name: '恢复', exact: true }).click()
    await page.getByText('回收站为空', { exact: true }).waitFor()
    await drop('__unfiled__').click()
    await page.locator('[data-draggable-doc="b"]').waitFor()
    await drag(page.locator('[data-draggable-doc="b"]'), drop('__trash__'))
    await drop('__trash__').click()
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '彻底删除', exact: true }).click()
    await page.getByRole('button', { name: '确认删除', exact: true }).click()
    await page.getByText('回收站为空', { exact: true }).waitFor()
    await drop('__unfiled__').click()
    await drag(page.locator('[data-draggable-doc="c"]'), drop('__trash__'))
    await drop('__trash__').click()
    await page.getByRole('button', { name: '清空回收站', exact: true }).click()
    await page.getByRole('button', { name: '确认删除', exact: true }).click()
    await page.getByText('回收站为空', { exact: true }).waitFor()
    assert.equal(await page.evaluate(async () => !!await (await import('/src/db/db.ts')).db.docs.get('b')), false)
    assert.equal(await page.evaluate(async () => !!await (await import('/src/db/db.ts')).db.docs.get('c')), false)
    await drop('folder').click()
    await page.getByRole('button', { name: '阅读 文档 a', exact: true }).click()
    await page.locator('.katex').first().waitFor()
    assert.equal(await page.locator('.katex').count(), 2)
    assert.equal(await page.locator('.katex-error').count(), 0)
    const counter = page.locator('[aria-label="Markdown 总字数"]')
    await counter.waitFor()
    assert.match(await counter.textContent(), /总字数：[\d,]+/)
    const counterBox = await counter.boundingBox()
    assert(counterBox.y + counterBox.height <= 900 && counterBox.y > 750, '字数应固定在阅读区底部')
    await page.screenshot({ path: `testdata-sample.docs/math-${width}.png` })
    await page.goto('http://127.0.0.1:5174/#/docs/new')
    const editor = page.locator('.tiptap[contenteditable="true"]')
    await editor.waitFor()
    await editor.fill('你好，Kairos！')
    await page.waitForFunction(() => document.querySelector('[aria-label="Markdown 总字数"]')?.textContent === '总字数：10')
    await editor.fill('你好世界')
    await page.waitForFunction(() => document.querySelector('[aria-label="Markdown 总字数"]')?.textContent === '总字数：4')
    await page.goto('http://127.0.0.1:5174/#/docs')
    await page.waitForLoadState('networkidle')
    assert.equal(await page.getByText('复习', { exact: true }).count(), 0)
    await page.screenshot({ path: `testdata-sample.docs/library-${width}.png` })
    assert.deepEqual(errors, [])
    results.push({ width, drag: mobile ? 'touch long press' : 'mouse', move: true, trashRestorePurge: true, math: true, errors })
    await context.close()
  }
  console.log(JSON.stringify(results, null, 2))
} finally { await browser.close() }
