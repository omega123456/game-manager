import { beforeEach, describe, expect, it } from 'vitest'
import { mockConvertFileSrc } from '@tauri-apps/api/mocks'

import { toCoverImageUrl } from '@/lib/asset-url'

describe('toCoverImageUrl', () => {
  beforeEach(() => {
    mockConvertFileSrc('windows')
  })

  it('returns null for empty or missing values', () => {
    expect(toCoverImageUrl(null)).toBeNull()
    expect(toCoverImageUrl(undefined)).toBeNull()
    expect(toCoverImageUrl('   ')).toBeNull()
  })

  it('passes through values that already carry a URL scheme', () => {
    expect(toCoverImageUrl('https://cdn.example.test/cover.png')).toBe(
      'https://cdn.example.test/cover.png'
    )
    expect(toCoverImageUrl('http://asset.localhost/abc')).toBe('http://asset.localhost/abc')
    expect(toCoverImageUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
  })

  it('converts a raw filesystem path into a webview-safe asset URL', () => {
    const result = toCoverImageUrl('C:/Cache/cover.png')
    expect(result).toContain('asset.localhost')
    expect(result).not.toBe('C:/Cache/cover.png')
  })
})
