import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import { Document, Packer, Paragraph } from 'docx'
import { mkdirSync } from 'node:fs'

// Start npm run dev -- --host 127.0.0.1 --port 5174 before running this check.
mkdirSync('testdata-sample.docs', { recursive: true })
const pdf = await PDFDocument.create()
pdf.addPage().drawText('Kairos local PDF preview')
const word = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('本地 Word 文件预览')] }] }))
const fixture = {
  'D:/notes/a.md': { markdown: Array.from({ length: 65 }, (_, i) => `## 章节 ${i + 1}\n\n${i === 29 ? '[打开说明](说明.txt) · [打开 PDF](示例.pdf) · [打开网页](说明.html#target)' : '这是用于验证滚动定位的长文档内容。'.repeat(5)}`).join('\n\n'), version: '1' },
  'D:/notes/说明.txt': { markdown: '本地文本预览', version: '1' },
  'D:/notes/示例.pdf': { markdown: '', base64: await pdf.saveAsBase64(), version: '1' },
  'D:/notes/示例.docx': { markdown: '', base64: word.toString('base64'), version: '1' },
  'D:/notes/说明.html': { markdown: '<h1>本地网页预览</h1><script>window.unsafePreview = true</script>' + '<p>安全显示</p>'.repeat(30) + '<h2 id="target">链接目标</h2>', version: '1' },
}
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 760 } })
  await context.addInitScript(files => {
    window.testNativeCalls = []
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'md-test' }, currentWebview: { label: 'md-test' } },
      transformCallback: () => 1,
      invoke: async (command, args) => {
        window.testNativeCalls.push({ command, args })
        if (command === 'local_markdown_read') {
          const doc = files[args.path]
          if (!doc) throw new Error('路径不可访问')
          return args.knownVersion === doc.version ? null : { path: args.path, ...doc }
        }
        if (command === 'local_markdown_list') return { directory: 'D:/notes', parent: 'D:/', entries: Object.keys(files).map(path => ({ name: path.split('/').at(-1), path, directory: false })) }
        if (command === 'local_markdown_write') {
          const version = String(Number(files[args.path].version) + 1)
          files[args.path] = { markdown: args.markdown, version }
          return { path: args.path, ...files[args.path] }
        }
        return 1
      },
    }
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
  }, fixture)
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:5174/#/local-markdown?file=D%3A%2Fnotes%2Fa.md')
  const heading = page.getByRole('heading', { name: '章节 30', exact: true })
  const edit = page.getByRole('button', { name: '编辑文档', exact: true })
  await heading.waitFor()
  await heading.evaluate(el => {
    const view = el.closest('.overflow-y-auto')
    view.scrollTop += el.getBoundingClientRect().top - view.getBoundingClientRect().top
  })
  const topGap = async () => heading.evaluate(el => el.getBoundingClientRect().top - el.closest('.overflow-y-auto').getBoundingClientRect().top)
  const originalGap = await topGap()
  await edit.click()
  await page.locator('.tiptap').waitFor()
  await page.waitForFunction(() => {
    const el = Array.from(document.querySelectorAll('.tiptap h2')).find(h => h.textContent === '章节 30')
    return el && Math.abs(el.getBoundingClientRect().top - el.closest('.overflow-y-auto').getBoundingClientRect().top) < 12
  })
  assert.equal(await page.locator('.tiptap[contenteditable="true"]').count(), 1)
  await page.getByRole('toolbar', { name: '文档编辑工具' }).getByRole('button', { name: '加粗' }).waitFor()
  await page.screenshot({ path: 'testdata-sample.docs/local-editor.png' })
  await page.getByRole('button', { name: '完成编辑', exact: true }).click()
  await page.waitForFunction(() => {
    const el = Array.from(document.querySelectorAll('.md-body h2')).find(h => h.textContent === '章节 30')
    return el && Math.abs(el.getBoundingClientRect().top - el.closest('.overflow-y-auto').getBoundingClientRect().top) < 12
  })
  assert(Math.abs(await topGap() - originalGap) < 12)
  await page.getByRole('link', { name: '打开说明', exact: true }).click()
  await page.getByText('本地文本预览', { exact: true }).waitFor()
  await edit.click()
  await page.getByRole('textbox', { name: '编辑文件原文' }).fill('写回文本')
  await page.getByRole('button', { name: '完成编辑', exact: true }).click()
  await page.getByText('写回文本', { exact: true }).waitFor()
  assert(await page.evaluate(() => window.testNativeCalls.some(x => x.command === 'local_markdown_write' && x.args.path === 'D:/notes/说明.txt' && x.args.markdown === '写回文本')))
  const back = page.getByRole('button', { name: '返回上一份文件', exact: true })
  await back.click()
  await heading.waitFor()
  await page.waitForFunction(() => {
    const el = Array.from(document.querySelectorAll('.md-body h2')).find(h => h.textContent === '章节 30')
    return el && Math.abs(el.getBoundingClientRect().top - el.closest('.overflow-y-auto').getBoundingClientRect().top) < 12
  })
  await page.getByRole('link', { name: '打开 PDF', exact: true }).click()
  await page.locator('.react-pdf__Page__canvas').waitFor().catch(async error => {
    console.error((await page.locator('body').innerText()).slice(0, 500), errors)
    throw error
  })
  await page.getByRole('button', { name: '用其他应用编辑' }).click()
  assert(await page.evaluate(() => window.testNativeCalls.some(x => x.command === 'local_document_open_with' && x.args.path === 'D:/notes/示例.pdf')))
  await back.click()
  await page.getByRole('link', { name: '打开网页', exact: true }).click()
  await page.getByRole('heading', { name: '本地网页预览' }).waitFor()
  await page.waitForFunction(() => {
    const target = document.getElementById('target')
    return target && target.getBoundingClientRect().bottom <= window.innerHeight
  })
  assert.equal(await page.evaluate(() => window.unsafePreview), undefined)
  await page.getByRole('button', { name: '示例.docx', exact: true }).click()
  await page.getByText('本地 Word 文件预览', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Local file history, scroll position, full editor, TXT write-back, and PDF, Word and HTML previews passed.')
} finally {
  await browser.close()
}
