import { useCallback, useEffect, useRef, useState } from 'react'
import { clusterStrokes, detectTrailingEquals, estimateCharHeight } from './geometry'
import { findGraphSource } from './graphLink'
import { MathEngine } from './mathEngine'
import { RecognitionQueue } from './recognitionQueue'
import { DEFAULT_SOURCE, type ModelSourceConfig } from './recognizer'
import { getSource, setSource } from './store'
import type { EditKind } from './noteSession'
import { IDLE_MS, type ModelState, type RecognizeJob } from './canvasDraw'
import type { BlockResult, MathNotePage, NoteGraph, Stroke } from './types'

export function useMathRecognition({
  pageId,
  version,
  pageRef,
  strokesRef,
  graphsRef,
  resultsRef,
  idleTimer,
  bump,
  markEdited,
  setRevealed,
}: {
  pageId: string
  version: number
  pageRef: React.MutableRefObject<MathNotePage | null>
  strokesRef: React.MutableRefObject<Stroke[]>
  graphsRef: React.MutableRefObject<NoteGraph[]>
  resultsRef: React.MutableRefObject<Map<string, BlockResult>>
  idleTimer: React.MutableRefObject<number | undefined>
  bump: () => void
  markEdited: (kind: EditKind) => void
  setRevealed: React.Dispatch<React.SetStateAction<Set<string>>>
}) {
  const engineRef = useRef<MathEngine | null>(null)
  const queueRef = useRef<RecognitionQueue<RecognizeJob> | null>(null)
  const [model, setModel] = useState<ModelState>({ phase: 'idle' })
  const [source, setSourceState] = useState<ModelSourceConfig>(DEFAULT_SOURCE)
  const [recognizing, setRecognizing] = useState(0)
  const [pageVariables, setPageVariables] = useState<Record<string, number>>({})
  const lastEvaluation = useRef('')

  const plotFunction = useCallback(
    async (latex: string, min: number, max: number, tMin: number, tMax: number, centerX = 0, centerY = 0) => {
      const engine = engineRef.current
      if (!engine) throw new Error('计算器尚未准备好')
      return engine.plot(latex, min, max, 241, tMin, tMax, pageVariables, centerX, centerY)
    },
    [pageVariables],
  )

  const onModelProgress = useCallback((ratio: number, file: string) => {
    setModel({ phase: 'loading', ratio, file })
  }, [])

  /** fresh：用户点了「重试」或在识别设置里点「重新加载模型」——释放会话并清掉未通过校验的缓存文件，只补下缺的 / 坏的 */
  const loadModel = useCallback(
    async (opts: { fresh?: boolean } = {}) => {
      const engine = engineRef.current
      if (!engine) return
      setModel({ phase: 'loading', ratio: 0, file: '' })
      try {
        const backend = await engine.load(onModelProgress, opts)
        setModel({ phase: 'ready', backend })
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setModel({ phase: 'error', message: e instanceof Error ? e.message : '模型加载失败' })
      }
    },
    [onModelProgress],
  )

  useEffect(() => {
    const engine = new MathEngine()
    engineRef.current = engine
    let alive = true
    void getSource().then((cfg) => {
      if (!alive) return
      setSourceState(cfg)
      engine.setSource(cfg)
      void loadModel()
    })
    return () => {
      alive = false
      engine.dispose()
      engineRef.current = null
    }
  }, [loadModel])

  // 变量按页面阅读顺序重新计算；只接受与当前笔迹快照一致的后台结果。
  useEffect(() => {
    const page = pageRef.current
    const engine = engineRef.current
    if (!page || !engine) return
    const entries = clusterStrokes(strokesRef.current).flatMap((block) => {
      const row = resultsRef.current.get(block.key)
      if (!row || (row.edited == null && row.result.message?.includes('方程组未识别完整'))) return []
      return [{ key: block.key, latex: row.edited ?? row.recognized }]
    })
    const signature = JSON.stringify([page.id, entries])
    if (signature === lastEvaluation.current) return
    let active = true
    const timer = window.setTimeout(() => {
      void engine
        .evaluatePage(entries)
        .then((output) => {
          if (!active || pageRef.current?.id !== page.id) return
          lastEvaluation.current = signature
          setPageVariables((previous) => (JSON.stringify(previous) === JSON.stringify(output.variables) ? previous : output.variables))
          let changed = false
          for (const entry of entries) {
            const old = resultsRef.current.get(entry.key)
            const next = output.results[entry.key]
            if (old && next && JSON.stringify(old.result) !== JSON.stringify(next)) {
              resultsRef.current.set(entry.key, { ...old, result: next })
              changed = true
            }
          }
          if (changed) {
            bump()
            markEdited('derived')
          }
        })
        .catch(() => {
          /* 识别结果仍可使用，下次编辑时重试 */
        })
    }, 150)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [version, pageId, pageRef, strokesRef, resultsRef, bump, markEdited])

  const getQueue = useCallback((): RecognitionQueue<RecognizeJob> => {
    if (queueRef.current) return queueRef.current
    const q = new RecognitionQueue<RecognizeJob>(
      async (job) => {
        const engine = engineRef.current
        if (!engine) throw new DOMException('已取消', 'AbortError')
        const r = await engine.recognize(job.key, job.strokes, job.charHeight, onModelProgress)
        // 模型若是在这次识别里顺带加载完的，状态条也要收起来
        setModel((m) => (m.phase === 'ready' ? m : { phase: 'ready', backend: engine.backend ?? 'wasm' }))
        if (pageRef.current?.id !== job.pageId) return
        // 识别期间笔画变了（key 不在了）就丢弃，最新版本已在队列里
        const still = clusterStrokes(strokesRef.current).some((b) => b.key === job.key)
        if (!still) return
        resultsRef.current.set(job.key, { key: job.key, recognized: r.latex, result: r.result })
        setRevealed((previous) => {
          if (!previous.has(job.key)) return previous
          const next = new Set(previous)
          next.delete(job.key)
          return next
        })
        // 原公式局部重写后，保留未改变笔画的关联，并更新图像保存的表达式。
        const blocks = clusterStrokes(strokesRef.current)
        graphsRef.current = graphsRef.current.map((graph) => {
          if (!graph.sourceKey) return graph
          const nextKey = findGraphSource(graph.sourceKey, blocks)
          if (nextKey !== job.key || nextKey === graph.sourceKey) return graph
          return { ...graph, sourceKey: nextKey, expression: r.latex }
        })
        bump()
        markEdited('derived')
      },
      {
        onChange: () => {
          setRecognizing(queueRef.current?.busy ?? 0)
          bump()
        },
        onError: (_job, e) => {
          // 模型下载阶段的失败仍走底部的「换下载源 / 重试」条；块上同时有 ⚠ 标记可单独重试
          const message = e instanceof Error ? e.message : '识别失败'
          setModel((m) => (m.phase === 'loading' ? { phase: 'error', message } : m))
        },
      },
    )
    queueRef.current = q
    return q
  }, [bump, onModelProgress, markEdited, pageRef, strokesRef, resultsRef, graphsRef, setRevealed])

  useEffect(
    () => () => {
      queueRef.current?.dispose()
      queueRef.current = null
    },
    [],
  )

  /** 把当前笔迹下所有未识别的块（最新版本）交给队列；过时的排队请求被替换掉 */
  const runRecognition = useCallback(() => {
    const page = pageRef.current
    if (!engineRef.current || !page) return
    const strokes = strokesRef.current
    const h = estimateCharHeight(strokes)
    const blocks = clusterStrokes(strokes, { charHeight: h })
    const jobs: RecognizeJob[] = []
    for (const block of blocks) {
      if (resultsRef.current.has(block.key)) continue
      jobs.push({ key: block.key, pageId: page.id, strokes: strokes.filter((s) => block.strokeIds.includes(s.id)), charHeight: h })
    }
    getQueue().submit(jobs)
  }, [getQueue, pageRef, strokesRef, resultsRef])

  const retryBlock = useCallback(
    (key: string) => {
      getQueue().retry(key)
      runRecognition()
    },
    [getQueue, runRecognition],
  )

  const scheduleRecognition = useCallback(
    (immediate: boolean) => {
      window.clearTimeout(idleTimer.current)
      idleTimer.current = window.setTimeout(runRecognition, immediate ? 60 : IDLE_MS)
    },
    [runRecognition, idleTimer],
  )

  useEffect(() => () => window.clearTimeout(idleTimer.current), [idleTimer])

  // 打开页面后补识别（例如上次识别到一半就退出了）
  useEffect(() => {
    if (pageId) scheduleRecognition(false)
  }, [pageId, scheduleRecognition])

  const afterChange = useCallback(
    (lastStroke?: Stroke) => {
      bump()
      markEdited('user')
      if (!lastStroke) {
        scheduleRecognition(false)
        return
      }
      const strokes = strokesRef.current
      const h = estimateCharHeight(strokes)
      const block = clusterStrokes(strokes, { charHeight: h }).find((b) => b.strokeIds.includes(lastStroke.id))
      const eq = block ? detectTrailingEquals(strokes.filter((s) => block.strokeIds.includes(s.id)), h) : null
      scheduleRecognition(Boolean(eq))
    },
    [bump, scheduleRecognition, markEdited, strokesRef],
  )

  const applySource = useCallback(async (cfg: ModelSourceConfig) => {
    setSourceState(cfg)
    engineRef.current?.setSource(cfg)
    await setSource(cfg)
  }, [])

  const resetEvaluation = useCallback(() => {
    lastEvaluation.current = ''
    setPageVariables({})
    queueRef.current?.submit([])
  }, [])

  return {
    engineRef,
    queueRef,
    model,
    source,
    setSourceState,
    recognizing,
    plotFunction,
    loadModel,
    getQueue,
    retryBlock,
    afterChange,
    applySource,
    resetEvaluation,
  }
}
