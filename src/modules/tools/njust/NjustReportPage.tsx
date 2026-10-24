import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AlertTriangle, CheckCircle2, FileText, Image as ImageIcon, Loader2, Upload, X } from 'lucide-react'
import { BackButton } from '@/shared/ui/BackButton'
import { Button, useAsyncButton } from '@/shared/ui/Button'
import { useUi } from '@/stores/ui'
import { saveBlob } from '@/lib/saveFile'
import { cn } from '@/lib/cn'
import { parseMarkdownSource, parseSourceFile } from './parseSource'
import { buildReport, loadNjustLogos, resolveImages } from './buildDocx'
import type { Block, ParsedSource, ReportMeta, ReportOptions } from './types'
import 'katex/dist/katex.min.css'

/**
 * NJUST 报告排版：txt / Markdown / docx → 南理工模板 Word。
 * 全部在本地解析、排版和打包，不上传文件；生成参数来自
 * 《通识教育课大作业及模板.docx》与 .report_work 里跑通的格式。
 */

const SAMPLE = `# 自动控制技术在国防军工领域的应用及发展

# 一、引言

自动控制技术是武器装备实现精确打击、快速反应和无人化的基础。本文结合三次课程内容，从指挥控制、火力控制和火炮伺服控制三个层级，梳理自动控制技术在国防军工领域的作用与发展。

## 1.1 历史背景

从早期的机械式随动系统，到今天的数字化火控与智能决策，控制技术的每一次进步都直接改变了武器系统的作战方式。理解这段历史，有助于看清三个控制层级之间的分工。

### 1.1.1 火炮发展

火炮伺服控制从液压随动发展到全电驱动，响应速度和瞄准精度不断提高。现代自行火炮已经能够在行进间完成射击准备。

# 二、三个控制层级

## 2.1 指挥控制

指挥控制负责战场态势融合、任务分配和火力协调，是作战体系的“大脑”。

## 2.2 火力控制

火力控制根据目标信息解算射击诸元，把指挥意图转化为具体的射击方案。

## 2.3 火炮伺服控制

伺服控制驱动炮塔和身管跟踪目标，是实现“打得准、跟得上”的执行环节。

# 三、数学描述示例

以简化的双变量模型为例：

$$
\\frac{du}{dt}=0.09u\\left(1-\\frac{u}{20}\\right)-0.45uv,\\qquad
\\frac{dv}{dt}=0.06v\\left(1-\\frac{v}{15}\\right)-0.001uv
$$

# 四、三个层级的对比

| 控制层级 | 主要作用 | 关键指标 |
| --- | --- | --- |
| 指挥控制 | 态势融合、任务分配 | 决策时延 |
| 火力控制 | 目标解算、射击诸元 | 解算精度 |
| 伺服控制 | 随动跟踪、稳定瞄准 | 跟踪误差 |

# 五、结论

三个控制层级共同构成完整的作战闭环。理解它们的分工与耦合，是学习自动控制技术的关键。
`

const INPUT = 'w-full h-9 rounded-[10px] border border-outline bg-surface px-2.5 text-[13px] outline-none focus:border-primary transition-colors'

function todayText(): string {
  const d = new Date()
  return `${d.getFullYear()}年${d.getMonth() + 1}月`
}

const DEFAULT_META: ReportMeta = {
  course: '国防特色通识教育-自动控制篇',
  reportType: '大作业',
  title: '',
  name: '',
  studentId: '',
  college: '',
  major: '',
  teacher: '',
  date: todayText(),
  score: '',
}

function loadMeta(): ReportMeta {
  try {
    const raw = localStorage.getItem('njust-report-meta')
    if (raw) return { ...DEFAULT_META, ...JSON.parse(raw) }
  } catch { /* 本机存储不可用时用默认值 */ }
  return { ...DEFAULT_META }
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'NJUST报告'
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="block text-[11.5px] font-medium text-on-surface-2 mb-1">{label}</span>
      {children}
    </label>
  )
}

function Option({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--primary)] cursor-pointer"
      />
      <span className="min-w-0">
        <span className="block text-[13px]">{label}</span>
        {hint && <span className="block text-[11.5px] text-on-surface-2 mt-0.5">{hint}</span>}
      </span>
    </label>
  )
}

export function NjustReportPage() {
  const navigate = useNavigate()
  const toast = useUi((s) => s.toast)
  const { state, run } = useAsyncButton({ successHoldMs: 900 })
  const [meta, setMeta] = useState<ReportMeta>(loadMeta)
  const [options, setOptions] = useState<ReportOptions>({
    cover: true,
    reviewBox: true,
    headerFooter: true,
    autoNumberHeadings: true,
  })
  const [source, setSource] = useState<ParsedSource | null>(null)
  const [fileName, setFileName] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState('')
  const [parsing, setParsing] = useState(false)
  const [drag, setDrag] = useState(false)
  const [suppImages, setSuppImages] = useState<Map<string, string>>(new Map())
  const [suppNames, setSuppNames] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try { localStorage.setItem('njust-report-meta', JSON.stringify(meta)) } catch { /* 忽略 */ }
  }, [meta])

  const outline = useMemo(
    () => (source?.blocks ?? []).filter((b): b is Extract<Block, { type: 'heading' }> => b.type === 'heading'),
    [source],
  )

  const applySource = (parsed: ParsedSource, name: string) => {
    setSource(parsed)
    setFileName(name)
    const list = [...parsed.warnings]
    if (parsed.stats.words < 2500) {
      list.unshift(`当前内容约 ${parsed.stats.words} 字，模板要求不少于 2500 字（如适用）`)
    }
    setWarnings(list)
    setError('')
    if (parsed.title) setMeta((m) => ({ ...m, title: parsed.title! }))
  }

  const loadFile = async (file: File) => {
    setParsing(true)
    setError('')
    try {
      const parsed = await parseSourceFile(file)
      applySource(parsed, file.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSource(null)
      setWarnings([])
    } finally {
      setParsing(false)
    }
  }

  const loadSample = () => {
    const parsed = parseMarkdownSource(SAMPLE)
    applySource(parsed, '示例报告.md')
    toast('已载入示例，可直接生成或替换成自己的内容')
  }

  const addImages = async (files: File[] | FileList | null) => {
    if (!files?.length) return
    const next = new Map(suppImages)
    const names = [...suppNames]
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      try {
        const data = await readDataUrl(file)
        const key = file.name.toLowerCase()
        next.set(key, data)
        if (!names.some((n) => n.toLowerCase() === key)) names.push(file.name)
      } catch {
        toast(`图片「${file.name}」读取失败`)
      }
    }
    setSuppImages(next)
    setSuppNames(names)
  }

  const removeImage = (name: string) => {
    const next = new Map(suppImages)
    next.delete(name.toLowerCase())
    setSuppImages(next)
    setSuppNames((list) => list.filter((n) => n !== name))
  }

  const generate = () => {
    if (!source) return
    void run(async () => {
      setError('')
      try {
        const logos = await loadNjustLogos()
        const list = [...warnings]
        const blocks = await resolveImages(source.blocks, suppImages, list)
        const result = await buildReport({ meta, blocks, options, logos, warnings: list })
        setWarnings([...new Set(result.warnings)])
        const name = safeName(meta.title || source.title || fileName.replace(/\.[^.]+$/, '') || 'NJUST报告')
        const where = await saveBlob(result.blob, `${name}_排版.docx`)
        toast(where ? `已生成：${where}` : '已生成 Word 文档')
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        setError(message)
        throw e
      }
    })
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 md:px-8 pt-4 pb-24 md:pb-14 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <BackButton onClick={() => navigate('/tools')} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] md:text-[24px] font-bold leading-8 tracking-tight">NJUST 报告排版</h1>
          <p className="text-[12.5px] text-on-surface-2 mt-0.5">txt / Markdown / docx → 南理工模板 Word，本地生成不上传</p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-primary-soft text-primary text-[11px] font-medium shrink-0">
          <CheckCircle2 size={12} /> 纯本地
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)] gap-4 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          <section className="card p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-[14px] font-semibold">1. 选择原稿</h2>
              <button type="button" onClick={loadSample} className="text-[12px] text-primary hover:underline cursor-pointer">
                载入示例
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.markdown,.docx,.doc,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void loadFile(file)
              }}
            />
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click() }}
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDrag(false)
                const file = e.dataTransfer.files?.[0]
                if (file) void loadFile(file)
              }}
              className={cn(
                'rounded-[12px] border border-dashed px-4 py-5 flex items-center gap-3 cursor-pointer transition-colors',
                drag ? 'border-primary bg-primary-soft' : 'border-outline bg-surface-2/60 hover:border-primary/50',
              )}
            >
              <span className="grid place-items-center w-10 h-10 rounded-[11px] bg-surface text-primary shrink-0">
                {parsing ? <Loader2 size={19} className="animate-spin" /> : <Upload size={19} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{parsing ? '正在解析…' : source ? fileName : '点击选择或拖入文件'}</span>
                <span className="block text-[11.5px] text-on-surface-2 mt-0.5">
                  {source ? `识别到 ${source.stats.headings} 个标题、${source.stats.words} 字` : '支持 .txt / .md / .docx；旧版 .doc 请先另存为 .docx'}
                </span>
              </span>
              {source && <FileText size={18} className="text-ok shrink-0" aria-hidden />}
            </div>
            {error && (
              <p className="mt-2.5 text-[12px] leading-relaxed text-danger" role="alert">{error}</p>
            )}
            <p className="mt-2 text-[11px] text-on-surface-2/80 leading-relaxed">
              Markdown 建议结构：首个 <code className="kbd">#</code> 是报告题目；正文用 <code className="kbd">#</code> / <code className="kbd">##</code> / <code className="kbd">###</code> 表示一/二/三级标题；表格用 GFM 管道表；公式用 <code className="kbd">$...$</code> 或 <code className="kbd">$$...$$</code>。
            </p>
          </section>

          <section className="card p-4">
            <h2 className="text-[14px] font-semibold mb-3">2. 封面与题目</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
              <Field label="课程名称">
                <input className={INPUT} value={meta.course} onChange={(e) => setMeta({ ...meta, course: e.target.value })} placeholder="例如：国防特色通识教育-自动控制篇" />
              </Field>
              <Field label="报告类型">
                <input className={INPUT} value={meta.reportType} onChange={(e) => setMeta({ ...meta, reportType: e.target.value })} placeholder="大作业 / 实验报告 / 课程设计" />
              </Field>
              <Field label="报告题目" className="sm:col-span-2">
                <input className={INPUT} value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} placeholder="默认取原稿首个一级标题" />
              </Field>
              <Field label="姓名">
                <input className={INPUT} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
              </Field>
              <Field label="学号">
                <input className={INPUT} value={meta.studentId} onChange={(e) => setMeta({ ...meta, studentId: e.target.value })} />
              </Field>
              <Field label="学院">
                <input className={INPUT} value={meta.college} onChange={(e) => setMeta({ ...meta, college: e.target.value })} placeholder="例如：机械工程学院" />
              </Field>
              <Field label="专业">
                <input className={INPUT} value={meta.major} onChange={(e) => setMeta({ ...meta, major: e.target.value })} />
              </Field>
              <Field label="指导教师">
                <input className={INPUT} value={meta.teacher} onChange={(e) => setMeta({ ...meta, teacher: e.target.value })} />
              </Field>
              <Field label="日期">
                <input className={INPUT} value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} placeholder="2026年10月" />
              </Field>
              <Field label="分数（封面，可留空）">
                <input className={INPUT} value={meta.score} onChange={(e) => setMeta({ ...meta, score: e.target.value })} />
              </Field>
            </div>
          </section>

          <section className="card p-4">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h2 className="text-[14px] font-semibold">3. 补充图片（可选）</h2>
              <button type="button" onClick={() => imageRef.current?.click()} className="text-[12px] text-primary hover:underline cursor-pointer">
                选择图片
              </button>
            </div>
            <input
              ref={imageRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/bmp"
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? [])
                e.target.value = ''
                void addImages(picked)
              }}
            />
            <p className="text-[11.5px] text-on-surface-2 leading-relaxed">
              .docx 内嵌图会自动提取；Markdown 里的相对路径按文件名匹配补充图（如 <code className="kbd">fig1.png</code>）。
            </p>
            {suppNames.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {suppNames.map((name) => (
                  <span key={name} className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full bg-surface-2 text-[11.5px] text-on-surface-2">
                    <ImageIcon size={11} aria-hidden />
                    <span className="max-w-[160px] truncate">{name}</span>
                    <button type="button" aria-label={`移除 ${name}`} onClick={() => removeImage(name)} className="grid place-items-center w-4 h-4 rounded-full hover:bg-surface-3 cursor-pointer">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="card p-4">
            <h2 className="text-[14px] font-semibold mb-3">4. 排版选项</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Option checked={options.cover} onChange={(v) => setOptions({ ...options, cover: v })} label="生成封面" hint="校徽、课程名、姓名/学号等" />
              <Option checked={options.reviewBox} onChange={(v) => setOptions({ ...options, reviewBox: v })} label="保留评语栏" hint="正文首页 5cm 高的评语框" />
              <Option checked={options.headerFooter} onChange={(v) => setOptions({ ...options, headerFooter: v })} label="页眉页脚" hint="Logo + 课程报告名，第×页/共×页" />
              <Option checked={options.autoNumberHeadings} onChange={(v) => setOptions({ ...options, autoNumberHeadings: v })} label="自动编号标题" hint="一、 / 1.1 / 1.1.1" />
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-4 min-w-0 lg:sticky lg:top-2">
          <section className="card p-4">
            <h2 className="text-[14px] font-semibold mb-3">解析结果</h2>
            {!source ? (
              <div className="py-8 text-center">
                <span className="grid place-items-center w-11 h-11 rounded-[12px] bg-surface-2 mx-auto text-on-surface-2">
                  <FileText size={20} />
                </span>
                <p className="text-[13px] font-medium mt-2.5">还没有选择原稿</p>
                <p className="text-[11.5px] text-on-surface-2 mt-1">上传后这里会显示标题层级、表格、图片和公式数量。</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ['标题', source.stats.headings],
                    ['表格', source.stats.tables],
                    ['图片', source.stats.images],
                    ['公式', source.stats.formulas],
                    ['段落', source.stats.paragraphs],
                    ['字数', source.stats.words],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-[10px] bg-surface-2 px-2.5 py-2">
                      <b className="block text-[17px] leading-6 tabular-nums">{value}</b>
                      <span className="text-[10.5px] text-on-surface-2">{label}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3">
                  <p className="text-[11.5px] font-medium text-on-surface-2 mb-1.5">标题结构</p>
                  {outline.length === 0 ? (
                    <p className="text-[12px] text-on-surface-2">没有识别到标题，正文会按段落排版。</p>
                  ) : (
                    <ol className="max-h-52 overflow-y-auto rounded-[10px] bg-surface-2 px-3 py-2 text-[12px] leading-6">
                      {outline.map((h, i) => (
                        <li key={`${h.level}-${i}`} className={cn('truncate', h.level === 1 ? 'font-medium' : h.level === 2 ? 'pl-3' : 'pl-6 text-on-surface-2')}>
                          {h.text}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </>
            )}
          </section>

          {warnings.length > 0 && (
            <section className="card p-4 border-p1/30 bg-[color-mix(in_srgb,var(--p1)_5%,var(--surface))]">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} className="text-p1 shrink-0" />
                <h2 className="text-[13px] font-semibold text-p1">需要注意</h2>
              </div>
              <ul className="flex flex-col gap-1 text-[11.5px] leading-relaxed text-on-surface-2 list-disc pl-4">
                {warnings.map((w, i) => <li key={`${i}-${w}`}>{w}</li>)}
              </ul>
            </section>
          )}

          <section className="card p-4">
            <details>
              <summary className="text-[13px] font-semibold cursor-pointer select-none">模板规格（已内置）</summary>
              <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-[11.5px] leading-relaxed text-on-surface-2">
                <dt>页面</dt><dd>A4，上/下 2.5cm、左 2.0cm、右 1.9cm，装订线 0.1cm</dd>
                <dt>封面</dt><dd>校徽 + 课程名/大作业，姓名等仿宋 16pt，日期 18pt</dd>
                <dt>正文标题</dt><dd>宋体二号加粗，段前段后 16pt</dd>
                <dt>一级/二级/三级</dt><dd>宋体三号 / 宋体四号 / 黑体小四，均加粗</dd>
                <dt>正文</dt><dd>宋体 + Times New Roman，小四，固定行距 20pt，首行缩进 2 字符</dd>
                <dt>图表</dt><dd>题注宋体五号居中；三线表 1.5 / 0.75 / 1.5pt，无竖线</dd>
                <dt>页眉页脚</dt><dd>校徽 + “课程报告”，页脚第×页/共×页</dd>
              </dl>
            </details>
          </section>

          <section className="card p-4">
            <Button
              variant="primary"
              magnetic
              className="w-full h-11 justify-center text-[14px]"
              state={state}
              disabled={!source || parsing}
              onClick={generate}
            >
              生成 Word 文档
            </Button>
            <p className="text-[10.5px] text-on-surface-2 text-center mt-2">
              生成件会去掉模板里的作业要求页、红色说明字和水印
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
