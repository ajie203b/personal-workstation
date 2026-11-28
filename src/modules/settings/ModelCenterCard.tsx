import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Cpu, ExternalLink, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import { JellySwitch } from '@/shared/ui/JellySwitch'
import { clearModelCache } from '@/lib/modelCache'
import { getForceWasmMode, setForceWasmMode } from '@/lib/onnx'
import {
  clearModelSuite,
  inspectModelSuites,
  type ModelSuiteId,
  type ModelSuiteStatus,
} from '@/lib/storageDiagnostics'
import { useUi } from '@/stores/ui'
import { cn } from '@/lib/cn'

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export function ModelCenterCard({ onChanged }: { onChanged?: () => void }) {
  const navigate = useNavigate()
  const toast = useUi((s) => s.toast)
  const [suites, setSuites] = useState<ModelSuiteStatus[] | null>(null)
  const [busySuite, setBusySuite] = useState<ModelSuiteId | null>(null)
  const [forceWasm, setForceWasm] = useState(() => getForceWasmMode())
  const clearAllBtn = useAsyncButton({ successHoldMs: 900 })

  const refresh = useCallback(async () => {
    setSuites(await inspectModelSuites())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const totalBytes = suites?.reduce((sum, s) => sum + s.bytes, 0) ?? 0

  const toggleForceWasm = async () => {
    const next = !forceWasm
    setForceWasm(next)
    await setForceWasmMode(next)
    toast(next ? '已开启强制 WASM 安全模式（OCR / 抠图 / 手写公式均绕过 WebGPU）' : '已恢复自动加速模式（支持时优先 WebGPU）')
  }

  const doClearSuite = async (suite: ModelSuiteStatus) => {
    if (busySuite) return
    setBusySuite(suite.id)
    try {
      await clearModelSuite(suite.id)
      await refresh()
      onChanged?.()
      toast(`已清理「${suite.name}」缓存，下次使用时会自动按需重下`)
    } catch {
      toast('清理模型缓存失败')
    } finally {
      setBusySuite(null)
    }
  }

  const doClearAll = async () => {
    try {
      await clearAllBtn.run(async () => {
        await clearModelCache()
        await refresh()
        onChanged?.()
        toast('已清理全部离线 AI 模型缓存，下次使用时会自动重新下载')
      })
    } catch {
      toast('清理模型缓存失败')
    }
  }

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Cpu size={15} className="text-primary shrink-0" />
          <h2 className="text-[14px] font-semibold">本地 AI 模型中心</h2>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1 text-[12px] text-on-surface-2 hover:text-primary cursor-pointer"
        >
          <RefreshCw size={12.5} /> 刷新
        </button>
      </div>
      <p className="text-[12.5px] text-on-surface-2 mb-3 leading-relaxed">
        文字识别、证件照抠图与手写公式识别全部在本地运行，模型文件缓存在本机且不随备份同步；可分项清理释放空间。
      </p>

      <div className="flex flex-col gap-2">
        {!suites ? (
          <p className="text-[12.5px] text-on-surface-2 py-2">正在检查离线模型缓存…</p>
        ) : (
          suites.map((suite) => {
            const badgeText =
              suite.state === 'ready'
                ? `已缓存 · ${formatBytes(suite.bytes)}`
                : suite.state === 'partial'
                  ? `部分缓存 (${suite.cachedCount}/${suite.totalCount}) · ${formatBytes(suite.bytes)}`
                  : `未下载（约 ${suite.approxMb} MB）`
            return (
              <div
                key={suite.id}
                className="flex items-center justify-between gap-3 rounded-[12px] border border-outline/70 bg-surface-2/60 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-medium truncate">{suite.name}</span>
                    <span
                      className={cn(
                        'text-[10.5px] px-1.5 py-0.5 rounded-full tabular-nums',
                        suite.state === 'ready'
                          ? 'bg-ok/12 text-ok'
                          : suite.state === 'partial'
                            ? 'bg-p1/12 text-p1'
                            : 'bg-surface-3 text-on-surface-2',
                      )}
                    >
                      {badgeText}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-on-surface-2 mt-0.5 leading-relaxed">{suite.desc}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    aria-label={`打开 ${suite.name}`}
                    title="前往该工具"
                    onClick={() => navigate(suite.route)}
                    className="grid place-items-center w-8 h-8 rounded-[8px] text-on-surface-2 hover:bg-surface-3 hover:text-primary cursor-pointer"
                  >
                    <ExternalLink size={14} />
                  </button>
                  {suite.cachedCount > 0 && (
                    <button
                      type="button"
                      aria-label={`清理 ${suite.name} 缓存`}
                      title="清理该模型缓存"
                      disabled={busySuite !== null}
                      onClick={() => void doClearSuite(suite)}
                      className="grid place-items-center w-8 h-8 rounded-[8px] text-on-surface-2 hover:bg-danger/10 hover:text-danger cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-outline/60 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13px] font-medium">
            <ShieldCheck size={14} className="text-primary shrink-0" />
            <span>强制 WASM 安全模式</span>
          </div>
          <p className="text-[11.5px] text-on-surface-2 mt-0.5 leading-relaxed">
            如在老旧显卡或部分安卓 WebView 上遇到 OCR / 抠图 / 手写公式闪退，可开启此项跳过 WebGPU。
          </p>
        </div>
        <JellySwitch checked={forceWasm} onChange={() => void toggleForceWasm()} label="强制 WASM 安全模式" />
      </div>

      <div className="mt-3 pt-3 border-t border-outline/60 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[12px] text-on-surface-2 tabular-nums">
          {suites == null
            ? '计算中…'
            : totalBytes > 0
              ? `全部离线模型共占用约 ${formatBytes(totalBytes)}`
              : '当前无已缓存离线模型'}
        </span>
        <Button
          variant="outline"
          size="sm"
          state={clearAllBtn.state}
          disabled={totalBytes === 0}
          onClick={() => void doClearAll()}
        >
          <Trash2 size={14} /> 清理全部模型
        </Button>
      </div>
    </section>
  )
}
