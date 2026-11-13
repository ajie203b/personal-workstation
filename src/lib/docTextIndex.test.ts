import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { backfillDocTextIndex } from './docTextIndex'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('backfillDocTextIndex deleted filtering', () => {
  it('skips soft-deleted docs in trash while indexing active docs', async () => {
    await db.blobs.bulkPut([
      { hash: 'h-trash', blob: new Blob(['trashed content']) },
      { hash: 'h-active', blob: new Blob(['active document body']) },
    ])
    await db.docs.bulkPut([
      { id: 'd-trash', hash: 'h-trash', title: 'Trashed', kind: 'txt', size: 15, addedAt: 1, deletedAt: 123 },
      { id: 'd-active', hash: 'h-active', title: 'Active', kind: 'txt', size: 20, addedAt: 2 },
    ])

    const indexed = await backfillDocTextIndex(5)
    expect(indexed).toBe(1)
    expect(await db.docText.get('h-trash')).toBeUndefined()
    expect((await db.docText.get('h-active'))?.text).toBe('active document body')
  })
})
