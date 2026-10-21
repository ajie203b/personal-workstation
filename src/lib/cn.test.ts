import { describe, expect, it } from 'vitest'
import { cn } from './cn'

describe('semantic typography classes', () => {
  it('preserves button label color when applying a typography token', () => {
    expect(cn('bg-primary text-on-primary', 'text-ui-caption')).toBe('bg-primary text-on-primary text-ui-caption')
  })

  it('preserves the typography token when changing text color', () => {
    expect(cn('text-ui-body', 'text-on-surface-2')).toBe('text-ui-body text-on-surface-2')
  })

  it('allows a later size to override a typography token without removing color', () => {
    expect(cn('text-ui-body text-primary', 'text-sm')).toBe('text-primary text-sm')
  })
})
