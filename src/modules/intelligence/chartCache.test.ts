import 'fake-indexeddb/auto'
import { beforeEach, expect, it } from 'vitest'
import { db } from '@/db/db'
import { readChart, saveChart } from './chartCache'

beforeEach(async () => { await db.rankingCharts.clear() })

it('保存最新图片和发布日期，旧镜像不会覆盖较新的榜单', async () => {
  const first = { image: new Blob(['first']), date: '2026-11-20', requestedAt: 1 }
  const latest = { image: new Blob(['latest']), date: '2026-11-22', requestedAt: 2 }
  await saveChart(first)
  await saveChart(latest)
  await saveChart({ ...first, requestedAt: 3 })
  const cached = await readChart()
  expect(cached?.date).toBe(latest.date)
  expect(await cached?.image.text()).toBe('latest')
  expect(await db.rankingCharts.count()).toBe(1)
})

it('缺少日期时不会被较早发起、较晚完成的刷新覆盖', async () => {
  const chart = { image: new Blob(['image']), date: '', requestedAt: 2 }
  await saveChart(chart)
  expect((await saveChart({ ...chart, requestedAt: 1 })).requestedAt).toBe(2)
})
