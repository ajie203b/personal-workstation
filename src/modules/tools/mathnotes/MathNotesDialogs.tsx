import { Button } from '@/shared/ui/Button'
import { Segmented } from '@/shared/ui/Segmented'
import { Dialog } from '@/shared/ui/Sheet'
import { FunctionPlotDialog } from './FunctionPlotDialog'
import { MathEditorDialog } from './MathEditorDialog'
import { MODEL_SOURCES, type ModelSourceConfig, type ModelSourceId } from './recognizer'
import type { ModelState } from './canvasDraw'
import type { PlotCurve } from './plot'
import type { BlockResult, NoteGraph } from './types'

export function MathNotesDialogs({
  editingBlock,
  editBusy,
  onCloseEdit,
  onSubmitEdit,
  onResetEdit,
  onPlotFromEdit,
  plotOpen,
  plotInput,
  editingGraph,
  onPlotOpenChange,
  plotFunction,
  onInsertGraph,
  deleteOpen,
  onDeleteOpenChange,
  onConfirmDelete,
  settingsOpen,
  onSettingsOpenChange,
  source,
  onSourceChange,
  onApplySource,
  resultMode,
  onResultModeChange,
  model,
  percent,
  onReloadModel,
}: {
  editingBlock: BlockResult | null
  editBusy: boolean
  onCloseEdit: () => void
  onSubmitEdit: (latex: string) => void
  onResetEdit: () => void
  onPlotFromEdit: (latex: string) => void
  plotOpen: boolean
  plotInput: string
  editingGraph?: NoteGraph
  onPlotOpenChange: (open: boolean) => void
  plotFunction: (latex: string, min: number, max: number, tMin: number, tMax: number, centerX?: number, centerY?: number) => Promise<PlotCurve[]>
  onInsertGraph: (
    expression: string,
    range: number,
    tMin: number,
    tMax: number,
    centerX: number,
    centerY: number,
    hiddenCurves?: number[],
  ) => void
  deleteOpen: boolean
  onDeleteOpenChange: (open: boolean) => void
  onConfirmDelete: () => void
  settingsOpen: boolean
  onSettingsOpenChange: (open: boolean) => void
  source: ModelSourceConfig
  onSourceChange: (cfg: ModelSourceConfig) => void
  onApplySource: (cfg: ModelSourceConfig) => void
  resultMode: 'auto' | 'suggest' | 'off'
  onResultModeChange: (mode: 'auto' | 'suggest' | 'off') => void
  model: ModelState
  percent: number | null
  onReloadModel: () => void
}) {
  return (
    <>
      <MathEditorDialog
        open={Boolean(editingBlock)}
        block={editingBlock}
        busy={editBusy}
        onOpenChange={(v) => {
          if (!v) onCloseEdit()
        }}
        onSubmit={onSubmitEdit}
        onReset={onResetEdit}
        onPlot={onPlotFromEdit}
      />
      <FunctionPlotDialog
        open={plotOpen}
        initial={plotInput}
        initialRange={editingGraph?.range ?? 10}
        initialCenterX={editingGraph?.centerX ?? 0}
        initialCenterY={editingGraph?.centerY ?? 0}
        initialTMin={editingGraph?.tMin ?? 0}
        initialTMax={editingGraph?.tMax ?? Math.PI * 2}
        initialHidden={editingGraph?.hiddenCurves?.join(',') ?? ''}
        onOpenChange={onPlotOpenChange}
        plot={plotFunction}
        onInsert={onInsertGraph}
      />

      <Dialog open={deleteOpen} onOpenChange={onDeleteOpenChange} title="删除这一页？" description="本页的笔迹和识别结果都会删除，无法恢复。">
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" className="h-9 px-4" onClick={() => onDeleteOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" className="h-9 px-4" onClick={onConfirmDelete}>
            删除
          </Button>
        </div>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={onSettingsOpenChange} title="识别设置" description="识别模型 Pix2Text MFR 1.5（MIT 协议）在本机运行，笔迹不上传。">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <p className="text-[12.5px] font-medium">模型下载源</p>
            <Segmented<ModelSourceId>
              options={MODEL_SOURCES.map((s) => ({ value: s.id, label: s.label }))}
              value={source.preferred}
              onChange={(v) => onApplySource({ ...source, preferred: v })}
              size="sm"
              ariaLabel="模型下载源"
            />
            <p className="text-[11.5px] text-on-surface-2">
              {MODEL_SOURCES.find((s) => s.id === source.preferred)?.hint}；首选源失败会按 GitHub → Hugging Face → hf-mirror 自动换下一个。
            </p>
            {source.preferred === 'custom' && (
              <input
                value={source.customBase ?? ''}
                onChange={(e) => onSourceChange({ ...source, customBase: e.target.value })}
                onBlur={() => onApplySource(source)}
                placeholder="https://…/pix2text-mfr-1.5（目录下放 encoder_model.onnx、decoder_model.onnx、tokenizer.json）"
                className="h-9 rounded-[10px] border border-outline bg-surface-2 px-3 text-[12.5px] outline-none focus:border-primary/60"
              />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-[12.5px] font-medium">计算结果</p>
            <Segmented<'auto' | 'suggest' | 'off'>
              options={[
                { value: 'auto', label: '自动显示' },
                { value: 'suggest', label: '点击显示' },
                { value: 'off', label: '关闭' },
              ]}
              value={resultMode}
              onChange={onResultModeChange}
              size="sm"
              ariaLabel="计算结果显示方式"
            />
          </div>
          <div className="rounded-[12px] bg-surface-2 px-3 py-2 text-[12px] text-on-surface-2 leading-relaxed">
            {model.phase === 'ready' && <>模型已就绪 · 推理后端 {model.backend === 'webgpu' ? 'WebGPU' : 'WASM（CPU）'}</>}
            {model.phase === 'loading' && (
              <>
                正在下载 {model.file || '模型'}
                {percent != null ? ` · ${percent}%` : ''}
              </>
            )}
            {model.phase === 'error' && <span className="text-danger">{model.message}</span>}
            {model.phase === 'idle' && <>模型未加载</>}
          </div>
          <div className="flex justify-end gap-2">
            {model.phase !== 'ready' && model.phase !== 'loading' && (
              <Button variant="primary" className="h-9 px-4" onClick={onReloadModel}>
                重新加载模型
              </Button>
            )}
            <Button variant="outline" className="h-9 px-4" onClick={() => onSettingsOpenChange(false)}>
              完成
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}
