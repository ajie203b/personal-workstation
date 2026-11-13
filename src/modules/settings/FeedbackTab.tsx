import { useState } from 'react'
import { ExternalLink, Lightbulb } from 'lucide-react'
import { useUi } from '@/stores/ui'
import { Button } from '@/shared/ui/Button'
import { getCurrentVersion } from '@/lib/updater'
import { openExternal } from '@/lib/links'
import { isNative, isTauri } from '@/lib/native'
import { cn } from '@/lib/cn'

/**
 * 功能建议：不自动提交，只把标题和正文预填进 GitHub 新建 Issue 页面。
 * 需要用户先有 GitHub 账号并在网页上点提交，避免应用持有任何 token。
 */
export function FeedbackTab() {
  const toast = useUi((s) => s.toast)
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')

  const trimmedDetails = details.trim()
  const derivedTitle = (title.trim() || trimmedDetails.split('\n')[0]?.trim() || '').slice(0, 80)
  const canSend = derivedTitle.length > 0

  const send = () => {
    if (!canSend) {
      toast('先写一句想要的功能')
      return
    }
    const platform = isNative() ? 'Android App' : isTauri() ? 'Windows 桌面版' : '网页版'
    const body = [
      trimmedDetails || '（请补充使用场景 / 期望效果）',
      '',
      '---',
      `提交环境：Kairos v${getCurrentVersion()} · ${platform}`,
    ].join('\n')
    const url = 'https://github.com/ajie203b/personal-workstation/issues/new'
      + `?title=${encodeURIComponent(`功能建议：${derivedTitle}`)}`
      + `&body=${encodeURIComponent(body)}`
    openExternal(url)
    toast('已打开 GitHub，确认内容后提交即可')
  }

  const inputCls = 'w-full rounded-[10px] bg-surface-2 border border-outline px-3 py-2 text-[13.5px] leading-relaxed outline-none focus:border-primary/60 transition-colors'

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <section className="card p-4 flex flex-col gap-3">
        <div>
          <h2 className="text-[14px] font-semibold mb-0.5 inline-flex items-center gap-1.5">
            <Lightbulb size={15} className="text-on-surface-2" /> 你希望添加的功能
          </h2>
          <p className="text-[12.5px] text-on-surface-2 leading-relaxed">
            写下想要的功能、使用场景或需求。点击后在 GitHub 打开新建 Issue 页面，
            标题和正文已经填好；确认无误再点「Submit new issue」提交。
          </p>
        </div>
        <label className="block">
          <span className="block text-[12px] font-medium text-on-surface-2 mb-1">一句话概括（可选）</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            placeholder="例如：任务支持按项目分组"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-on-surface-2 mb-1">详细说明</span>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={1200}
            rows={6}
            placeholder={'想解决什么问题？\n希望它怎么工作？\n有什么替代方案？'}
            className={cn(inputCls, 'resize-y min-h-[132px]')}
          />
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-on-surface-2 tabular-nums">{details.length}/1200</span>
          <Button variant="primary" size="sm" className="ml-auto" disabled={!canSend} onClick={send}>
            <ExternalLink size={15} /> 去 GitHub 提交
          </Button>
        </div>
        <p className="text-[11px] text-on-surface-2/80 leading-relaxed">
          不会自动提交，也不会上传你的任务或文档内容；正文里只附带应用版本和平台信息。
        </p>
      </section>

      <section className="card p-4">
        <h2 className="text-[14px] font-semibold mb-1">先看看大家的建议</h2>
        <p className="text-[12.5px] text-on-surface-2 leading-relaxed mb-3">
          已有需求和问题都在 GitHub Issues 里，提交前可以先搜一下，避免重复。
        </p>
        <Button variant="outline" size="sm" onClick={() => openExternal('https://github.com/ajie203b/personal-workstation/issues')}>
          <ExternalLink size={15} /> 浏览 GitHub Issues
        </Button>
      </section>
    </div>
  )
}
