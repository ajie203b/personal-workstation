import { useState } from 'react'

export function HexColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const pickerValue = /^#[\da-f]{6}$/i.test(value) ? value : '#2c55b8'
  return (
    <label className="inline-flex items-center gap-2 text-xs text-on-surface-2">
      {label}
      <span
        className="relative inline-flex size-6 shrink-0 rounded-full border border-outline overflow-hidden cursor-pointer focus-within:ring-2 focus-within:ring-primary/40"
        style={{ backgroundColor: pickerValue }}
        title={`点击选择${label}`}
      >
        <input
          type="color"
          aria-label={`选择${label}`}
          value={pickerValue}
          onChange={(event) => {
            setDraft(null)
            onChange(event.target.value.toUpperCase())
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
      <input
        type="text"
        value={draft ?? value}
        maxLength={7}
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        className="h-10 w-24 rounded-lg border border-outline bg-surface-2 px-2 font-mono text-on-surface"
        onChange={event => {
          const next = event.target.value
          setDraft(next)
          if (/^#?[\da-f]{6}$/i.test(next)) onChange(next.startsWith('#') ? next : '#' + next)
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  )
}
