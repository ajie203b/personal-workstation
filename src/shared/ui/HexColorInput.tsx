import { useState } from 'react'

export function HexColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="inline-flex items-center gap-2 text-xs text-on-surface-2">
      {label}
      <span aria-hidden className="size-5 rounded-full border border-outline" style={{ backgroundColor: value }} />
      <input
        type="text"
        value={draft ?? value}
        maxLength={7}
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        className="h-11 w-24 rounded-lg border border-outline bg-surface-2 px-2 font-mono text-on-surface"
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
