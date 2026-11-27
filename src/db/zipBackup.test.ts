import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { exportAll } from './tasks'
import { exportBackupZip, importBackupFile, inspectBackupFile } from './zipBackup'

describe('zipBackup（.kairos.zip 紧凑备份与选择性恢复）', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('导出 .kairos.zip，保留二进制文档本体，并支持预览与覆盖恢复（保留本机凭据）', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff])
    const mdText = '# 测试文档\n\n正文内容'
    await db.tasks.put({
      id: 't1',
      title: '完成 Phase 2 测试',
      tier: 'today',
      priority: 1,
      status: 'todo',
      tags: ['dev'],
      createdAt: 1000,
      updatedAt: 2000,
    })
    await db.docs.put({
      id: 'd1',
      hash: 'h-pdf',
      title: '论文.pdf',
      kind: 'pdf',
      size: pdfBytes.byteLength,
      addedAt: 1000,
    })
    await db.blobs.put({ hash: 'h-pdf', blob: new Blob([pdfBytes], { type: 'application/pdf' }) })
    await db.docs.put({
      id: 'd2',
      hash: 'h-md',
      title: '笔记.md',
      kind: 'md',
      size: mdText.length,
      addedAt: 1200,
    })
    await db.blobs.put({ hash: 'h-md', blob: new Blob([mdText], { type: 'text/markdown' }) })
    await db.mathNotes.put({
      id: 'm1',
      title: '草稿 1',
      strokes: [],
      results: [],
      createdAt: 1000,
      updatedAt: 1500,
    })
    await db.settings.put({ key: 'accent', value: 'purple' })
    await db.settings.put({ key: 'webdav', value: { url: 'https://dav.example.com', username: 'u', password: 'secret', auto: true } })

    const zipBlob = await exportBackupZip()
    const head = new Uint8Array(await zipBlob.slice(0, 4).arrayBuffer())
    expect(Array.from(head)).toEqual([0x50, 0x4b, 0x03, 0x04])

    const preview = await inspectBackupFile(zipBlob)
    expect(preview.format).toBe('zip')
    expect(preview.counts).toMatchObject({
      tasks: 1,
      docs: 2,
      blobs: 2,
      mathNotes: 1,
      settings: 1, // webdav 凭据不会进入备份
    })

    // 模拟另一台已配置本机 WebDAV 的设备清空并覆盖恢复
    await db.delete()
    await db.open()
    await db.settings.put({ key: 'webdav', value: { url: 'https://local.dav', username: 'me', password: 'pw', auto: false } })

    await importBackupFile(zipBlob, { mode: 'replace' })
    expect((await db.tasks.get('t1'))?.title).toBe('完成 Phase 2 测试')
    expect((await db.mathNotes.get('m1'))?.title).toBe('草稿 1')
    expect((await db.settings.get('accent'))?.value).toBe('purple')
    // 本机 WebDAV 凭据必须保留
    expect((await db.settings.get('webdav'))?.value).toMatchObject({ username: 'me', password: 'pw' })

    // 二进制 PDF 字节完全一致
    const restoredPdf = await db.blobs.get('h-pdf')
    expect(restoredPdf).toBeDefined()
    expect(new Uint8Array(await restoredPdf!.blob.arrayBuffer())).toEqual(pdfBytes)
    const restoredMd = await db.blobs.get('h-md')
    expect(await restoredMd!.blob.text()).toBe(mdText)
  })

  it('支持按模块选择性恢复，且合并模式清理被恢复条目的墓碑防止同步误删', async () => {
    await db.tasks.put({
      id: 't-restore',
      title: '被误删的任务',
      tier: 'today',
      priority: 2,
      status: 'todo',
      tags: [],
      createdAt: 1000,
      updatedAt: 2000,
    })
    await db.docs.put({
      id: 'd-backup',
      hash: 'h-backup',
      title: '备份文档',
      kind: 'md',
      size: 5,
      addedAt: 1000,
    })
    await db.blobs.put({ hash: 'h-backup', blob: new Blob(['hello'], { type: 'text/markdown' }) })

    const zipBlob = await exportBackupZip()

    // 模拟当前设备：删除了 t-restore（留下墓碑），但新增了自己的文档 d-local
    await db.tasks.clear()
    await db.docs.clear()
    await db.blobs.clear()
    await db.tombstones.put({ id: 't-restore', ts: 5000 })
    await db.docs.put({ id: 'd-local', hash: 'h-local', title: '本机文档', kind: 'md', size: 4, addedAt: 3000 })

    // 仅选择恢复 tasks（不选 docs）
    await importBackupFile(zipBlob, { mode: 'merge', scopes: ['tasks'] })

    expect((await db.tasks.get('t-restore'))?.title).toBe('被误删的任务')
    expect(await db.tombstones.get('t-restore')).toBeUndefined()
    // docs 未勾选，备份里的 d-backup 不应导入，本机 d-local 应保持原样
    expect(await db.docs.get('d-backup')).toBeUndefined()
    expect((await db.docs.get('d-local'))?.title).toBe('本机文档')
  })

  it('向下兼容旧版 .json 备份，并对损坏文件给出明确报错', async () => {
    await db.tasks.put({
      id: 't-legacy',
      title: '旧版 JSON 任务',
      tier: 'anytime',
      priority: 3,
      status: 'todo',
      tags: [],
      createdAt: 1000,
      updatedAt: 1000,
    })
    const jsonBlob = new Blob([await exportAll()], { type: 'application/json' })
    const preview = await inspectBackupFile(jsonBlob)
    expect(preview.format).toBe('json')
    expect(preview.counts.tasks).toBe(1)

    await db.tasks.clear()
    await importBackupFile(jsonBlob, { mode: 'merge', scopes: ['tasks'] })
    expect((await db.tasks.get('t-legacy'))?.title).toBe('旧版 JSON 任务')

    const brokenZip = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01])], { type: 'application/zip' })
    await expect(inspectBackupFile(brokenZip)).rejects.toThrow('ZIP 备份文件已损坏')
    await expect(inspectBackupFile(new Blob(['not json']))).rejects.toThrow('不是合法的 Kairos')
  })
})
