/** 只有笔迹确认写了等号、识别结果又是完整的数字算式时，才补上模型漏掉的等号。 */
export function recoverTrailingEquals(latex: string, hasInkEquals: boolean): string {
  if (!hasInkEquals || latex.includes('=')) return latex
  const normalized = latex.replace(/\s+/g, '').replace(/[×]/g, '*').replace(/[÷]/g, '/').replace(/[−﹣]/g, '-')
  if (!/^(?:\d+(?:\.\d+)?|[+\-*/()]|\\times|\\div|\\cdot)+$/.test(normalized)) return latex
  if (!/[\d)]$/.test(normalized) || !/(?:[+\-*/]|\\times|\\div|\\cdot)/.test(normalized)) return latex
  return `${latex}=`
}

/** 手动输入：已有方程不改写；纯数字四则可直接求值。 */
export function manualExpression(latex: string, hasResultMark: boolean): string {
  if (latex.includes('=') || latex.includes('＝')) return latex
  if (hasResultMark) return `${latex}=`
  return recoverTrailingEquals(latex, true)
}
