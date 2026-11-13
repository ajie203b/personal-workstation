import { useEffect, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { useUi } from '@/stores/ui'
import { Button } from '@/shared/ui/Button'
import { JellySwitch } from '@/shared/ui/JellySwitch'
import { Dialog } from '@/shared/ui/Sheet'
import { getNotifyEnabled, requestNotifyPermission, setNotifyEnabled } from '@/lib/notify'

/** 提醒通知开关（仅安卓 App 内渲染） */
export function NotifyCard() {
  const [on, setOn] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [pending, setPending] = useState<number | null>(null)
  const [exact, setExact] = useState<boolean | null>(null)
  const [perm, setPerm] = useState<string | null>(null)
  const toast = useUi((s) => s.toast)

  const refreshStatus = async () => {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const [p, e, perms] = await Promise.all([
        LocalNotifications.getPending(),
        LocalNotifications.checkExactNotificationSetting().catch(() => ({ exact_alarm: 'denied' as const })),
        LocalNotifications.checkPermissions(),
      ])
      setPending(Array.isArray(p.notifications) ? p.notifications.length : 0)
      setExact(e.exact_alarm === 'granted')
      setPerm(perms.display)
    } catch {
      setPending(null)
      setExact(false)
      setPerm(null)
    }
  }

  useEffect(() => {
    void getNotifyEnabled().then((v) => {
      setOn(v)
      if (v) void refreshStatus()
    })
  }, [])

  /**
   * 安卓上通知权限被拒一次就很难再要回来（系统会记成「已拒绝」，再弹也没有对话框），
   * 所以先用自己的说明卡讲清「为什么需要、发什么、能不能关」，用户点了「开启」才弹系统框。
   */
  const ask = () => setAskOpen(true)

  const grant = async () => {
    setAskOpen(false)
    const granted = await requestNotifyPermission()
    if (!granted) {
      toast('未获得通知权限，请在系统设置中允许')
      return
    }
    // setNotifyEnabled 内部会把已有任务一起重排，旧任务不用等下次启动
    await setNotifyEnabled(true)
    setOn(true)
    toast('已开启到期提醒')
    void refreshStatus()
  }

  const toggle = async () => {
    if (on) {
      await setNotifyEnabled(false)
      setOn(false)
      setPending(0)
      toast('已关闭到期提醒')
      return
    }
    ask()
  }

  const sendTest = async () => {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      await LocalNotifications.schedule({
        notifications: [{
          id: 1999999999,
          title: '测试通知',
          body: '如果你看到这条通知，说明到期提醒已就绪 ✓',
          // 精确闹钟未授权时不能让测试卡在系统设置页；非精确也能很快弹
          schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true },
          isExactNotification: false,
        }],
      })
      toast('已发送，约 2 秒后弹出')
      window.setTimeout(() => void refreshStatus(), 2500)
    } catch {
      toast('发送失败：请检查通知权限')
    }
  }

  const openExactSetting = async () => {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      await LocalNotifications.changeExactNotificationSetting()
      await refreshStatus()
    } catch {
      toast('无法打开系统设置')
    }
  }

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold mb-0.5 inline-flex items-center gap-1.5">
            {on ? <Bell size={14} /> : <BellOff size={14} />} 到期提醒
          </h2>
          <p className="text-[12.5px] text-on-surface-2 leading-relaxed">
            任务设置截止日期后，到期时发系统通知（没填时间默认 09:00）；未完成的任务才会提醒。
          </p>
        </div>
        <JellySwitch checked={on} onChange={() => void toggle()} label="到期提醒" />
      </div>
      {on && (
        <div className="mt-3 flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void sendTest()}>
              <Bell size={14} /> 发送测试通知
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void refreshStatus()}>
              刷新状态
            </Button>
          </div>
          <p className="text-[11.5px] text-on-surface-2 leading-relaxed">
            {perm != null && perm !== 'granted'
              ? '系统通知权限未开启，请到系统设置里允许'
              : pending == null
                ? '正在读取提醒状态…'
                : pending > 0
                  ? `已登记 ${pending} 条本地提醒`
                  : '当前没有可排期的提醒（任务需要设置截止日期）'}
            {exact === false && ' · 系统未允许精确闹钟，提醒可能晚几分钟'}
          </p>
          {exact === false && (
            <Button size="sm" variant="outline" className="self-start" onClick={() => void openExactSetting()}>
              开启精确提醒
            </Button>
          )}
        </div>
      )}

      <Dialog
        open={askOpen}
        onOpenChange={setAskOpen}
        title="开启到期提醒需要通知权限"
        description="接下来系统会弹一个权限框，请在系统对话框里点「允许」。"
      >
        <div className="flex flex-col gap-3">
          <ul className="text-[13px] text-on-surface-2 leading-relaxed flex flex-col gap-1.5">
            <li>· 只在你设定的截止时间发一条本地通知，提醒哪件事到期了</li>
            <li>· 通知在本机生成，不经过任何服务器，也不含你的任务内容之外的信息</li>
            <li>· 随时可以在这里关掉，关掉后不再发</li>
          </ul>
          <p className="text-[12px] text-on-surface-2/80">安卓上拒绝过一次就不容易再要回来，所以先在这里说明清楚。</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setAskOpen(false)}>以后再说</Button>
            <Button variant="primary" onClick={() => void grant()}>好的，去开启</Button>
          </div>
        </div>
      </Dialog>
    </section>
  )
}
