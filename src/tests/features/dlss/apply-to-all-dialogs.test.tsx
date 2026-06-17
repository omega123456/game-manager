import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApplyToAllDialog } from '@/features/dlss/apply-to-all-dialog'
import { ApplyToAllResultDialog } from '@/features/dlss/apply-to-all-result-dialog'
import type { BatchApplyResult } from '@/types/dlss'
import { renderWithProviders } from '../../helpers/render-app'

describe('ApplyToAllDialog', () => {
  it('shows the type, version, count, and confirms', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    renderWithProviders(
      <ApplyToAllDialog
        open
        onOpenChange={vi.fn()}
        dllTypeLabel="DLSS Super Resolution"
        versionLabel="v3.7.10"
        count={12}
        onConfirm={onConfirm}
      />
    )
    expect(
      screen.getByText(/Apply DLSS Super Resolution v3.7.10 to all games\?/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/replaces the current DLL in 12 games/i)).toBeInTheDocument()
    expect(screen.queryByText(/currently running are skipped/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Apply to 12' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('ApplyToAllResultDialog', () => {
  const result: BatchApplyResult = {
    total: 2,
    succeeded: 1,
    failed: 1,
    results: [
      { gameId: 1, name: 'Elden Ring', ok: true, message: 'Updated to 3.7.10' },
      { gameId: 2, name: 'City Skyline X', ok: false, message: 'Access denied' },
    ],
  }

  it('lists per-game results', () => {
    renderWithProviders(<ApplyToAllResultDialog open onOpenChange={vi.fn()} result={result} />)
    expect(screen.getByText('1 of 2 games updated.')).toBeInTheDocument()
    expect(screen.getByText('Elden Ring')).toBeInTheDocument()
    expect(screen.getByText('Access denied')).toBeInTheDocument()
  })

  it('handles a null result', () => {
    renderWithProviders(<ApplyToAllResultDialog open onOpenChange={vi.fn()} result={null} />)
    expect(screen.getByText('No results available.')).toBeInTheDocument()
  })
})
