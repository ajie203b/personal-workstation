/** 只有笔迹确认写了等号、识别结果又是完整的算式时，才补上模型漏掉的等号。 */
export function recoverTrailingEquals(latex: string, hasInkEquals: boolean): string {
  const trimmed = latex.trim()
  if (!hasInkEquals || !trimmed || /[=＝→]|->/.test(trimmed)) return latex
  const compact = trimmed.replace(/\s+/g, '')
  if (!compact) return latex
  // 未写完的运算符或定界符结尾不补等号
  if (/(?:[+\-*/^_{([\\,]|\\(?:times|div|cdot|frac|sqrt|left))$/.test(compact)) return latex
  // 纯单个数字或单个字母（不含任何运算/函数/阶乘/上下标/百分号）不补等号
  if (/^-?\d+(?:\.\d+)?$/.test(compact) || /^[a-zA-Z]$/.test(compact)) return latex
  // 含有运算符、分数、根号、上下标、阶乘、百分号、括号或内置函数的完整算式才补等号
  const hasMathOp = /(?:[+\-*/^!%()]|\\times|\\div|\\cdot|\\frac|\\sqrt|\\binom|\\pi|\\sin|\\cos|\\tan|\\cot|\\sec|\\csc|\\arcsin|\\arccos|\\arctan|\\sinh|\\cosh|\\tanh|\\ln|\\log|\\lg|\\exp|\\det|\\lim|\\sum|\\prod|\\int|\\gcd|\\operatorname)/.test(compact)
  if (!hasMathOp) return latex
  return `${trimmed}=`
}

/** 手动输入：已有方程或不等式或单位换算不改写；完整算式可直接求值。 */
export function manualExpression(latex: string, hasResultMark: boolean): string {
  if (/[=＝→]|->|\\le|\\ge|\\leq|\\geq|\\lt|\\gt|[<>≤≥]/.test(latex)) return latex
  if (hasResultMark) return `${latex}=`
  return recoverTrailingEquals(latex, true)
}
