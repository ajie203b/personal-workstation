import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { ScanLine } from 'lucide-react'
import { IconToolQr } from '@/shared/icons'
import { BackButton } from '@/shared/ui/BackButton'
import { Segmented, type SegmentOption } from '@/shared/ui/Segmented'
import { db, type QrHistoryRow } from '@/db/db'
import { QrGenerateTab } from './QrGenerateTab'
import { QrScanTab } from './QrScanTab'
import { QrHistoryList } from './QrHistoryList'

const TAB_OPTIONS: SegmentOption<'generate' | 'scan'>[] = [
  { value: 'generate', label: '生成', icon: IconToolQr },
  { value: 'scan', label: '扫码', icon: ScanLine },
]

/**
 * 二维码生成与扫码（v3.3）
 *
 * 生成：六种内容模板（文本/网址/WiFi/名片/邮件/短信）+ 样式（点型、码眼、渐变、Logo），
 * 默认码色跟随当前强调色，每次生成后用 jsQR 对渲染结果做容错自检；
 * 导出 PNG 512/1024/2048 与 SVG，复制图片不支持时回退成存文件。
 * 扫码：拍照/相册选图、页面粘贴图片、可选实时相机（拿不到权限就退回图片输入），
 * 识别优先系统 BarcodeDetector，没有再用 jsQR，全程本地完成。
 */
export function QrPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'generate' | 'scan'>('generate')
  const seqRef = useRef(0)
  const [genPrefill, setGenPrefill] = useState<{ value: string; seq: number } | null>(null)
  const [scanPrefill, setScanPrefill] = useState<{ value: string; seq: number } | null>(null)

  const history = useLiveQuery(() => db.qrHistory.orderBy('createdAt').reverse().limit(12).toArray(), []) ?? []

  const fillFromHistory = (row: QrHistoryRow) => {
    const seq = ++seqRef.current
    if (row.action === 'scan') {
      setTab('scan')
      setScanPrefill({ value: row.content, seq })
      return
    }
    // 生成记录回填进文本框——内容串不变，重新生成的就是同一张码
    setTab('generate')
    setGenPrefill({ value: row.content, seq })
  }

  const removeHistory = (id: string) => {
    void db.qrHistory.delete(id).catch(() => {})
  }

  const switchToScan = useCallback(() => setTab('scan'), [])

  return (
    <div className="mx-auto w-full max-w-4xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4 enter">
      <BackButton text="工具" label="返回工具" onClick={() => navigate('/tools')} className="-mt-1 w-fit" />

      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-[12px] bg-primary-soft text-primary shrink-0">
          <IconToolQr size={22} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[20px] md:text-[22px] font-bold leading-7">二维码</h1>
          <p className="text-[12.5px] text-on-surface-2 mt-0.5 leading-relaxed">
            生成二维码、扫码识别：文本 / 网址 / WiFi / 名片，导出 PNG / SVG
          </p>
        </div>
      </header>

      <Segmented
        options={TAB_OPTIONS}
        value={tab}
        onChange={setTab}
        size="sm"
        ariaLabel="生成或扫码"
        className="w-fit"
      />

      <QrGenerateTab visible={tab === 'generate'} prefill={genPrefill} />
      <QrScanTab visible={tab === 'scan'} prefill={scanPrefill} onSwitchToScan={switchToScan} />

      {/* 历史：生成与扫码都记，点条目回填 */}
      <QrHistoryList history={history} onSelect={fillFromHistory} onRemove={removeHistory} />

      <p className="text-[11px] text-on-surface-2 leading-relaxed px-1">
        生成与识别都在本地完成，内容不上传。
      </p>
    </div>
  )
}
