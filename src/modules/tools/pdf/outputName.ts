/** 下载、文档库和 ZIP 内名称共用：避免路径、控制字符与 Windows 保留名称。 */
export function safeOutputName(raw: string): string {
  let name = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[. ]+|[. ]+$/g, '')
  if (!name) name = '导出'
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `文档-${name}`
  const ext = /\.[a-z0-9]{1,8}$/i.exec(name)?.[0] ?? ''
  const chars = Array.from(name.slice(0, name.length - ext.length))
  return chars.slice(0, 160).join('') + ext
}
