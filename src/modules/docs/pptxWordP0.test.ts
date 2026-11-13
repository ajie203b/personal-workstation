// @vitest-environment jsdom
import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import { parsePptxSlideParagraphs } from '@/lib/pptxXml'
import { extractDocText } from '@/lib/docTextIndex'
import { parseFlowDoc } from './flowDoc'
import { extractWordHeadingStyles } from './wordMath'
import { normalizeWordTypography } from './wordTypography'
import { parseWordDoc } from './wordDoc'

vi.mock('docx-preview', () => ({
  renderAsync: vi.fn(async (_buf: ArrayBuffer, body: HTMLElement, styles: HTMLElement) => {
    body.innerHTML = [
      '<section class="docx">',
      '<p class="docx_1"><span style="font-size: 16pt">第一章 引言</span></p>',
      '<p class="docx_customsub"><span>1.1 背景</span></p>',
      '<h3 id="dup-id">重要小节</h3>',
      '<h3 id="dup-id">重复 ID 小节</h3>',
      '<p>正文内容</p>',
      '</section>',
    ].join('')
    styles.innerHTML = '<style></style><style>.docx_1 { color: navy; }</style>'
  }),
}))

async function makePptxBlob(slides: string[]): Promise<Blob> {
  const zip = new JSZip()
  slides.forEach((xml, idx) => {
    zip.file(`ppt/slides/slide${idx + 1}.xml`, xml)
  })
  const buf = await zip.generateAsync({ type: 'arraybuffer' })
  return new Blob([buf])
}

async function makeMinimalDocxBlob(stylesXml: string): Promise<Blob> {
  const zip = new JSZip()
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>')
  zip.file('word/styles.xml', stylesXml)
  const buf = await zip.generateAsync({ type: 'arraybuffer' })
  return new Blob([buf])
}

const SAMPLE_SLIDE_XML = `
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:p>
      <a:r><a:t xml:space="preserve">Hello </a:t></a:r>
      <a:r><a:t>World &amp; &lt;PPTX&gt;</a:t></a:r>
      <a:br/>
      <a:r><a:t>Second line</a:t></a:r>
      <a:tab/>
      <a:r><a:t>Tabbed</a:t></a:r>
    </a:p>
    <a:p>
      <a:r><a:t>第二段</a:t></a:r>
    </a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>
`

const SAMPLE_STYLES_XML = `
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="1">
    <w:name w:val="Heading 1"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2CN">
    <w:name w:val="标题 2"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="CustomSub">
    <w:name w:val="My Subheading"/>
    <w:basedOn w:val="Heading2CN"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="OutlineOnly">
    <w:name w:val="Section Three"/>
    <w:pPr><w:outlineLvl w:val="2"/></w:pPr>
  </w:style>
</w:styles>
`

describe('PPTX DOMParser extraction', () => {
  it('decodes xml:space="preserve", entities, breaks, and tabs across paragraphs', () => {
    const paragraphs = parsePptxSlideParagraphs(SAMPLE_SLIDE_XML)
    expect(paragraphs).toEqual(['Hello World & <PPTX>\nSecond line Tabbed', '第二段'])
  })

  it('produces decoded slide segments in both parseFlowDoc and extractDocText', async () => {
    const blob = await makePptxBlob([SAMPLE_SLIDE_XML])
    const flow = await parseFlowDoc('pptx', blob)
    expect(flow.unit).toBe('slide')
    expect(flow.segments[0].text).toBe('Hello World & <PPTX> Second line Tabbed 第二段')
    expect(flow.segments[0].html).toContain('Hello World &amp; &lt;PPTX&gt;<br/>Second line Tabbed')

    const extracted = await extractDocText('pptx', blob)
    expect(extracted.segmentUnit).toBe('slide')
    expect(extracted.segments).toEqual(['Hello World & <PPTX> Second line Tabbed 第二段'])
  })
})

describe('Word heading hierarchy & FlowDoc TOC', () => {
  it('extracts standard, localized, basedOn-inherited, and outlineLvl heading styles', () => {
    const map = extractWordHeadingStyles(SAMPLE_STYLES_XML)
    expect(map.get('docx_1')).toBe(1)
    expect(map.get('docx_heading2cn')).toBe(2)
    expect(map.get('docx_customsub')).toBe(2)
    expect(map.get('docx_outlineonly')).toBe(3)

    const root = document.createElement('div')
    root.innerHTML = '<p class="docx_customsub">Inherited</p><p class="docx_outlineonly">Outline</p>'
    normalizeWordTypography(root, map)
    expect(root.children[0].classList.contains('word-heading-2')).toBe(true)
    expect(root.children[1].classList.contains('word-heading-3')).toBe(true)
  })

  it('builds unique el: TOC anchors from Word styles and native heading tags', async () => {
    const docx = await makeMinimalDocxBlob(SAMPLE_STYLES_XML)
    const flow = await parseWordDoc(docx)
    expect(flow.toc).toHaveLength(4)
    expect(flow.toc!.map((t) => ({ level: t.level, title: t.title }))).toEqual([
      { level: 0, title: '第一章 引言' },
      { level: 1, title: '1.1 背景' },
      { level: 2, title: '重要小节' },
      { level: 2, title: '重复 ID 小节' },
    ])
    const anchors = flow.toc!.map((t) => t.anchor)
    expect(anchors.every((a) => a.startsWith('el:'))).toBe(true)
    expect(new Set(anchors).size).toBe(4)
  })
})
