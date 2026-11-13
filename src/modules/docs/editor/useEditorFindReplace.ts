import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import type { Editor } from '@tiptap/core'
import {
  findMatchesInDoc,
  findTextMatches,
  replaceAllInEditor,
  replaceOneInEditor,
} from './editorFind'

export function useEditorFindReplace({
  editor,
  docTick,
  sourceMode,
  sourceText,
  onSourceChange,
  textareaRef,
  containerRef,
}: {
  editor: Editor | null
  docTick: number
  sourceMode: boolean
  sourceText: string
  onSourceChange: (next: string) => void
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  containerRef?: RefObject<HTMLElement | null>
}) {
  const [open, setOpen] = useState(false)
  const [showReplace, setShowReplace] = useState(false)
  const [focusTick, setFocusTick] = useState(0)
  const [query, setQuery] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [active, setActive] = useState(0)

  const docMatches = useMemo(() => {
    if (!open || sourceMode || !editor || !query) return []
    void docTick
    return findMatchesInDoc(editor.state.doc, query, caseSensitive)
  }, [open, sourceMode, editor, query, caseSensitive, docTick])

  const textMatches = useMemo(() => {
    if (!open || !sourceMode || !query) return []
    return findTextMatches(sourceText, query, caseSensitive)
  }, [open, sourceMode, sourceText, query, caseSensitive])

  const total = sourceMode ? textMatches.length : docMatches.length
  const safeActive = total > 0 ? Math.min(active, total - 1) : 0

  useEffect(() => {
    setActive((prev) => (total === 0 ? 0 : Math.min(prev, total - 1)))
  }, [total])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.commands.setEditorFind({
      query: open && !sourceMode ? query : '',
      activeIndex: safeActive,
      caseSensitive,
    })
  }, [editor, open, sourceMode, query, safeActive, caseSensitive, docTick])

  const revealMatch = useCallback((idx: number) => {
    if (sourceMode) {
      const m = textMatches[idx]
      const ta = textareaRef?.current
      if (!m || !ta) return
      requestAnimationFrame(() => {
        ta.focus()
        ta.setSelectionRange(m.start, m.end)
      })
      return
    }
    requestAnimationFrame(() => {
      const root = containerRef?.current ?? document
      const el = root.querySelector('.find-hit-active') as HTMLElement | null
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [sourceMode, textMatches, textareaRef, containerRef])

  const openFind = useCallback((withReplace = false) => {
    setOpen(true)
    if (withReplace) setShowReplace(true)
    setFocusTick((t) => t + 1)
  }, [])

  const closeFind = useCallback(() => {
    setOpen(false)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        openFind(false)
      } else if (e.key === 'h' || e.key === 'H') {
        e.preventDefault()
        openFind(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openFind])

  const onNext = useCallback(() => {
    if (total === 0) return
    const next = (safeActive + 1) % total
    setActive(next)
    revealMatch(next)
  }, [total, safeActive, revealMatch])

  const onPrev = useCallback(() => {
    if (total === 0) return
    const next = (safeActive - 1 + total) % total
    setActive(next)
    revealMatch(next)
  }, [total, safeActive, revealMatch])

  const onReplaceCurrent = useCallback(() => {
    if (total === 0) return
    if (sourceMode) {
      const m = textMatches[safeActive]
      if (!m) return
      const next = sourceText.slice(0, m.start) + replaceText + sourceText.slice(m.end)
      onSourceChange(next)
      return
    }
    if (!editor) return
    const m = docMatches[safeActive]
    if (!m) return
    replaceOneInEditor(editor, m, replaceText)
  }, [total, sourceMode, textMatches, safeActive, sourceText, replaceText, onSourceChange, editor, docMatches])

  const onReplaceAll = useCallback(() => {
    if (total === 0) return
    if (sourceMode) {
      let next = sourceText
      for (let i = textMatches.length - 1; i >= 0; i--) {
        const m = textMatches[i]
        next = next.slice(0, m.start) + replaceText + next.slice(m.end)
      }
      onSourceChange(next)
      setActive(0)
      return
    }
    if (!editor) return
    replaceAllInEditor(editor, docMatches, replaceText)
    setActive(0)
  }, [total, sourceMode, textMatches, sourceText, replaceText, onSourceChange, editor, docMatches])

  return {
    open,
    showReplace,
    setShowReplace,
    focusTick,
    query,
    setQuery: (q: string) => {
      setQuery(q)
      setActive(0)
    },
    replaceText,
    setReplaceText,
    caseSensitive,
    toggleCase: () => {
      setCaseSensitive((c) => !c)
      setActive(0)
    },
    active: safeActive,
    total,
    openFind,
    closeFind,
    onNext,
    onPrev,
    onReplaceCurrent,
    onReplaceAll,
  }
}
