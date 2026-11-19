/**
 * 模型榜单的运行时数据源：定时 Action 每 4 小时检查更新，有变化时同步提交到 main 与 gh-pages。
 * 国内可直连 GitHub Pages 作为主源，raw.githubusercontent.com 作为备选；应用不直连 artificialanalysis.ai。
 */
export const INTEL_JSON_URLS = [
  'https://ajie203b.github.io/personal-workstation/intelligence.json',
  'https://raw.githubusercontent.com/ajie203b/personal-workstation/main/public/intelligence.json',
] as const

export const INTEL_CHART_URLS = [
  'https://ajie203b.github.io/personal-workstation/intelligence/chart.png',
  'https://raw.githubusercontent.com/ajie203b/personal-workstation/main/public/intelligence/chart.png',
] as const

export const INTEL_CHART_META_URLS = [
  'https://ajie203b.github.io/personal-workstation/intelligence/chart-meta.json',
  'https://raw.githubusercontent.com/ajie203b/personal-workstation/main/public/intelligence/chart-meta.json',
] as const
