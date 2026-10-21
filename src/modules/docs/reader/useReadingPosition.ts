import { useCallback, useEffect, useState } from 'react'
import type { DocSettings } from '@/db/db'
import { getPosition, saveDocSettings } from '@/db/docs'
import { anchorOf } from './locator'

export const DEFAULT_SETTINGS: DocSettings = { theme: 'day', fontSize: 17, leading: 1.85, widthPct: 72 }

export type InitialTarget =
  | { page: number; offsetRatio: number }
  | { blockIdx: number; ratio: number }
  | { segIdx: number; ratio: number }

export interface JumpTarget {
  anchor: string
  hl?: string
  ts: number
}

interface Options {
  docHash: string | undefined
  /** 深链 ?p= 指定的位置 */
  paramP: string | null
  /** 深链 ?hl= 指定要高亮的批注 id */
  paramHl: string | undefined
}

/**
 * 阅读位置职责（从 DocReaderPage 抽出）：
 * - 排版设置按文档记忆（存在 positions.settings）
 * - 双坐标恢复：深链参数优先，其次「深度阅读进度」
 * - 进度、当前定位串、跳转信号
 *
 * 抽出后页面只负责「怎么渲染」，这里只管「读到哪儿、按什么排版」。
 */
export function useReadingPosition({ docHash, paramP, paramHl }: Options) {
  const [settings, setSettings] = useState<DocSettings>(DEFAULT_SETTINGS)
  const [progressPct, setProgressPct] = useState(0)
  /** p3 / b7 / f2 */
  const [currentLocator, setCurrentLocator] = useState('')
  const [initialTarget, setInitialTarget] = useState<InitialTarget | null>(null)
  const [jump, setJump] = useState<JumpTarget | null>(null)

  useEffect(() => {
    if (!docHash) return
    let alive = true
    void getPosition(docHash).then((pos) => {
      if (!alive) return
      if (pos?.settings) setSettings(pos.settings)
      if (paramP || paramHl) {
        setInitialTarget(null)
        if (paramP) setJump({ anchor: paramP, hl: paramHl, ts: Date.now() })
        else if (paramHl && pos) setJump({ anchor: pos.progress ? anchorOf(pos.progress) : 'p1', hl: paramHl, ts: Date.now() })
      } else if (pos?.progress) {
        const prog = pos.progress
        // 先把页头进度和目录高亮对齐到恢复位置；阅读器滚动事件到达前也不空白
        setProgressPct(pos.progressPct ?? 0)
        setCurrentLocator(anchorOf(prog))
        setInitialTarget(
          prog.kind === 'pdf' ? { page: prog.page, offsetRatio: prog.offsetRatio }
          : prog.kind === 'flow' ? { segIdx: prog.segIdx, ratio: prog.ratio }
          : { blockIdx: prog.blockIdx, ratio: prog.ratio },
        )
      } else {
        // 无历史进度：不恢复也不提示
        setInitialTarget(null)
      }
    })
    return () => {
      alive = false
    }
  }, [docHash, paramP, paramHl])

  const updateSettings = useCallback(
    (patch: Partial<DocSettings>, persist = true) => {
      if (!docHash) return
      setSettings((s) => {
        const next = { ...s, ...patch }
        // 拖动宽度时只更新预览，松手才落库；否则每个 input 事件都写一次 IndexedDB
        if (persist) void saveDocSettings(docHash, next)
        return next
      })
    },
    [docHash],
  )

  const doJump = useCallback((anchor: string, hl?: string) => {
    setJump({ anchor, hl, ts: Date.now() })
  }, [])

  return {
    settings,
    updateSettings,
    progressPct,
    setProgressPct,
    currentLocator,
    setCurrentLocator,
    initialTarget,
    jump,
    doJump,
  }
}
