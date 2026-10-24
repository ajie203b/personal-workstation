/**
 * 模型榜单的运行时数据源：每日 Action 把 JSON 与官方图表都提交到 main。
 * raw 是即时更新的主源，Pages 是备选；应用不直连 artificialanalysis.ai。
 */
export const INTEL_JSON_URLS = [
  'https://raw.githubusercontent.com/ajie203b/personal-workstation/main/public/intelligence.json',
  'https://ajie203b.github.io/personal-workstation/intelligence.json',
] as const

export const INTEL_CHART_URLS = [
  'https://raw.githubusercontent.com/ajie203b/personal-workstation/main/public/intelligence/chart.png',
  'https://ajie203b.github.io/personal-workstation/intelligence/chart.png',
] as const
