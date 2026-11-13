import { useEffect, useState } from 'react'
import { LayoutGrid, Smartphone } from 'lucide-react'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import { canInstall, onInstallAvailabilityChange, promptInstall } from '@/lib/pwa'
import { checkForUpdate, getCurrentVersion, openDownload, type UpdateInfo } from '@/lib/updater'
import { isNative } from '@/lib/native'
import { supportsInAppUpdate } from '@/lib/appUpdateClient'
import { AppUpdateCard } from '@/shared/AppUpdate'

export function AboutTab() {
  const [installable, setInstallable] = useState(canInstall())
  useEffect(() => onInstallAvailabilityChange(() => setInstallable(canInstall())), [])
  const { state: checkState, run: runCheck } = useAsyncButton({ successHoldMs: 900 })
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)

  const doCheck = async () => {
    setUpdateInfo(null)
    try {
      await runCheck(async () => {
        const info = await checkForUpdate()
        setUpdateInfo(info)
        // 没真查到就别演成功，按钮落 error 态
        if (!info.checked) throw new Error('版本信息不可用')
      })
    } catch {
      /* 失败态已由按钮呈现 */
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      {/* 更新检查：安卓 App / 桌面版是应用内下载安装；网页版保持原来的版本检查（PWA 自己会更新） */}
      {supportsInAppUpdate() ? <AppUpdateCard /> : (
      <section className="card p-4">
        <h2 className="text-[14px] font-semibold mb-1.5">软件更新</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[13px] text-on-surface-2">当前版本 {getCurrentVersion()}</span>
          <Button size="sm" variant="outline" state={checkState} onClick={() => void doCheck()}>
            检查更新
          </Button>
        </div>
        {updateInfo && (
          updateInfo.hasUpdate ? (
            <div className="mt-3 p-3 rounded-[10px] bg-primary-soft flex items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-medium text-primary">发现新版本 v{updateInfo.latestVersion}</p>
                <p className="text-[11px] text-on-surface-2 mt-0.5">当前 v{updateInfo.currentVersion}</p>
              </div>
              <Button size="sm" variant="primary" onClick={() => openDownload(updateInfo.apkUrl)}>
                下载 APK
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-on-surface-2">
              {updateInfo.checked ? `已是最新版（v${updateInfo.currentVersion}）` : '暂时没查到版本信息（网络或 GitHub 接口限流），稍后再试'}
            </p>
          )
        )}
      </section>
      )}

      {isNative() ? (
        <>
          <section className="card p-4">
            <h2 className="text-[14px] font-semibold mb-1.5 inline-flex items-center gap-1.5">
              <LayoutGrid size={15} className="text-on-surface-2" /> 桌面 / 负一屏小组件
            </h2>
            <p className="text-[13px] text-on-surface-2 leading-relaxed">
              「今日待办」小组件只留今天的任务和大加号，打卡任务仍会显示 2/3 进度。右上「+」直接弹出添加框，勾选圈直接完成并撒花，都不用打开 App；点标题才定位到那条任务，数据会在下次打开 App 或回到前台时自动同步。
            </p>
            <ol className="mt-2.5 flex flex-col gap-1.5 text-[12.5px] text-on-surface-2 leading-relaxed list-decimal pl-4">
              <li>桌面：长按空白处 →「添加工具 / 小组件」→ 找到「Kairos · 今日待办」拖出来。</li>
              <li>小米负一屏：右滑到最左 → 点右上「+」→ 小部件 → 滑到列表最底部，进「安卓小组件 / 安卓小部件」分类 → 找「今日待办」。</li>
              <li>格子可以拉宽：2×2 显示 3 条，4×2 显示 4 条，会自动切换排版。</li>
            </ol>
            <p className="text-[11px] text-on-surface-2/80 mt-2">
              小米主池里的「努力适配中，请您耐心等待」是 MIUI 对未收录第三方卡片的占位提示，不是应用故障；请从最底部的「安卓小组件」分类添加，功能完整可用。找不到入口时，先把「系统桌面 / 智能助理」更新到最新版。
            </p>
          </section>

          <section className="card p-4">
            <h2 className="text-[14px] font-semibold mb-1.5">安装状态</h2>
            <p className="text-[13px] text-on-surface-2 leading-relaxed">
              已作为安卓应用安装运行 · 数据保存在应用沙箱内，卸载应用会同时删除数据，重要节点请先到「数据」页导出备份。
            </p>
          </section>
        </>
      ) : (
        <section className="card p-4">
          <h2 className="text-[14px] font-semibold mb-1.5">安装到设备</h2>
          <p className="text-[13px] text-on-surface-2 mb-3 leading-relaxed">
            {installable
              ? '检测到安装能力，点击下方按钮即可安装为独立应用（安卓桌面图标 / 桌面端窗口）。'
              : '若按钮不可用：安卓 Chrome 打开本站 → 菜单「添加到主屏幕/安装应用」；电脑浏览器地址栏右侧可点「安装」。'}
          </p>
          <Button variant="primary" size="sm" disabled={!installable} onClick={() => void promptInstall()}>
            <Smartphone size={15} /> 安装应用
          </Button>
        </section>
      )}
    </div>
  )
}
