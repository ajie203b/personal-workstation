import { useEffect, useRef, useState } from 'react'

type Mermaid = typeof import('mermaid').default
let engine: Promise<Mermaid> | null = null
let seq = 0

/** 图表引擎按需加载：只有文档里真的出现 mermaid 代码块时才拉取这份较大的依赖。 */
function loadMermaid(): Promise<Mermaid> {
  if (!engine) {
    engine = import('mermaid').then((m) => {
      m.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', fontFamily: 'inherit' })
      return m.default
    })
  }
  return engine
}

/** 渲染 ```mermaid 图表；语法有误时退回展示原文，不影响其余正文。 */
export function MermaidBlock({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let alive = true
    const id = `mermaid-${seq++}`
    setError(false)
    void loadMermaid().then(async (mermaid) => {
      try {
        const { svg } = await mermaid.render(id, chart)
        if (alive && ref.current) ref.current.innerHTML = svg
      } catch {
        if (alive) setError(true)
        // mermaid 解析失败时会往 body 塞一个临时报错节点，清掉避免污染页面
        document.getElementById(id)?.remove()
        document.getElementById(`d${id}`)?.remove()
      }
    }).catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [chart])
  if (error) return <pre className="mermaid-fallback">{chart}</pre>
  return <div ref={ref} className="mermaid-block" role="img" aria-label="图表" />
}