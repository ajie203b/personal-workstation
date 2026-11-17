import { useRef } from 'react'
import { Camera, FileImage, Image as ImageIcon } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'

interface Props {
  busy: boolean
  hasImage: boolean
  onPickFile: (file: File | undefined) => Promise<void>
}

export function IdPhotoPicker({ busy, hasImage, onPickFile }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  return (
    <section className="card p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex min-w-0 flex-[1_1_18rem] items-center gap-2">
          <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-surface-2 text-on-surface-2 shrink-0">
            <Camera size={15} />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium">① 选照片 / 拍照</p>
            <p className="text-[11px] text-on-surface-2">正面免冠，光线均匀；会自动按 EXIF 方向转正，并按双眼把头扶正</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button onClick={() => fileRef.current?.click()} className="h-9 px-3" disabled={busy}>
            <FileImage size={15} /> 相册
          </Button>
          <Button onClick={() => cameraRef.current?.click()} className="h-9 px-3" disabled={busy}>
            <Camera size={15} /> 拍照
          </Button>
        </div>
        {/* 带 capture 的 input 在安卓只会开相机，所以相册和拍照分成两个入口 */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void onPickFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={(e) => {
            void onPickFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      {!hasImage && (
        <EmptyState
          icon={ImageIcon}
          title="还没有照片"
          hint="从相册选一张，或直接拍一张正面照。"
          compact
        />
      )}
    </section>
  )
}
