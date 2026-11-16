/**
 * 模型榜单的运行时数据源：每日 Action 把 JSON 与官方图表都提交到 main 并发布到 Pages。
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
