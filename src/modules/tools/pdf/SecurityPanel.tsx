import { useEffect, useState } from 'react'
import { Eye, EyeOff, LockKeyhole, UnlockKeyhole, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Segmented } from '@/shared/ui/Segmented'
import { formatBytes } from '@/lib/format'
import { usePdfHandoff } from './handoff'
import { inspectPdfEncryption } from './pdfInspect'
import { FIELD_INPUT, Field, FilePicker, OutputBar, Panel, pdfBlob } from './parts'
import { JobFeedback } from './JobFeedback'
import { usePdfJob } from './usePdfJob'
import { validatePdfPassword } from './qpdfTypes'

const INPUT = 'w-full min-w-0 h-10 pl-3 pr-10 rounded-[10px] bg-surface-2 border border-outline text-[13px] outline-none focus:border-primary'

function PasswordField({
  label,
  ariaLabel,
  autoComplete,
  placeholder,
  value,
  onChange,
}: {
  label: string
  ariaLabel: string
  autoComplete: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
}) {
  const [visible, setVisible] = useState(false)
  return (
    <label className="flex flex-col gap-1 text-[12px] text-on-surface-2">
      {label}
      <div className="relative flex items-center">
        <input
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          aria-label={ariaLabel}
          placeholder={placeholder}
          className={INPUT}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        <button
          type="button"
          aria-label={visible ? `隐藏${label}` : `显示${label}`}
          onClick={() => setVisible(v => !v)}
          className="absolute right-1 grid place-items-center w-8 h-8 rounded-[8px] text-on-surface-2 hover:text-on-surface cursor-pointer"
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </label>
  )
}

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
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [usedOpenPassword, setUsedOpenPassword] = useState(true)
  const [error, setError] = useState('')
  const job = usePdfJob()

  const defaultName = `${file?.name.replace(/\.pdf$/i, '') || '文档'}-${mode === 'encrypt' ? '加密' : '解密'}`

  useEffect(() => {
    if (!nameEdited) setName(file ? defaultName : '')
  }, [file, mode, nameEdited, defaultName])

  useEffect(() => {
    if (job.result) { setPassword(''); setConfirmation(''); setCurrentPassword(''); setOwnerPassword('') }
  }, [job.result])

  useEffect(() => {
    let alive = true
    setEncrypted(null)
    if (file) {
      void file.arrayBuffer()
        .then(bytes => inspectPdfEncryption(new Uint8Array(bytes)))
        .then(res => { if (alive) setEncrypted(res.encrypted) })
        .catch(() => { if (alive) setError('无法读取 PDF，请重新选择文件') })
    }
    return () => { alive = false }
  }, [file])

  const resetPasswords = () => { setPassword(''); setConfirmation(''); setCurrentPassword(''); setOwnerPassword(''); setError(''); job.reset() }

  usePdfHandoff('security', (incoming) => {
    resetPasswords()
    setNameEdited(false)
    setFile(incoming)
  })

  const run = () => {
    if (!file) return
    setError('')
    try {
      if (mode === 'decrypt') {
        if (currentPassword.length) validatePdfPassword(currentPassword)
        void job.run(file, { kind: 'decrypt', password: currentPassword })
        return
      }
      if (password !== confirmation) throw new Error('两次输入的打开密码不一致')
      const permissionRestricted = !allowPrint || !allowCopy || !allowModify
      if (!password.length && !ownerPassword.length && !permissionRestricted) {
        throw new Error('请设置打开密码，或设置管理密码 / 取消至少一项权限')
      }
      if (password.length) validatePdfPassword(password)
      const random = crypto.getRandomValues(new Uint8Array(32))
      const owner = ownerPassword || Array.from(random, b => b.toString(16).padStart(2, '0')).join('')
      validatePdfPassword(owner)
      if (password.length && owner === password) throw new Error('管理密码应与打开密码不同')
      setUsedOpenPassword(Boolean(password.length))
      void job.run(file, { kind: 'encrypt', password, ownerPassword: owner, inputPassword: encrypted ? currentPassword : undefined, allowPrint, allowCopy, allowModify })
    } catch (e) { setError(e instanceof Error ? e.message : '请检查密码') }
  }
  return <Panel title="加密 / 解密 PDF" desc="密码和文档仅在本机内存中处理，不保存密码。解密需要你已知的打开密码。">
    <Segmented asRadio ariaLabel="密码操作" value={mode} onChange={v => { resetPasswords(); setMode(v) }} options={[{ value: 'encrypt', label: '设置密码' }, { value: 'decrypt', label: '移除密码' }]} />
    {file ? <div className="flex items-center gap-2 rounded-[12px] bg-surface-2 border border-outline p-3">
      <div className="flex-1 min-w-0"><p className="text-[13px] truncate">{file.name}</p><p className="text-[11px] text-on-surface-2">{formatBytes(file.size)} · {encrypted === null ? '读取中' : encrypted ? '已加密' : '未加密'}</p></div>
      <Button size="icon" aria-label="移除 PDF" onClick={() => { resetPasswords(); setNameEdited(false); setFile(null) }}><X size={16} /></Button>
    </div> : <FilePicker accept="application/pdf,.pdf" label="选择 PDF" unlockPdf={false} onPick={files => { resetPasswords(); setNameEdited(false); setFile(files[0]) }} />}
    <fieldset disabled={job.busy} className="flex flex-col gap-3 min-w-0">
      {(mode === 'decrypt' || encrypted) && (
        <PasswordField
          label="原文件打开密码"
          ariaLabel="原文件打开密码"
          autoComplete="off"
          value={currentPassword}
          onChange={v => { job.reset(); setCurrentPassword(v) }}
        />
      )}
      {mode === 'decrypt' && <p className="text-[11px] text-on-surface-2">若文件仅限制打印/复制而无需打开密码，可留空直接解密；设置了打开密码的文件需填写正确密码。</p>}
      {mode === 'encrypt' && <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PasswordField
            label="新打开密码（留空则仅锁权限）"
            ariaLabel="新打开密码"
            autoComplete="new-password"
            placeholder="可选，留空仅做权限保护"
            value={password}
            onChange={v => { job.reset(); setPassword(v) }}
          />
          <PasswordField
            label="再次输入密码"
            ariaLabel="确认打开密码"
            autoComplete="new-password"
            placeholder="与打开密码保持一致"
            value={confirmation}
            onChange={v => { job.reset(); setConfirmation(v) }}
          />
        </div>
        <PasswordField
          label="管理密码（可选）"
          ariaLabel="管理密码"
          autoComplete="new-password"
          placeholder="留空时生成随机管理密钥"
          value={ownerPassword}
          onChange={v => { job.reset(); setOwnerPassword(v) }}
        />
        <p className="text-[11px] text-on-surface-2">AES-256 加密。可仅取消打印/复制/修改权限或只设管理密码（留空打开密码时阅读无需输入密码）。</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px]">
          {[{ label: '允许打印', value: allowPrint, set: setAllowPrint }, { label: '允许复制', value: allowCopy, set: setAllowCopy }, { label: '允许修改', value: allowModify, set: setAllowModify }].map(p =>
            <label key={p.label} className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={p.value} onChange={e => { job.reset(); p.set(e.target.checked) }} className="app-checkbox" />{p.label}</label>)}
        </div>
        <p className="text-[11px] text-on-surface-2">打印、复制权限由阅读软件执行；打开密码用于保护文件内容。</p>
      </>}
    </fieldset>
    <Field label="文件名">
      <input
        value={name}
        onChange={e => { setNameEdited(true); setName(e.target.value) }}
        placeholder={defaultName}
        className={FIELD_INPUT}
      />
    </Field>
    {mode === 'decrypt' && file && encrypted === false && <p className="text-[12px] text-on-surface-2">这份 PDF 未设置密码，无需解密。</p>}
    {error && <p role="alert" className="text-danger text-[12px]">{error}</p>}
    <Button variant="primary" disabled={!file || encrypted === null || job.busy || (mode === 'decrypt' && !encrypted)} onClick={run}>{mode === 'encrypt' ? <LockKeyhole size={15} /> : <UnlockKeyhole size={15} />}{mode === 'encrypt' ? '生成加密副本' : '解密 PDF'}</Button>
    <JobFeedback {...job} onCancel={job.reset} />
    {job.result && <div className="flex flex-col gap-3 rounded-[12px] bg-primary-soft/40 border border-primary/20 p-3" role="status">
      <p className="text-[13px]">
        {mode === 'encrypt'
          ? (usedOpenPassword ? '已生成加密副本。请妥善保管打开密码。' : '已生成权限保护副本，阅读无需打开密码。')
          : '已移除密码，原文件保持不变。'}
      </p>
      <Field label="输出大小"><span className="text-[12px] tabular-nums">{formatBytes(job.result.outputSize)}</span></Field>
      <OutputBar
        allowLibrary={mode !== 'encrypt'}
        allowHandoff={mode !== 'encrypt'}
        make={async () => ({
          blob: pdfBlob(job.result!.bytes),
          filename: `${name.trim() || defaultName}.pdf`,
          isPdf: true,
        })}
      />
      {mode === 'encrypt' && <p className="text-[11px] text-on-surface-2">
        {usedOpenPassword ? '加密文件可下载保存，打开时需要输入密码。' : '加密文件可下载保存，受限权限由阅读器执行。'}
      </p>}
    </div>}
  </Panel>
}
