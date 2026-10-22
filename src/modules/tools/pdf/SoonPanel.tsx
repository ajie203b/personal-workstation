import { FileLock2, Minimize2 } from 'lucide-react'
import { Panel } from './parts'

/** 暂缓功能：界面先占位，别让入口空着 */
export function SoonPanel() {
  return (
    <>
      <Panel title="压缩" desc="减小文件体积（压图片、抽冗余字体）。">
        <div className="flex items-center gap-3 rounded-[12px] border border-dashed border-outline px-3 py-3">
          <span className="grid place-items-center w-9 h-9 rounded-[10px] bg-surface-2 text-on-surface-2 shrink-0">
            <Minimize2 size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] leading-5">即将支持</p>
            <p className="text-[11px] text-on-surface-2 leading-relaxed">
              压缩策略还在打磨，v1 先把「合并 / 拆分 / 签名」这些做扎实。
            </p>
          </div>
        </div>
      </Panel>
      <Panel title="加密 / 解密" desc="给 PDF 加打开密码，或去掉已知密码。">
        <div className="flex items-center gap-3 rounded-[12px] border border-dashed border-outline px-3 py-3">
          <span className="grid place-items-center w-9 h-9 rounded-[10px] bg-surface-2 text-on-surface-2 shrink-0">
            <FileLock2 size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] leading-5">即将支持</p>
            <p className="text-[11px] text-on-surface-2 leading-relaxed">
              加解密涉及标准兼容与权限位，等实现后这入口会直接点亮。
            </p>
          </div>
        </div>
      </Panel>
    </>
  )
}
