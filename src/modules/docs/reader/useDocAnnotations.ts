import { useCallback, useEffect, useState } from 'react'
import type { Annotation, Doc } from '@/db/db'
import { db } from '@/db/db'
import { addAnnotation, deleteAnnotation, updateAnnotation } from '@/db/docs'
import { exportAnnotationsToDoc } from '../exportAnnotations'
import { annotationAnchor } from './locator'
import { type HlColor, type Selection } from './types'

interface Options {
  doc: Doc | undefined
  selection: Selection | null
  /** 加完高亮后清掉浮条与浏览器选区（页面持有，因为选区状态也驱动浮条渲染） */
  clearSelection: () => void
  toast: (message: string) => void
  /** 导出批注为笔记后跳到新文档 */
  onExported: (docId: string) => void
}

/**
 * 批注操作职责（从 DocReaderPage 抽出）：
 * 划词建高亮、改色、写评论、删除、导出为笔记，以及「批注转任务」弹窗的状态。
 *
 * 这里只处理数据与动作，不含任何布局；页面的浮条与侧栏都调同一组方法，
 * 免得「侧栏能改色、浮条不能」这类两套逻辑走偏。
 */
export function useDocAnnotations({ doc, selection, clearSelection, toast, onExported }: Options) {
  const [taskSeed, setTaskSeed] = useState<{ ann: Annotation; doc: Doc } | null>(null)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskNotes, setTaskNotes] = useState('')

  // 预填笔记：勾选内容 + 已有评论
  useEffect(() => {
    if (!taskSeed) return
    const { ann } = taskSeed
    setTaskNotes(`批注：${ann.text}${ann.comment ? `\n评论：${ann.comment}` : ''}`)
    setTaskTitle('')
  }, [taskSeed])

  const create = useCallback(
    async (color: HlColor, withTask = false) => {
      if (!doc || !selection) return
      const base = doc.kind === 'pdf'
        ? { docHash: doc.hash, page: (selection as Extract<Selection, { kind: 'pdf' }>).page, rects: (selection as Extract<Selection, { kind: 'pdf' }>).rects, text: selection.text, color }
        : doc.kind === 'md'
          ? { docHash: doc.hash, blockIdx: (selection as Extract<Selection, { kind: 'md' }>).blockIdx, textAnchors: (selection as Extract<Selection, { kind: 'md' }>).textAnchors, text: selection.text, color }
          : { docHash: doc.hash, blockIdx: (selection as Extract<Selection, { kind: 'flow' }>).segIdx, textAnchors: (selection as Extract<Selection, { kind: 'flow' }>).textAnchors, text: selection.text, color }
      const ann = await addAnnotation(base)
      if (withTask) setTaskSeed({ ann, doc })
      else toast('已添加高亮')
      clearSelection()
      window.getSelection()?.removeAllRanges()
    },
    [doc, selection, toast, clearSelection],
  )

  const remove = useCallback((id: string) => void deleteAnnotation(id), [])
  const recolor = useCallback((id: string, color: Annotation['color']) => void updateAnnotation(id, { color }), [])
  const comment = useCallback((id: string, text?: string) => void updateAnnotation(id, { comment: text }), [])

  const exportNotes = useCallback(() => {
    if (!doc) return
    void exportAnnotationsToDoc(doc).then((id) => {
      toast('批注笔记已生成')
      onExported(id)
    })
  }, [doc, onExported, toast])

  /** 提交「批注转任务」：标题由用户填，勾选内容进笔记 */
  const submitTask = useCallback(async () => {
    if (!taskSeed) return
    const title = taskTitle.trim()
    if (!title) return
    const { ann, doc: d } = taskSeed
    const { addTask } = await import('@/db/tasks')
    const t = await addTask({
      title,
      tier: 'anytime',
      tags: ['批注'],
      notes: taskNotes.trim() || undefined,
    })
    await db.tasks.update(t.id, { docRef: { docId: d.id, anchor: `${annotationAnchor(d, ann)}#${ann.id}`, label: d.title } })
    toast('任务已创建')
    setTaskSeed(null)
    setTaskTitle('')
  }, [taskSeed, taskTitle, taskNotes, toast])

  return {
    create,
    remove,
    recolor,
    comment,
    exportNotes,
    /** 批注定位串（pdf=p 页码；md=b 块号；flow=f 章节号） */
    anchorFor: useCallback((a: Annotation) => (doc ? annotationAnchor(doc, a) : ''), [doc]),
    task: {
      seed: taskSeed,
      title: taskTitle,
      setTitle: setTaskTitle,
      notes: taskNotes,
      setNotes: setTaskNotes,
      open: (ann: Annotation) => { if (doc) setTaskSeed({ ann, doc }) },
      close: () => setTaskSeed(null),
      submit: submitTask,
    },
  }
}
