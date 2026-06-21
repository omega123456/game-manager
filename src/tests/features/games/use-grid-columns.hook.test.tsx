import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useGridColumns } from '@/features/games/use-grid-columns'

function Probe(): React.JSX.Element {
  const { columns, observe } = useGridColumns()
  return (
    <div ref={observe}>
      <span data-testid="columns">{columns}</span>
    </div>
  )
}

function ProbeWithoutElement(): React.JSX.Element {
  const { columns } = useGridColumns()
  return <span data-testid="columns">{columns}</span>
}

describe('useGridColumns', () => {
  it('derives the column count from the observed container width', () => {
    render(<Probe />)
    // jsdom layout stubs report a 1200px content width -> 5 columns.
    expect(screen.getByTestId('columns')).toHaveTextContent('5')
  })

  it('stays at a single column when the observer is never attached', () => {
    render(<ProbeWithoutElement />)
    expect(screen.getByTestId('columns')).toHaveTextContent('1')
  })
})
