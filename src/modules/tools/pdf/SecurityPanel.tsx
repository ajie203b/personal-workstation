import { useEffect, useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { LockKeyhole, UnlockKeyhole, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Segmented } from '@/shared/ui/Segmented'
import { formatBytes } from '@/lib/format'
import { Field, FilePicker, OutputBar, Panel, pdfBlob } from './parts'
import { JobFeedback } from './JobFeedback'
import { usePdfJob } from './usePdfJob'
import { validatePdfPassword } from './qpdfTypes'

const INPUT = 'w-full min-w-0 h-10 px-3 rounded-[10px] bg-surface-2 border border-outline text-[13px] outline-none focus:border-primary'

export function SecurityPanel() {
  const [mode, setMode] = useState<'encrypt' | 'decrypt'>('encrypt')
  const [file, setFile] = useState<File | null>(null)
  const [encrypted, setEncrypted] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [allowPrint, setAllowPrint] = useState(true)
  const [allowCopy, setAllowCopy] = useState(true)
  const [allowModify, setAllowModify] = useState(true)
  const [error, setError] = useState('')
  const job = usePdfJob()
  useEffect(() => {
    if (job.result) { setPassword(''); setConfirmation(''); setCurrentPassword(''); setOwnerPassword('') }
  }, [job.result])

  useEffect(() => {
    let alive = true
    setEncrypted(null)
    if (file) void file.arrayBuffer().then(bytes => PDFDocument.load(bytes, { ignoreEncryption: true }))
      .then(doc => { if (alive) setEncrypted(doc.isEncrypted) })
      .catch(() => { if (alive) setError('无法读取 PDF，请重新选择文件') })
    return () => { alive = false }
  }, [file])

  const resetPasswords = () => { setPassword(''); setConfirmation(''); setCurrentPassword(''); setOwnerPassword(''); setError(''); job.reset() }
  const run = () => {
    if (!file) return
    setError('')
    try {
      if (mode === 'decrypt') {
        if (currentPassword.length) validatePdfPassword(currentPassword)
        void job.run(file, { kind: 'decrypt', password: currentPassword })
        return
      }
      validatePdfPassword(password)
      if (password !== confirmation) throw new Error('两次输入的打开密码不一致')
      const random = crypto.getRandomValues(new Uint8Array(32))
      const owner = ownerPassword || Array.from(random, b => b.toString(16).padStart(2, '0')).join('')
      validatePdfPassword(owner)
      if (owner === password) throw new Error('管理密码应与打开密码不同')
      void job.run(file, { kind: 'encrypt', password, ownerPassword: owner, inputPassword: encrypted ? currentPassword : undefined, allowPrint, allowCopy, allowModify })
    } catch (e) { setError(e instanceof Error ? e.message : '请检查密码') }
  }
  return <Panel title="加密 / 解密 PDF" desc="密码和文档仅在本机内存中处理，不保存密码。解密需要你已知的打开密码。">
    <Segmented ariaLabel="密码操作" value={mode} onChange={v => { resetPasswords(); setMode(v) }} options={[{ value: 'encrypt', label: '设置密码' }, { value: 'decrypt', label: '移除密码' }]} />
    {file ? <div className="flex items-center gap-2 rounded-[12px] bg-surface-2 border border-outline p-3">
      <div className="flex-1 min-w-0"><p className="text-[13px] truncate">{file.name}</p><p className="text-[11px] text-on-surface-2">{formatBytes(file.size)} · {encrypted === null ? '读取中' : encrypted ? '已加密' : '未加密'}</p></div>
      <Button size="icon" aria-label="移除 PDF" onClick={() => { resetPasswords(); setFile(null) }}><X size={16} /></Button>
    </div> : <FilePicker accept="application/pdf,.pdf" label="选择 PDF" unlockPdf={false} onPick={files => { resetPasswords(); setFile(files[0]) }} />}
    <fieldset disabled={job.busy} className="flex flex-col gap-3 min-w-0">
      {(mode === 'decrypt' || encrypted) && <label className="flex flex-col gap-1 text-[12px] text-on-surface-2">原文件打开密码
        <input type="password" autoComplete="off" aria-label="原文件打开密码" className={INPUT} value={currentPassword} onChange={e => { job.reset(); setCurrentPassword(e.target.value) }} />
      </label>}
      {mode === 'decrypt' && <p className="text-[11px] text-on-surface-2">若文件无需密码即可打开，可留空；真正设置了打开密码的文件需填写正确密码。</p>}
      {mode === 'encrypt' && <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-on-surface-2">新打开密码<input type="password" autoComplete="new-password" aria-label="新打开密码" className={INPUT} value={password} onChange={e => { job.reset(); setPassword(e.target.value) }} /></label>
          <label className="flex flex-col gap-1 text-[12px] text-on-surface-2">再次输入密码<input type="password" autoComplete="new-password" aria-label="确认打开密码" className={INPUT} value={confirmation} onChange={e => { job.reset(); setConfirmation(e.target.value) }} /></label>
        </div>
        <label className="flex flex-col gap-1 text-[12px] text-on-surface-2">管理密码（可选）<input type="password" autoComplete="new-password" aria-label="管理密码" placeholder="留空时生成随机管理密钥" className={INPUT} value={ownerPassword} onChange={e => { job.reset(); setOwnerPassword(e.target.value) }} /></label>
        <p className="text-[11px] text-on-surface-2">AES-256 加密。建议使用较长的密码；管理密码与打开密码不同，用于变更文档权限。</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px]">
          {[{ label: '允许打印', value: allowPrint, set: setAllowPrint }, { label: '允许复制', value: allowCopy, set: setAllowCopy }, { label: '允许修改', value: allowModify, set: setAllowModify }].map(p =>
            <label key={p.label} className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={p.value} onChange={e => { job.reset(); p.set(e.target.checked) }} className="accent-primary" />{p.label}</label>)}
        </div>
        <p className="text-[11px] text-on-surface-2">打印、复制权限由阅读软件执行；打开密码用于保护文件内容。</p>
      </>}
    </fieldset>
    {mode === 'decrypt' && file && encrypted === false && <p className="text-[12px] text-on-surface-2">这份 PDF 未设置密码，无需解密。</p>}
    {error && <p role="alert" className="text-danger text-[12px]">{error}</p>}
    <Button variant="primary" disabled={!file || encrypted === null || job.busy || (mode === 'decrypt' && !encrypted)} onClick={run}>{mode === 'encrypt' ? <LockKeyhole size={15} /> : <UnlockKeyhole size={15} />}{mode === 'encrypt' ? '生成加密副本' : '解密 PDF'}</Button>
    <JobFeedback {...job} onCancel={job.reset} />
    {job.result && <div className="flex flex-col gap-3 rounded-[12px] bg-primary-soft/40 border border-primary/20 p-3" role="status">
      <p className="text-[13px]">{mode === 'encrypt' ? '已生成加密副本。请妥善保管打开密码。' : '已移除密码，原文件保持不变。'}</p>
      <Field label="输出大小"><span className="text-[12px] tabular-nums">{formatBytes(job.result.outputSize)}</span></Field>
      <OutputBar allowLibrary={mode !== 'encrypt'} make={async () => ({ blob: pdfBlob(job.result!.bytes), filename: `${file?.name.replace(/\.pdf$/i, '') || '文档'}-${mode === 'encrypt' ? '加密' : '解密'}.pdf`, isPdf: true })} />
      {mode === 'encrypt' && <p className="text-[11px] text-on-surface-2">加密文件可下载保存，打开时需要输入密码。</p>}
    </div>}
  </Panel>
}
