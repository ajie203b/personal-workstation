/**
 * 纯 Web Audio API 离线专注白噪音合成器（Phase 4）：
 * 零音频素材体积，实时合成 4 秒无缝循环立体声粉红雨声 / 暖色棕噪，并带柔和低通滤波与淡入淡出。
 */

export type AmbientNoiseMode = 'off' | 'pink' | 'brown'

const LS_KEY = 'kairos:ambient-noise'

interface StoredNoisePrefs {
  mode: AmbientNoiseMode
  volume: number
}

export function loadAmbientNoisePrefs(): StoredNoisePrefs {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { mode: 'off', volume: 0.2 }
    const parsed = JSON.parse(raw) as Partial<StoredNoisePrefs>
    const mode: AmbientNoiseMode =
      parsed.mode === 'pink' || parsed.mode === 'brown' ? parsed.mode : 'off'
    const volume =
      typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
        ? Math.min(0.6, Math.max(0.03, parsed.volume))
        : 0.2
    return { mode, volume }
  } catch {
    return { mode: 'off', volume: 0.2 }
  }
}

export function saveAmbientNoisePrefs(prefs: StoredNoisePrefs): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(prefs))
  } catch {
    /* ignore */
  }
}

function buildNoiseBuffer(ctx: AudioContext, mode: Exclude<AmbientNoiseMode, 'off'>): AudioBuffer {
  const sampleRate = ctx.sampleRate || 44100
  const length = sampleRate * 4
  const buffer = ctx.createBuffer(2, length, sampleRate)

  for (let ch = 0; ch < 2; ch++) {
    const out = buffer.getChannelData(ch)
    if (mode === 'pink') {
      let b0 = 0; let b1 = 0; let b2 = 0; let b3 = 0; let b4 = 0; let b5 = 0; let b6 = 0
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1
        b0 = 0.99886 * b0 + white * 0.0555179
        b1 = 0.99332 * b1 + white * 0.0750759
        b2 = 0.96900 * b2 + white * 0.1538520
        b3 = 0.86650 * b3 + white * 0.3104856
        b4 = 0.55000 * b4 + white * 0.5329522
        b5 = -0.7616 * b5 - white * 0.0168980
        out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.055
        b6 = white * 0.115926
      }
    } else {
      let last = 0
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1
        last = (last + 0.02 * white) / 1.02
        out[i] = last * 0.9
      }
    }
    // 首尾 0.05s 交叉淡入淡出避免循环接缝咔哒声
    const fade = Math.min(2048, Math.floor(length / 10))
    for (let i = 0; i < fade; i++) {
      const w = i / fade
      const tail = out[length - fade + i]
      out[i] = out[i] * w + tail * (1 - w)
    }
  }
  return buffer
}

class AmbientNoisePlayer {
  private ctx: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private gain: GainNode | null = null
  private mode: AmbientNoiseMode = 'off'

  start(mode: AmbientNoiseMode, volume: number): boolean {
    if (mode === 'off') {
      this.stop()
      return false
    }
    if (typeof window === 'undefined') return false
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return false

    if (this.mode === mode && this.source && this.gain && this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined)
      this.setVolume(volume)
      return true
    }

    this.stop()
    try {
      const ctx = new AudioCtx()
      const buffer = buildNoiseBuffer(ctx, mode)
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.loop = true

      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = mode === 'pink' ? 1400 : 650

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.setTargetAtTime(Math.min(0.6, Math.max(0.03, volume)), ctx.currentTime, 0.12)

      src.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      src.start()

      this.ctx = ctx
      this.source = src
      this.gain = gain
      this.mode = mode
      return true
    } catch {
      this.stop()
      return false
    }
  }

  setVolume(volume: number): void {
    if (!this.gain || !this.ctx) return
    const clamped = Math.min(0.6, Math.max(0.03, volume))
    this.gain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.06)
  }

  stop(): void {
    try { this.source?.stop() } catch { /* ignore */ }
    try { this.source?.disconnect() } catch { /* ignore */ }
    try { this.gain?.disconnect() } catch { /* ignore */ }
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined)
    }
    this.source = null
    this.gain = null
    this.ctx = null
    this.mode = 'off'
  }
}

export const ambientNoise = new AmbientNoisePlayer()
