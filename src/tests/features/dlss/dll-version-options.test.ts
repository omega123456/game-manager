import { describe, expect, it } from 'vitest'

import {
  buildVersionOptions,
  findVersion,
  formatApproxSize,
  SYSTEM_DEFAULT_VALUE,
  VERSION_GROUPS,
} from '@/features/dlss/dll-version-options'
import type { DllVersion } from '@/types/dlss'

function v(version: string, isDownloaded: boolean, zip = 45_000_000): DllVersion {
  return {
    type: 'superResolution',
    version,
    versionNumber: Number(version.replace(/\./g, '')),
    label: `v${version}`,
    md5: 'a',
    zipMd5: 'b',
    downloadUrl: 'u',
    fileSizeBytes: 1,
    zipSizeBytes: zip,
    isSignatureValid: true,
    isDownloaded,
  }
}

describe('formatApproxSize', () => {
  it('formats MB', () => {
    expect(formatApproxSize(45_000_000)).toBe('~43 MB')
  })
  it('formats KB for small sizes', () => {
    expect(formatApproxSize(500_000)).toBe('~488 KB')
  })
  it('returns empty for non-positive', () => {
    expect(formatApproxSize(0)).toBe('')
    expect(formatApproxSize(-5)).toBe('')
  })
})

describe('buildVersionOptions', () => {
  it('groups System Default, Downloaded, then Available preserving order', () => {
    const options = buildVersionOptions([v('3.8', false), v('3.7', true), v('3.5', true)])
    expect(options[0]).toMatchObject({
      value: SYSTEM_DEFAULT_VALUE,
      group: VERSION_GROUPS.systemDefault,
    })
    const downloaded = options.filter((o) => o.group === VERSION_GROUPS.downloaded)
    const available = options.filter((o) => o.group === VERSION_GROUPS.available)
    expect(downloaded.map((o) => o.value)).toEqual(['3.7', '3.5'])
    expect(available.map((o) => o.value)).toEqual(['3.8'])
  })

  it('drops duplicate version values from the same catalog list', () => {
    const options = buildVersionOptions([v('3.8', false), v('3.8', true), v('3.7', true)])
    expect(options.filter((option) => option.value === '3.8')).toHaveLength(1)
    expect(options.filter((option) => option.value === '3.7')).toHaveLength(1)
  })
})

describe('findVersion', () => {
  it('finds by display version', () => {
    const versions = [v('3.7', true), v('3.8', false)]
    expect(findVersion(versions, '3.8')?.version).toBe('3.8')
    expect(findVersion(versions, 'nope')).toBeUndefined()
  })
})
