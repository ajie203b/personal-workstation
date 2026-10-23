import { describe, expect, it } from 'vitest'
import {
  compareVersions, detectUpdatePlatform, fallbackApkUrl, isNewerVersion, mirrorUrls, normalizeVersion,
  parseLatestRelease, pickApkAsset, plainNotes, progressPercent, shouldAutoCheck,
} from './appUpdate'

describe('normalizeVersion', () => {
  it('去掉 v 前缀与空白', () => {
    expect(normalizeVersion('v3.3.5')).toBe('3.3.5')
    expect(normalizeVersion(' 3.4 ')).toBe('3.4')
  })
  it('非法输入返回空串', () => {
    expect(normalizeVersion('<!DOCTYPE html>')).toBe('')
    expect(normalizeVersion('3.3.5-beta')).toBe('')
    expect(normalizeVersion(undefined)).toBe('')
    expect(normalizeVersion(335)).toBe('')
  })
})

describe('compareVersions / isNewerVersion', () => {
  it('按数字逐段比较，不按字符串', () => {
    expect(compareVersions('3.10.0', '3.9.9')).toBe(1)
    expect(compareVersions('3.3.5', '3.3.10')).toBe(-1)
    expect(compareVersions('v3.3.5', '3.3.5')).toBe(0)
  })
  it('缺的段按 0 算', () => {
    expect(compareVersions('3.3', '3.3.0')).toBe(0)
    expect(compareVersions('4', '3.99.99')).toBe(1)
  })
  it('非法版本号不算有更新', () => {
    expect(isNewerVersion('', '3.3.5')).toBe(false)
    expect(isNewerVersion('3.3.6', 'dev')).toBe(false)
    expect(isNewerVersion('3.3.6', '3.3.5')).toBe(true)
    expect(isNewerVersion('3.3.5', '3.3.5')).toBe(false)
  })
})

const RELEASE = {
  tag_name: 'v3.4.0',
  body: '- 新增自动更新\n- 修复若干问题',
  published_at: '2026-10-24T02:00:00Z',
  html_url: 'https://github.com/ajie203b/personal-workstation/releases/tag/v3.4.0',
  draft: false,
  prerelease: false,
  assets: [
    { name: 'Kairos_3.4.0_x64-setup.exe', browser_download_url: 'https://github.com/x/y/releases/download/v3.4.0/Kairos_3.4.0_x64-setup.exe', size: 9 },
    { name: 'latest.json', browser_download_url: 'https://github.com/x/y/releases/download/v3.4.0/latest.json', size: 1 },
    { name: 'personal-workstation-v3.4.0.apk', browser_download_url: 'https://github.com/x/y/releases/download/v3.4.0/personal-workstation-v3.4.0.apk', size: 12345 },
  ],
}

describe('parseLatestRelease', () => {
  it('解析版本、说明与附件', () => {
    const r = parseLatestRelease(RELEASE)!
    expect(r.version).toBe('3.4.0')
    expect(r.tag).toBe('v3.4.0')
    expect(r.notes).toContain('自动更新')
    expect(r.assets).toHaveLength(3)
    expect(r.assets[2]).toEqual({ name: 'personal-workstation-v3.4.0.apk', url: RELEASE.assets[2].browser_download_url, size: 12345 })
  })
  it('草稿 / 预发布 / 坏数据返回 null', () => {
    expect(parseLatestRelease({ ...RELEASE, prerelease: true })).toBeNull()
    expect(parseLatestRelease({ ...RELEASE, draft: true })).toBeNull()
    expect(parseLatestRelease({ ...RELEASE, tag_name: 'nightly' })).toBeNull()
    expect(parseLatestRelease({ message: 'API rate limit exceeded' })).toBeNull()
    expect(parseLatestRelease(null)).toBeNull()
    expect(parseLatestRelease('oops')).toBeNull()
  })
  it('丢弃非 https 或缺字段的附件', () => {
    const r = parseLatestRelease({ ...RELEASE, assets: [{ name: 'a.apk', browser_download_url: 'http://evil/a.apk' }, { name: 'b.apk' }, null] })!
    expect(r.assets).toEqual([])
  })
})

describe('pickApkAsset', () => {
  const assets = parseLatestRelease(RELEASE)!.assets
  it('优先固定命名', () => {
    const extra = [{ name: 'other.apk', url: 'https://github.com/o.apk', size: 1 }, ...assets]
    expect(pickApkAsset(extra, '3.4.0')?.name).toBe('personal-workstation-v3.4.0.apk')
  })
  it('没有固定命名时取带版本号的，再取任意 apk', () => {
    expect(pickApkAsset([
      { name: 'old-3.3.0.apk', url: 'https://github.com/1', size: 1 },
      { name: 'kairos-3.4.0.apk', url: 'https://github.com/2', size: 1 },
    ], 'v3.4.0')?.name).toBe('kairos-3.4.0.apk')
    expect(pickApkAsset([{ name: 'app.APK', url: 'https://github.com/3', size: 1 }], '3.4.0')?.name).toBe('app.APK')
  })
  it('没有 apk 返回 null', () => {
    expect(pickApkAsset(assets.filter((a) => !a.name.endsWith('.apk')), '3.4.0')).toBeNull()
  })
})

describe('fallbackApkUrl / mirrorUrls', () => {
  it('按发布脚本命名拼直链', () => {
    expect(fallbackApkUrl('v3.4.0')).toBe('https://github.com/ajie203b/personal-workstation/releases/download/v3.4.0/personal-workstation-v3.4.0.apk')
  })
  it('github 地址：直连在前，镜像前缀在后', () => {
    const u = 'https://github.com/a/b/releases/download/v1/x.apk'
    expect(mirrorUrls(u, ['https://m1.example', 'https://m2.example/'])).toEqual([
      u, `https://m1.example/${u}`, `https://m2.example/${u}`,
    ])
  })
  it('非 github 地址不套镜像', () => {
    expect(mirrorUrls('https://example.com/x.apk', ['https://m1/'])).toEqual(['https://example.com/x.apk'])
  })
})

describe('shouldAutoCheck', () => {
  it('关闭时不查', () => {
    expect(shouldAutoCheck({ enabled: false, lastCheckDay: null, today: '2026-10-24' })).toBe(false)
  })
  it('每天最多一次', () => {
    expect(shouldAutoCheck({ enabled: true, lastCheckDay: null, today: '2026-10-24' })).toBe(true)
    expect(shouldAutoCheck({ enabled: true, lastCheckDay: '2026-10-24', today: '2026-10-24' })).toBe(false)
    expect(shouldAutoCheck({ enabled: true, lastCheckDay: '2026-10-23', today: '2026-10-24' })).toBe(true)
  })
})

describe('detectUpdatePlatform', () => {
  it('桌面 / 安卓 / 网页', () => {
    expect(detectUpdatePlatform({ tauri: true, native: false })).toBe('desktop')
    expect(detectUpdatePlatform({ tauri: false, native: true, nativePlatform: 'android' })).toBe('android')
    expect(detectUpdatePlatform({ tauri: false, native: true, nativePlatform: 'ios' })).toBe('web')
    expect(detectUpdatePlatform({ tauri: false, native: false })).toBe('web')
  })
})

describe('plainNotes / progressPercent', () => {
  it('去掉常见 Markdown 语法', () => {
    expect(plainNotes('## 标题\n- **修复** `OCR`\n- 见[说明](https://x)')).toBe('标题\n• 修复 OCR\n• 见说明')
  })
  it('过长截断', () => {
    expect(plainNotes('啊'.repeat(20), 5)).toBe('啊啊啊啊啊…')
  })
  it('总长未知返回 null，其余夹在 0–100', () => {
    expect(progressPercent(10, -1)).toBeNull()
    expect(progressPercent(10, 0)).toBeNull()
    expect(progressPercent(50, 200)).toBe(25)
    expect(progressPercent(300, 200)).toBe(100)
  })
})
