import { useState } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { DependencyPicker } from '@/features/scripts/dependency-picker'
import { renderWithProviders } from '@/tests/helpers/render-app'
import { emptyPhase } from '@/features/scripts/script-form-types'
import type { Script } from '@/types/domain'

function utility(id: number, name: string, requires: number[] = []): Script {
  return {
    id,
    name,
    kind: 'utility',
    priority: 5,
    beforeLaunch: emptyPhase(),
    afterLaunch: emptyPhase(),
    onExit: emptyPhase(),
    snippet: { mode: 'inline', inline: 'f', interpreter: 'powershell' },
    createdAt: '2026-01-01T00:00:00Z',
    requires,
  }
}

const NORMAL: Script = {
  id: 10,
  name: 'Auto-Save',
  kind: 'normal',
  priority: 7,
  beforeLaunch: emptyPhase(),
  afterLaunch: emptyPhase(),
  onExit: emptyPhase(),
  snippet: emptyPhase(),
  createdAt: '2026-01-01T00:00:00Z',
  requires: [],
}

function Harness({
  scriptId,
  allScripts,
  initial = [],
}: {
  scriptId: number
  allScripts: Script[]
  initial?: number[]
}): React.JSX.Element {
  const [requires, setRequires] = useState<number[]>(initial)
  return (
    <DependencyPicker
      scriptId={scriptId}
      allScripts={allScripts}
      requires={requires}
      onAdd={(id) => setRequires((r) => [...r, id])}
      onRemove={(id) => setRequires((r) => r.filter((x) => x !== id))}
    />
  )
}

describe('DependencyPicker', () => {
  it('lists utility scripts only (self + non-utilities excluded) and adds one', async () => {
    const user = userEvent.setup()
    const lib = utility(3, 'SaveLib')
    const helper = utility(4, 'Helper')
    renderWithProviders(<Harness scriptId={10} allScripts={[NORMAL, lib, helper]} />)

    await user.click(screen.getByRole('button', { name: 'Add Requirement' }))
    // Non-utility "Auto-Save" must not appear as an option.
    expect(screen.queryByRole('option', { name: /Auto-Save/ })).not.toBeInTheDocument()

    await user.click(await screen.findByText('SaveLib'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove SaveLib' })).toBeInTheDocument()
    )
  })

  it('removes a selected utility chip', async () => {
    const user = userEvent.setup()
    const lib = utility(3, 'SaveLib')
    renderWithProviders(<Harness scriptId={10} allScripts={[NORMAL, lib]} initial={[3]} />)

    await user.click(screen.getByRole('button', { name: 'Remove SaveLib' }))
    expect(screen.getByText('No required utilities.')).toBeInTheDocument()
  })

  it('disables already-required and cycle-creating options', async () => {
    const user = userEvent.setup()
    // We are editing script 4 (Helper). SaveLib(3) requires Helper(4), so adding
    // 4 -> 3 would create a cycle. Also pre-select nothing.
    const lib = utility(3, 'SaveLib', [4])
    const self = utility(4, 'Helper')
    const free = utility(5, 'Free')
    renderWithProviders(<Harness scriptId={4} allScripts={[lib, self, free]} initial={[5]} />)

    await user.click(screen.getByRole('button', { name: 'Add Requirement' }))

    const options = await screen.findAllByRole('option')
    const cyclicOption = options.find((o) => o.textContent?.includes('SaveLib'))
    expect(cyclicOption).toHaveAttribute('aria-disabled', 'true')
    // The cyclic option carries the circular-reference reason.
    expect(cyclicOption).toHaveAttribute(
      'data-disabled-reason',
      'would create a circular reference'
    )

    // Free is already required → disabled.
    const freeOption = options.find((o) => o.textContent?.includes('Free'))
    expect(freeOption).toHaveAttribute('aria-disabled', 'true')
    expect(freeOption).toHaveAttribute('data-disabled-reason', 'Already required')
  })

  it('shows the empty message when there are no utility candidates', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness scriptId={10} allScripts={[NORMAL]} />)
    await user.click(screen.getByRole('button', { name: 'Add Requirement' }))
    expect(await screen.findByText('No utility scripts found.')).toBeInTheDocument()
  })
})
