import { db, type RankingChart } from '@/db/db'

const key = 'latest'
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]

export function readChart() {
  return db.rankingCharts.get(key)
}

export function saveChart(chart: RankingChart) {
  return db.transaction('rw', db.rankingCharts, async () => {
    const previous = await readChart()
    if (previous) {
      const dateDifference = Date.parse(previous.date) - Date.parse(chart.date)
      // 没有可区分的发布日期时，以刷新发起时间处理多窗口写入。
      const older = Number.isFinite(dateDifference) && dateDifference !== 0
        ? dateDifference > 0
        : previous.requestedAt > chart.requestedAt
      if (older) return previous
    }
    await db.rankingCharts.put(chart, key)
    return chart
  })
}

export async function downloadChartImage(
  url: string,
  signal: AbortSignal,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Blob | null> {
  try {
    const response = await fetch(url, { cache: 'no-store', signal })
    if (!response.ok) return null
    let bytes: Uint8Array
    if (onProgress && response.body && typeof response.body.getReader === 'function') {
      const contentLen = Number(response.headers.get('content-length'))
      const total = Number.isFinite(contentLen) && contentLen > 0 ? contentLen : 0
      onProgress(0, total)
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let loaded = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value && value.byteLength > 0) {
            chunks.push(value)
            loaded += value.byteLength
            onProgress(loaded, total)
          }
        }
      } finally {
        reader.releaseLock()
      }
      onProgress(loaded, total || loaded)
      bytes = new Uint8Array(loaded)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
    } else {
      bytes = new Uint8Array(await response.arrayBuffer())
      onProgress?.(bytes.byteLength, bytes.byteLength)
    }
    if (!pngSignature.every((byte, index) => bytes[index] === byte)) return null
    const image = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' })
    const objectUrl = URL.createObjectURL(image)
    try {
      const preview = new Image()
      preview.src = objectUrl
      await preview.decode()
      return signal.aborted ? null : image
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  } catch {
    return null
  }
}
