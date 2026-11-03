import { describe, expect, it } from 'vitest'
import type { PackedMathNote } from '@/modules/tools/mathnotes/backupCodec'
import { buildMathNotesFile, mergeMathNotes, parseMathNotesFile, MATH_NOTES_SYNC_KIND } from './mathNotesSyncMerge'

const packed = (id: string, updatedAt: number, title = id): PackedMathNote => ({
  id, title, enc: 1, strokes: [{ id: 's', width: 3, t0: 0, pts: [10, 20, 50, 0] }], results: [], createdAt: 1, updatedAt,
})
const file = (notes: PackedMathNote[], tombstones: { id: string; ts: number }[] = [], epoch = 0) => buildMathNotesFile('personal-workstation', notes, tombstones, epoch, 0)

describe('mergeMathNotes（独立笔记同步文件）', () => {
  it('同 id 取 updatedAt 更新的一份，两端独有的都保留', () => {
    const r = mergeMathNotes(
      { notes: [packed('a', 100, '本地旧'), packed('l', 1)], tombstones: [], epoch: undefined },
      file([packed('a', 200, '远端新'), packed('r', 1)]),
      { a: packed('a', 100, '本地旧') },
    )
    expect(Object.fromEntries(r.notes.map((n) => [n.id, n.title]))).toEqual({ a: '远端新', l: 'l', r: 'r' })
    expect(r.replaceLocal).toBe(false)
  })

  it('本机删掉、远端还有：墓碑写进文件，结果里没有它', () => {
    const r = mergeMathNotes({ notes: [], tombstones: [{ id: 'gone', ts: 500 }, { id: 'task-x', ts: 1 }], epoch: 0 }, file([packed('gone', 100)]))
    expect(r.notes).toEqual([])
    // 只带笔记相关的墓碑，别的表的墓碑不进笔记文件
    expect(r.tombstones).toEqual([{ id: 'gone', ts: 500 }])
  })

  it('文件里的墓碑让本机旧副本不再复活', () => {
    const r = mergeMathNotes({ notes: [packed('gone', 100)], tombstones: [], epoch: 0 }, file([], [{ id: 'gone', ts: 500 }]))
    expect(r.notes).toEqual([])
  })

  it('另一台设备清空过（远端纪元更大）：本机笔记整份换成远端的', () => {
    const r = mergeMathNotes({ notes: [packed('old', 1)], tombstones: [], epoch: 10 }, file([packed('new', 5)], [], 20))
    expect(r.replaceLocal).toBe(true)
    expect(r.notes.map((n) => n.id)).toEqual(['new'])
    expect(r.epoch).toBe(20)
  })

  it('本机清空过（本机纪元更大）：远端清空前的旧笔记不合并回来', () => {
    const r = mergeMathNotes({ notes: [], tombstones: [], epoch: 30 }, file([packed('old', 1)], [], 0))
    expect(r.notes).toEqual([])
    expect(r.replaceLocal).toBe(false)
    expect(r.epoch).toBe(30)
  })

  it('本机从没同步过笔记（纪元为空）：正常合并，首次同步前写的笔记不会被清掉', () => {
    const r = mergeMathNotes({ notes: [packed('mine', 1)], tombstones: [], epoch: undefined }, file([packed('cloud', 1)], [], 20))
    expect(r.replaceLocal).toBe(false)
    expect(r.notes.map((n) => n.id).sort()).toEqual(['cloud', 'mine'])
    expect(r.epoch).toBe(20)
  })

  it('解析：认不出的文件 / 更新版本的格式拒绝覆盖', () => {
    expect(() => parseMathNotesFile('not json')).toThrow(/合法 JSON/)
    expect(() => parseMathNotesFile(JSON.stringify({ tasks: [] }))).toThrow(/格式不对/)
    expect(() => parseMathNotesFile(JSON.stringify({ kind: MATH_NOTES_SYNC_KIND, version: 99, notes: [] }))).toThrow(/升级/)
    expect(parseMathNotesFile(JSON.stringify(file([packed('a', 1)]))).notes).toHaveLength(1)
  })
})


it('同一页从共同版本分别修改后同步，保留双方修改', () => {
  const base = packed('a', 100, '共同版本')
  const local = packed('a', 200, '本机修改')
  const remote = packed('a', 300, '另一台修改')
  const result = mergeMathNotes({ notes: [local], tombstones: [], epoch: 0 }, file([remote]), { a: base })
  expect(result.notes.map(n => n.title).sort()).toEqual(['另一台修改', '本机修改（冲突副本）'].sort())
})


it('只有本机修改时，即使设备时钟较慢也保留本机修改', () => {
  const base = packed('a', 100, '共同版本')
  const local = packed('a', 101, '本机修改')
  const remote = { ...base, updatedAt: 500 }
  const result = mergeMathNotes({ notes: [local], tombstones: [], epoch: 0 }, file([remote]), { a: base })
  expect(result.notes.map(n => n.title)).toEqual(['本机修改'])
})

it('缺少共同基线且内容不同时保留两边，避免恢复或首次同步覆盖数据', () => {
  const result = mergeMathNotes({ notes: [packed('a', 200, '本机')], tombstones: [], epoch: 0 }, file([packed('a', 300, '远端')]))
  expect(result.notes.map(n => n.title).sort()).toEqual(['本机（冲突副本）', '远端'].sort())
})
