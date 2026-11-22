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

export async function downloadChartImage(url: string, signal: AbortSignal): Promise<Blob | null> {
  try {
    const response = await fetch(url, { cache: 'no-store', signal })
    if (!response.ok) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!pngSignature.every((byte, index) => bytes[index] === byte)) return null
    const image = new Blob([bytes], { type: 'image/png' })
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
