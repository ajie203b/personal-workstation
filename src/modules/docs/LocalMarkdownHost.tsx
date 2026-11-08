import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { listen } from '@tauri-apps/api/event'
import { isTauri } from '@/lib/native'
import { localMarkdown } from '@/lib/localMarkdown'
import { useUi } from '@/stores/ui'

export function LocalMarkdownHost() {
  const navigate = useNavigate()
  useEffect(() => {
    if (!isTauri()) return
    let alive = true
    let unlisten: (() => void) | undefined
    const drain = async () => {
      try {
        const path = await localMarkdown.pending()
        if (path && alive) {
          navigate(`/local-markdown?file=${encodeURIComponent(path)}`)
        }
      } catch { if (alive) useUi.getState().toast('无法打开本地文档，请从文档工作站重新选择') }
    }
    void listen('local-markdown-open', () => void drain()).then(stop => { if (!alive) stop(); else { unlisten = stop; void drain() } })
    return () => { alive = false; unlisten?.() }
  }, [navigate])
  return null
}
