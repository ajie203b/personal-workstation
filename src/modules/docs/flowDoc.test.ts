// @vitest-environment jsdom
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { parseFlowDoc } from './flowDoc'

// jsdom has no MathMLElement/CSSStyleDeclaration; real Chromium provides both.
beforeAll(() => {
  Object.defineProperty(Element.prototype, 'style', {
    configurable: true,
    get() { return document.createElement('span').style },
  })
})
afterAll(() => { delete (Element.prototype as unknown as { style?: unknown }).style })

/**
 * 「恶意文档输入」回归：EPUB 的章节 HTML 来自外部文件，
 * 之前 `onerror` 会被原样保留，插进 DOM 就执行。
 * 现在解析阶段统一过 sanitizeHtml，等于在数据入口就断掉。
 */
async function makeEpub(chapterHtml: string): Promise<Blob> {
  const zip = new JSZip()
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container><rootfiles>'
    + '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
    + '</rootfiles></container>',
  )
  zip.file(
    'OEBPS/content.opf',
    '<?xml version="1.0"?><package><manifest>'
    + '<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>'
    + '</manifest><spine><itemref idref="c1"/></spine></package>',
  )
  zip.file('OEBPS/chapter1.xhtml', chapterHtml)
  const buf = await zip.generateAsync({ type: 'arraybuffer' })
  return new Blob([buf], { type: 'application/epub+zip' })
}

describe('parseFlowDoc(epub) 清洗', () => {
  it('章节里的 script 与 onerror 不会进入渲染 HTML', async () => {
    const blob = await makeEpub(
      '<html><body><h1>第一章</h1>'
      + '<p>正常正文内容。</p>'
      + '<img src="https://evil.test/x.png" onerror="globalThis.__pwned = 1">'
      + '<script>globalThis.__pwned = 2</script>'
      + '<a href="javascript:alert(1)">点我</a>'
      + '</body></html>',
    )
    const doc = await parseFlowDoc('epub', blob)
    expect(doc.segments).toHaveLength(1)
    const html = doc.segments[0].html
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<script')
    expect(html).not.toMatch(/javascript:/i)
    expect(html).toContain('正常正文内容')
    // 纯文本索引不受影响
    expect(doc.text).toContain('正常正文内容')
  })
})

async function makeDocx(body: string): Promise<Blob> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
  zip.file('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="character" w:styleId="ColorBold"><w:name w:val="ColorBold"/><w:rPr><w:b/><w:color w:val="0070C0"/><w:shd w:fill="E2F0D9"/></w:rPr></w:style></w:styles>')
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`)
  return new Blob([await zip.generateAsync({ type: 'arraybuffer' })])
}

describe('Word formatting and equations', () => {
  it('preserves direct formatting, named character styles, paragraph and table shading', async () => {
    const doc = await parseFlowDoc('docx', await makeDocx(
      '<w:p><w:pPr><w:shd w:fill="FCE4D6"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="C00000"/><w:highlight w:val="yellow"/></w:rPr><w:t>直接格式</w:t></w:r>'
      + '<w:r><w:rPr><w:rStyle w:val="ColorBold"/></w:rPr><w:t>继承样式</w:t></w:r></w:p>'
      + '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:shd w:fill="D9E2F3"/></w:tcPr><w:p><w:r><w:t>单元格底纹</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    ))
    const rendered = new DOMParser().parseFromString(doc.segments[0].html, 'text/html')
    const direct = Array.from(rendered.querySelectorAll('span')).find((el) => el.textContent === '直接格式')!
    const inherited = Array.from(rendered.querySelectorAll('span')).find((el) => el.textContent === '继承样式')!
    expect(direct?.style.fontWeight).toBe('bold')
    expect(direct?.style.color).toBe('rgb(192, 0, 0)')
    expect(direct?.style.backgroundColor).toBe('yellow')
    const host = document.createElement('div')
    const style = document.createElement('style')
    style.textContent = doc.styles ?? ''
    host.appendChild(style)
    host.insertAdjacentHTML('beforeend', doc.segments[0].html)
    document.body.appendChild(host)
    try {
      const named = host.querySelector(`.${inherited.className}`)!
      expect(getComputedStyle(named).fontWeight).toBe('700')
      expect(getComputedStyle(named).color).toBe('rgb(0, 112, 192)')
      expect(getComputedStyle(named).backgroundColor).toBe('rgb(226, 240, 217)')
    } finally { host.remove() }
    expect(rendered.querySelector('p')?.style.backgroundColor).toBe('rgb(252, 228, 214)')
    expect(rendered.querySelector('td')?.style.backgroundColor).toBe('rgb(217, 226, 243)')
    expect(doc.text).toContain('直接格式')
    expect(doc.segments[0].html).not.toContain('<style')
  })

  it('keeps native Word fractions and superscripts, including a formula-only document', async () => {
    const doc = await parseFlowDoc('docx', await makeDocx('<w:p><m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></w:p>'))
    const rendered = new DOMParser().parseFromString(doc.segments[0].html, 'text/html')
    expect(rendered.querySelector('math mfrac')).not.toBeNull()
    expect(rendered.querySelector('math msup')).not.toBeNull()
    expect(doc.text).toContain('a')
    expect(doc.text).toContain('x')
  })

  it('renders combined scripts, default parentheses and square roots without dropping the document', async () => {
    const doc = await parseFlowDoc('docx', await makeDocx('<w:p><m:oMath>'
      + '<m:d><m:e><m:sSubSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sub><m:r><m:t>i</m:t></m:r></m:sub><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSubSup></m:e></m:d>'
      + '<m:rad><m:deg/><m:e><m:r><m:t>y</m:t></m:r></m:e></m:rad>'
      + '</m:oMath></w:p>'))
    const rendered = new DOMParser().parseFromString(doc.segments[0].html, 'text/html')
    expect(Array.from(rendered.querySelector('math msubsup')!.children).map((element) => element.textContent)).toEqual(['x', 'i', '2'])
    expect(rendered.querySelector('math msqrt')).not.toBeNull()
    expect(doc.text).toContain('i')
    expect(doc.text).toContain('y')
  })

  it('renders an integral with one limit and prefix scripts with an omitted slot', async () => {
    const doc = await parseFlowDoc('docx', await makeDocx('<w:p><m:oMath>'
      + '<m:nary><m:naryPr><m:chr m:val="∫"/></m:naryPr><m:sub><m:r><m:t>0</m:t></m:r></m:sub><m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary>'
      + '<m:sPre><m:sub><m:r><m:t>i</m:t></m:r></m:sub><m:e><m:r><m:t>A</m:t></m:r></m:e></m:sPre>'
      + '</m:oMath></w:p>'))
    expect(doc.text).toContain('∫')
    expect(doc.text).toContain('i')
    expect(doc.text).toContain('A')
    expect(doc.segments[0].html).toContain('<munderover>')
  })
})
