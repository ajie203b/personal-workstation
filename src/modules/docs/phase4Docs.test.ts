import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib'
import type { Annotation, Doc } from '@/db/db'
import { formatCitation } from './citation'
import { buildAnnotatedPdfBytes, buildAnnotationMarkdown } from './exportAnnotations'
import { docMentionsTitle, extractWikiLinkTargets, findDocByWikiTarget } from './wikiLinks'

const sampleDoc: Doc = {
  id: 'doc-abc123',
  hash: 'h-sample',
  title: 'Transformer 综述',
  kind: 'pdf',
  size: 2048,
  addedAt: 1000,
  tags: ['LLM', '论文'],
  meta: {
    author: '张三; 李四; 王五; 赵六',
    year: '2025',
    venue: '计算机学报',
    doi: '10.11897/SP.J.1016.2025.0001',
  },
}

describe('Phase 4 citations (GB/T 7714 / APA 7 / MLA 9)', () => {
  it('按 GB/T 7714-2015 格式化超 3 位中文作者与期刊 DOI', () => {
    const out = formatCitation(sampleDoc, 'gbt7714')
    expect(out).toBe('张三, 李四, 王五, 等. Transformer 综述[J]. 计算机学报, 2025. DOI:10.11897/SP.J.1016.2025.0001.')
  })

  it('按 APA 7 与 MLA 9 格式化英文论文引用', () => {
    const enDoc: Doc = {
      id: 'doc-en1',
      hash: 'h-en1',
      title: 'Attention Is All You Need',
      kind: 'pdf',
      size: 100,
      addedAt: 1,
      meta: { author: 'Vaswani, A.; Shazeer, N.; Parmar, N.', year: '2017', venue: 'NeurIPS', doi: '10.48550/arXiv.1706.03762' },
    }
    const apa = formatCitation(enDoc, 'apa')
    expect(apa).toContain('Vaswani, A., Shazeer, N., & Parmar, N.')
    expect(apa).toContain('(2017). Attention Is All You Need. NeurIPS. https://doi.org/10.48550/arXiv.1706.03762')

    const mla = formatCitation(enDoc, 'mla')
    expect(mla).toBe('Vaswani, A., et al. "Attention Is All You Need." NeurIPS, 2017, doi:10.48550/arXiv.1706.03762.')
  })
})

describe('Phase 4 annotation export & annotated PDF', () => {
  it('导出批注 Markdown 附带 Obsidian 兼容 YAML Frontmatter 与多行评论缩进', async () => {
    const anns: Annotation[] = [
      {
        id: 'ann-1',
        docHash: sampleDoc.hash,
        page: 3,
        text: '自注意力机制能够并行建模长距离依赖。',
        comment: '核心结论\n后续实验需复现',
        color: 'yellow',
        createdAt: 100,
      },
    ]
    const md = await buildAnnotationMarkdown(sampleDoc, anns)
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('title: "Transformer 综述"')
    expect(md).toContain('doi: "10.11897/SP.J.1016.2025.0001"')
    expect(md).toContain('  - "LLM"')
    expect(md).toContain('annotations: 1')
    expect(md).toContain('## 第 3 页')
    expect(md).toContain('  - 评论：核心结论\n    后续实验需复现')
  })

  it('将高亮矩形与中文评论写入真实 PDF Annotation 层（/Subtype /Highlight）', async () => {
    const blank = await PDFDocument.create()
    blank.addPage([595, 842])
    const baseBytes = await blank.save()

    const anns: Annotation[] = [
      {
        id: 'hl-1',
        docHash: 'h',
        page: 1,
        text: '重要定理',
        comment: '需要进一步验证',
        color: 'yellow',
        rects: [{ x: 0.1, y: 0.2, w: 0.4, h: 0.03 }],
        createdAt: 1,
      },
      {
        id: 'hl-2',
        docHash: 'h',
        page: 1,
        text: '另一段摘录',
        color: 'blue',
        rects: [{ x: 0.1, y: 0.5, w: 0.5, h: 0.04 }],
        createdAt: 2,
      },
      // 越界页码应被安全忽略
      {
        id: 'hl-skip',
        docHash: 'h',
        page: 99,
        text: '不存在的页',
        color: 'red',
        rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.02 }],
        createdAt: 3,
      },
    ]

    const outBytes = await buildAnnotatedPdfBytes(baseBytes, anns)
    const reloaded = await PDFDocument.load(outBytes)
    const page = reloaded.getPage(0)
    const annots = page.node.lookup(PDFName.of('Annots'))
    expect(annots).toBeInstanceOf(PDFArray)
    expect((annots as PDFArray).size()).toBe(2)
  })
})

describe('Phase 4 WikiLinks 双链解析与反链匹配', () => {
  it('提取正文双链、支持别名并跳过代码块与行内代码', () => {
    const md = [
      '参见 [[Transformer 综述]] 以及 [[深度学习笔记|DL 笔记]]。',
      '重复提及 [[transformer 综述]] 应去重。',
      '行内代码 `[[忽略我]]` 不算双链。',
      '```md',
      '[[代码块里的也忽略]]',
      '```',
    ].join('\n')

    expect(extractWikiLinkTargets(md)).toEqual(['Transformer 综述', '深度学习笔记'])
    expect(docMentionsTitle(md, 'Transformer 综述.md')).toBe(true)
    expect(docMentionsTitle(md, '忽略我')).toBe(false)
    expect(docMentionsTitle(md, '代码块里的也忽略')).toBe(false)
  })

  it('忽略扩展名与大小写匹配在库文档，跳过回收站文档', () => {
    const docs: Doc[] = [
      { id: '1', hash: 'h1', title: 'Deleted Note.md', kind: 'md', size: 10, addedAt: 1, deletedAt: 10 },
      { id: '2', hash: 'h2', title: 'Transformer 综述.md', kind: 'md', size: 10, addedAt: 2 },
    ]
    expect(findDocByWikiTarget(docs, 'transformer 综述')?.id).toBe('2')
    expect(findDocByWikiTarget(docs, 'Deleted Note')).toBeUndefined()
  })
})
