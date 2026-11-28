import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPreviewHtml } from './HtmlPreview'

describe('HtmlPreview & Tauri desktop CSP compatibility', () => {
  it('allows inline/eval scripts and in-page anchors while blocking external network & meta refresh', () => {
    const src = '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://evil.test"><title>Demo</title></head><body><a href="#s1">Go</a><script>window.ok=1</script></body></html>'
    const desktopHtml = buildPreviewHtml(src, false)

    expect(desktopHtml).not.toMatch(/http-equiv\s*=\s*"refresh"/i)
    expect(desktopHtml).not.toContain('navigate-to')
    expect(desktopHtml).toContain("script-src 'unsafe-inline' 'unsafe-eval' data: blob:")
    expect(desktopHtml).toContain('<base href="about:srcdoc" target="_self">')
    expect(desktopHtml).toContain('base-uri about:')

    const androidHtml = buildPreviewHtml(src, true)
    expect(androidHtml).not.toContain('<base href=')
    expect(androidHtml).toContain("base-uri 'none'")
  })

  it('does not inject head metadata inside a script string literal when no real <head> exists', () => {
    const src = '<!doctype html><html><body><script>const tag = "<head>";</script></body></html>'
    const out = buildPreviewHtml(src, false)
    expect(out).toContain('const tag = "<head>";')
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<body>'))
  })

  it('keeps Tauri v2 CSP compatible with sandboxed srcdoc HTML documents', () => {
    const raw = readFileSync(resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8')
    const conf = JSON.parse(raw) as {
      app?: { security?: { csp?: string; dangerousDisableAssetCspModification?: boolean | string[] } }
    }
    const csp = conf.app?.security?.csp ?? ''
    const disabled = conf.app?.security?.dangerousDisableAssetCspModification

    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).toContain('base-uri \'self\' about:')
    expect(csp).toContain('frame-src')
    expect(Array.isArray(disabled) ? disabled : []).toContain('script-src')
  })
})
