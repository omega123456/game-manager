import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DlssPills } from '@/features/dlss/dlss-pills'
import type { GameDlssState } from '@/types/dlss'

const FULL_STATE: GameDlssState = {
  gameId: 1,
  superResolution: { version: '3.7.10', path: 'a' },
  frameGeneration: { version: '1.1.0', path: 'b' },
  rayReconstruction: { version: '3.5.0', path: 'c' },
  stale: false,
}

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
})
