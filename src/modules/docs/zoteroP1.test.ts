import { describe, expect, it } from 'vitest'
import type { Annotation, Doc, Folder } from '@/db/db'
import { UNFILED_FOLDER } from './DocDrag'
import { formatCitation } from './citation'
import {
  ALL_DOCS_VIEW,
  ANNOTATED_VIEW,
  RECENT_VIEW,
  STARRED_VIEW,
  buildFolderTree,
  collectSubtreeIds,
  effectiveReadStatus,
  filterAndSortDocs,
  folderPathName,
} from './libraryModel'
import { filterAndSortReaderAnnotations } from './reader/ReaderPanels'
import { isAnnotationDue, scheduleReview } from './reviewSm2'

const mkFolder = (id: string, name: string, parentId?: string, createdAt = 1): Folder => ({
  id,
  name,
  parentId,
  createdAt,
  updatedAt: createdAt,
})

const mkDoc = (id: string, overrides: Partial<Doc> = {}): Doc => ({
  id,
  hash: `h_${id}`,
  title: `Doc ${id}`,
  kind: 'pdf',
  size: 100,
  addedAt: 1000,
  ...overrides,
})

describe('libraryModel (multi-level folders & smart views)', () => {
  it('builds nested tree and survives dangling or cyclic parentIds', () => {
    const folders: Folder[] = [
      mkFolder('root1', '论文', undefined, 1),
      mkFolder('sub1', 'NLP', 'root1', 2),
      mkFolder('sub2', 'LLM', 'sub1', 3),
      mkFolder('dangling', '孤儿', 'missing', 4),
      mkFolder('cycA', '环A', 'cycB', 5),
      mkFolder('cycB', '环B', 'cycA', 6),
    ]
    const tree = buildFolderTree(folders)
    expect(tree[0].folder.id).toBe('root1')
    expect(tree[0].children[0].folder.id).toBe('sub1')
    expect(tree[0].children[0].children[0].folder.id).toBe('sub2')
    expect(tree.some((n) => n.folder.id === 'dangling')).toBe(true)
    const flatIds: string[] = []
    const walk = (nodes: typeof tree) => {
      for (const n of nodes) {
        flatIds.push(n.folder.id)
        walk(n.children)
      }
    }
    walk(tree)
    expect(new Set(flatIds).size).toBe(6)
  })

  it('collects subtree ids and formats folder path', () => {
    const folders = [mkFolder('f1', '科研'), mkFolder('f2', '综述', 'f1'), mkFolder('f3', '2025', 'f2')]
    expect([...collectSubtreeIds('f1', folders)].sort()).toEqual(['f1', 'f2', 'f3'])
    expect(folderPathName('f3', folders)).toBe('科研 / 综述 / 2025')
  })

  it('filters across smart views, subtree folders, metadata, tags and sorts properly', () => {
    const folders = [mkFolder('f1', 'AI'), mkFolder('f2', 'Agents', 'f1')]
    const docs: Doc[] = [
      mkDoc('1', { title: 'Attention Is All You Need', folderId: 'f2', starred: true, tags: ['transformer'], meta: { author: 'Vaswani', year: '2017', venue: 'NeurIPS' }, lastOpenedAt: 5000 }),
      mkDoc('2', { title: 'Unfiled Note', kind: 'md', tags: ['draft'], addedAt: 2000 }),
      mkDoc('3', { title: 'Finished Paper', folderId: 'f1', readStatus: 'done', addedAt: 3000 }),
    ]
    const progressMap = { h_1: { progressPct: 0.4 }, h_3: { progressPct: 1 } }
    const annCountByHash = { h_1: 5 }

    expect(filterAndSortDocs({ docs, view: ALL_DOCS_VIEW, folders, kindFilter: 'all', statusFilter: 'all', tagFilter: '', annCountByHash, progressMap, sortBy: 'recent', query: '', textHits: {} }).map((d) => d.id)).toEqual(['1', '3', '2'])
    expect(filterAndSortDocs({ docs, view: STARRED_VIEW, folders, kindFilter: 'all', statusFilter: 'all', tagFilter: '', annCountByHash, progressMap, sortBy: 'recent', query: '', textHits: {} }).map((d) => d.id)).toEqual(['1'])
    expect(filterAndSortDocs({ docs, view: RECENT_VIEW, folders, kindFilter: 'all', statusFilter: 'all', tagFilter: '', annCountByHash, progressMap, sortBy: 'recent', query: '', textHits: {} }).map((d) => d.id)).toEqual(['1'])
    expect(filterAndSortDocs({ docs, view: ANNOTATED_VIEW, folders, kindFilter: 'all', statusFilter: 'all', tagFilter: '', annCountByHash, progressMap, sortBy: 'recent', query: '', textHits: {} }).map((d) => d.id)).toEqual(['1'])
    expect(filterAndSortDocs({ docs, view: UNFILED_FOLDER, folders, kindFilter: 'all', statusFilter: 'all', tagFilter: '', annCountByHash, progressMap, sortBy: 'recent', query: '', textHits: {} }).map((d) => d.id)).toEqual(['2'])
    expect(filterAndSortDocs({ docs, view: 'f1', folders, kindFilter: 'all', statusFilter: 'all', tagFilter: '', annCountByHash, progressMap, sortBy: 'title', query: '', textHits: {} }).map((d) => d.id)).toEqual(['1', '3'])
    expect(filterAndSortDocs({ docs, view: ALL_DOCS_VIEW, folders, kindFilter: 'all', statusFilter: 'all', tagFilter: 'transformer', annCountByHash, progressMap, sortBy: 'recent', query: 'Vaswani', textHits: {} }).map((d) => d.id)).toEqual(['1'])
    expect(effectiveReadStatus(docs[0], 0.4)).toBe('reading')
    expect(effectiveReadStatus(docs[1], 0)).toBe('unread')
    expect(effectiveReadStatus(docs[2], 0.2)).toBe('done')
  })
})

describe('citation & reviewSm2 & reader annotation filters', () => {
  it('formats bibtex, ris, and markdown citations', () => {
    const doc = mkDoc('doc123456', {
      title: 'Deep Residual Learning',
      meta: { author: 'He Kaiming, Zhang Xiangyu', year: '2016', venue: 'CVPR', doi: '10.1109/CVPR.2016.90' },
      sourceUrl: 'https://example.com/resnet.pdf',
    })
    const bib = formatCitation(doc, 'bibtex')
    expect(bib).toContain('@article{hekaiming2016_doc123,')
    expect(bib).toContain('author = {He Kaiming and Zhang Xiangyu}')
    expect(bib).toContain('journal = {CVPR}')
    expect(bib).toContain('doi = {10.1109/CVPR.2016.90}')

    const ris = formatCitation(doc, 'ris')
    expect(ris).toContain('TY  - JOUR')
    expect(ris).toContain('AU  - He Kaiming')
    expect(ris).toContain('AU  - Zhang Xiangyu')
    expect(ris).toContain('ER  -')

    const md = formatCitation(doc, 'markdown')
    expect(md).toBe('[Deep Residual Learning](#/docs/doc123456) (He Kaiming, Zhang Xiangyu, 2016, CVPR, DOI: 10.1109/CVPR.2016.90)')
  })

  it('preserves family-name commas and escapes BibTeX field values', () => {
    const doc = mkDoc('doc123456', {
      title: 'Sets {A} & 50% of B',
      meta: { author: 'Vaswani, A.; Shazeer, N.', venue: 'Research & Design' },
    })
    expect(formatCitation(doc, 'bibtex')).toContain(String.raw`title = {Sets {\textbraceleft}A{\textbraceright} \& 50\% of B}`)
    expect(formatCitation(doc, 'bibtex')).toContain('author = {Vaswani, A. and Shazeer, N.}')
    expect(formatCitation(doc, 'ris').split('\n').filter((line) => line.startsWith('AU  - ')))
      .toEqual(['AU  - Vaswani, A.', 'AU  - Shazeer, N.'])
    doc.meta!.author = 'Vaswani, A.'
    expect(formatCitation(doc, 'ris').split('\n').filter((line) => line.startsWith('AU  - ')))
      .toEqual(['AU  - Vaswani, A.'])
  })

  it('schedules SM-2 intervals and due checks', () => {
    const r1 = scheduleReview(undefined, 2, '2026-11-01', 100)
    expect(r1).toMatchObject({ reps: 1, interval: 1, due: '2026-11-02', lastAt: 100 })
    const r2 = scheduleReview(r1, 2, '2026-11-02', 200)
    expect(r2).toMatchObject({ reps: 2, interval: 3, due: '2026-11-05' })
    const r3 = scheduleReview(r2, 3, '2026-11-05', 300)
    expect(r3.interval).toBeGreaterThan(r2.interval)
    const reset = scheduleReview(r3, 0, '2026-11-15', 400)
    expect(reset).toMatchObject({ reps: 0, interval: 1, due: '2026-11-16' })
    expect(reset.ease).toBeGreaterThanOrEqual(1.3)

    const aDue: Annotation = { id: 'a1', docHash: 'h', text: 't', color: 'yellow', createdAt: 1, review: r1 }
    expect(isAnnotationDue(aDue, '2026-11-02')).toBe(true)
    expect(isAnnotationDue(aDue, '2026-11-01')).toBe(false)
  })

  it('filters and sorts reader panel annotations', () => {
    const anns: Annotation[] = [
      { id: 'p5', docHash: 'h', page: 5, text: 'Page five theorem', color: 'yellow', createdAt: 100, comment: 'check proof' },
      { id: 'p2', docHash: 'h', page: 2, kind: 'shot', text: 'Figure 1', color: 'blue', createdAt: 300 },
      { id: 'p1', docHash: 'h', page: 1, text: 'Intro claim', color: 'green', createdAt: 200 },
    ]
    expect(filterAndSortReaderAnnotations(anns, { sortBy: 'position' }).map((a) => a.id)).toEqual(['p1', 'p2', 'p5'])
    expect(filterAndSortReaderAnnotations(anns, { sortBy: 'newest' }).map((a) => a.id)).toEqual(['p2', 'p1', 'p5'])
    expect(filterAndSortReaderAnnotations(anns, { kind: 'shot' }).map((a) => a.id)).toEqual(['p2'])
    expect(filterAndSortReaderAnnotations(anns, { kind: 'commented' }).map((a) => a.id)).toEqual(['p5'])
    expect(filterAndSortReaderAnnotations(anns, { query: 'proof' }).map((a) => a.id)).toEqual(['p5'])
    expect(filterAndSortReaderAnnotations(anns, { color: 'green' }).map((a) => a.id)).toEqual(['p1'])
  })
})
