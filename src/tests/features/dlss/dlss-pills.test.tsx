import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DlssPills } from '@/features/dlss/dlss-pills'
import type { DllCatalog, GameDlssState, PresetOption } from '@/types/dlss'

const FULL_STATE: GameDlssState = {
  gameId: 1,
  superResolution: { version: '3.7.10', path: 'a' },
  frameGeneration: { version: '1.1.0', path: 'b' },
  rayReconstruction: { version: '3.5.0', path: 'c' },
  stale: false,
}

function dllVersion(version: string): DllCatalog['superResolution'][number] {
  return {
    type: 'superResolution',
    version,
    versionNumber: Number(version.replace(/\./g, '')),
    label: version,
    md5: `md5-${version}`,
    zipMd5: `zip-${version}`,
    downloadUrl: `https://example.test/${version}.zip`,
    fileSizeBytes: 1,
    zipSizeBytes: 1,
    isSignatureValid: true,
    isDownloaded: true,
  }
}

// Catalog is sorted newest-first; the first entry per type is the latest.
const CATALOG: DllCatalog = {
  superResolution: [dllVersion('3.7.10'), dllVersion('3.5.10')],
  frameGeneration: [{ ...dllVersion('1.1.0'), type: 'frameGeneration' }],
  rayReconstruction: [{ ...dllVersion('3.5.0'), type: 'rayReconstruction' }],
  source: 'static',
}

const SR_PRESET_OPTIONS: PresetOption[] = [
  { value: 0, name: 'Default', deprecated: false },
  { value: 5, name: 'Preset E', deprecated: false },
  { value: 0x00ffffff, name: 'NVIDIA recommended', deprecated: false },
]

describe('DlssPills', () => {
  it('renders abbreviated pills for each detected DLL', () => {
    render(<DlssPills state={FULL_STATE} />)
    const pills = screen.getByTestId('dlss-pills')
    expect(pills).toHaveTextContent('SR 3.7')
    expect(pills).toHaveTextContent('FG 1.1')
    expect(pills).toHaveTextContent('RR 3.5')
    expect(pills).toHaveAttribute('aria-hidden')
  })

  it('omits a pill for a missing DLL', () => {
    render(
      <DlssPills
        state={{ ...FULL_STATE, frameGeneration: undefined, rayReconstruction: undefined }}
      />
    )
    const pills = screen.getByTestId('dlss-pills')
    expect(pills).toHaveTextContent('SR 3.7')
    expect(pills).not.toHaveTextContent('FG')
    expect(pills).not.toHaveTextContent('RR')
  })

  it('renders nothing when no DLLs are detected', () => {
    render(<DlssPills state={{ gameId: 1, stale: false }} />)
    expect(screen.queryByTestId('dlss-pills')).not.toBeInTheDocument()
  })

  it('renders nothing without state', () => {
    render(<DlssPills />)
    expect(screen.queryByTestId('dlss-pills')).not.toBeInTheDocument()
  })

  it('offsets the stack below the playing pip when present', () => {
    render(<DlssPills state={FULL_STATE} hasPlayingPip />)
    expect(screen.getByTestId('dlss-pills')).toHaveClass('top-12')
  })

  it('anchors at the top when no playing pip', () => {
    render(<DlssPills state={FULL_STATE} />)
    expect(screen.getByTestId('dlss-pills')).toHaveClass('top-3')
  })

  it('keeps a two-segment version unchanged', () => {
    render(
      <DlssPills
        state={{ gameId: 1, superResolution: { version: '3.7', path: 'a' }, stale: false }}
      />
    )
    expect(screen.getByTestId('dlss-pills')).toHaveTextContent('SR 3.7')
  })

  it('uses neutral styling when no catalog is provided', () => {
    render(<DlssPills state={FULL_STATE} />)
    const sr = screen.getByText(/SR 3\.7/)
    expect(sr).toHaveAttribute('data-tone', 'unknown')
    expect(sr).toHaveClass('text-foreground')
  })

  it('colors the latest version green and an outdated version amber', () => {
    render(
      <DlssPills
        state={{
          gameId: 1,
          superResolution: { version: '3.5.10', path: 'a' }, // outdated
          frameGeneration: { version: '1.1.0', path: 'b' }, // latest
          stale: false,
        }}
        catalog={CATALOG}
      />
    )
    const sr = screen.getByText(/SR 3\.5/)
    const fg = screen.getByText(/FG 1\.1/)
    expect(sr).toHaveAttribute('data-tone', 'outdated')
    expect(sr).toHaveClass('text-warning')
    expect(fg).toHaveAttribute('data-tone', 'latest')
    expect(fg).toHaveClass('text-success')
  })

  it('stays neutral when the catalog has no entries for the detected type', () => {
    render(
      <DlssPills
        state={{ gameId: 1, superResolution: { version: '3.7.10', path: 'a' }, stale: false }}
        catalog={{ ...CATALOG, superResolution: [] }}
      />
    )
    const sr = screen.getByText(/SR 3\.7/)
    expect(sr).toHaveAttribute('data-tone', 'unknown')
  })

  it('renders the SR preset letter for a lettered preset', () => {
    render(
      <DlssPills
        state={{ ...FULL_STATE, srPreset: 5 }}
        catalog={CATALOG}
        srPresetOptions={SR_PRESET_OPTIONS}
      />
    )
    expect(screen.getByText(/SR 3\.7 \(E\)/)).toBeInTheDocument()
    // The letter is SR-only.
    expect(screen.getByText(/FG 1\.1/)).not.toHaveTextContent('(')
  })

  it('omits the letter for the Default preset', () => {
    render(
      <DlssPills
        state={{ ...FULL_STATE, srPreset: 0 }}
        catalog={CATALOG}
        srPresetOptions={SR_PRESET_OPTIONS}
      />
    )
    expect(screen.getByText('SR 3.7')).toBeInTheDocument()
  })

  it('omits the letter for a non-lettered preset (e.g. NVIDIA recommended)', () => {
    render(
      <DlssPills
        state={{ ...FULL_STATE, srPreset: 0x00ffffff }}
        catalog={CATALOG}
        srPresetOptions={SR_PRESET_OPTIONS}
      />
    )
    expect(screen.getByText('SR 3.7')).toBeInTheDocument()
  })
})
