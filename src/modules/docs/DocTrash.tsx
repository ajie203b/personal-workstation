import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { RotateCcw, Trash2 } from 'lucide-react'
import { db, type Doc } from '@/db/db'
import { emptyDocTrash, purgeDoc, restoreDoc } from '@/db/docs'
import { FileTypeIcon } from '@/shared/FileTypeIcon'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Sheet'
import { useUi } from '@/stores/ui'

export function DocTrash() {
  const docs = useLiveQuery(() => db.docs.filter(d => !!d.deletedAt).toArray().then(rows => rows.sort((a, b) => b.deletedAt! - a.deletedAt!)), [], [])
  const [confirm, setConfirm] = useState<Doc | 'all' | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useUi(s => s.toast)
  const run = async (action: () => Promise<void>, message: string) => {
    setBusy(true)
    try { await action(); setConfirm(null); toast(message) }
    catch { toast('操作失败，请重试') }
    finally { setBusy(false) }
  }
  return <section aria-label="回收站" className="flex flex-col gap-3">
    <div className="flex items-center justify-between gap-2">
      <div><h2 className="font-semibold">回收站 · {docs.length}</h2><p className="text-xs text-on-surface-2 mt-1">最近删除的文档会保留在这里，恢复时保留批注和阅读进度。</p></div>
      <Button size="sm" variant="destructive" disabled={!docs.length || busy} onClick={() => setConfirm('all')}>清空回收站</Button>
    </div>
    {!docs.length && <p className="py-12 text-center text-on-surface-2">回收站为空</p>}
    {docs.map(doc => <article className="card p-4 flex flex-wrap items-center gap-3" key={doc.id}>
      <FileTypeIcon kind={doc.kind} size={30} />
      <div className="flex-1 min-w-0"><p className="font-medium truncate">{doc.title}</p><p className="text-xs text-on-surface-2 mt-1">删除于 {new Date(doc.deletedAt!).toLocaleString('zh-CN')}</p></div>
      <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void run(() => restoreDoc(doc.id), '文档已恢复')}><RotateCcw size={14} />恢复</Button>
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => setConfirm(doc)}><Trash2 size={14} />彻底删除</Button></div>
    </article>)}
    <Dialog open={confirm !== null} onOpenChange={v => { if (!v && !busy) setConfirm(null) }} title={confirm === 'all' ? '清空回收站？' : '彻底删除文档？'} description={confirm === 'all' ? '回收站内所有文档、批注及阅读进度都会永久删除，无法恢复。' : `「${confirm && confirm.title || ''}」及其批注、阅读进度将永久删除，无法恢复。`}>
      <div className="flex justify-end gap-2"><Button disabled={busy} onClick={() => setConfirm(null)}>取消</Button><Button variant="destructive" disabled={busy} onClick={() => void run(() => confirm === 'all' ? emptyDocTrash() : confirm ? purgeDoc(confirm.id) : Promise.resolve(), '已彻底删除')}>确认删除</Button></div>
    </Dialog>
  </section>
}
