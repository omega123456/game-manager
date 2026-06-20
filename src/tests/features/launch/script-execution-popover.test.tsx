import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Button } from '@/components/ui/button'
import { ScriptExecutionPopover } from '@/features/launch/script-execution-popover'
import { renderWithProviders } from '@/tests/helpers/render-app'
import { ipc } from '@/tests/ipc-mock'
import type { LaunchRun } from '@/types/domain'

function createLaunchRun(overrides: Partial<LaunchRun> & Pick<LaunchRun, 'gameId'>): LaunchRun {
  return {
    id: 41,
    status: 'active',
    startedAt: '2026-06-19T10:00:00Z',
    failureCount: 0,
    scriptRecords: [],
    ...overrides,
  }
}

function renderPopover(gameId = 1): void {
  renderWithProviders(
    <ScriptExecutionPopover
      gameId={gameId}
      gameName="Alan Wake 2"
      trigger={
        <Button variant="outline" size="sm">
          Scripts
        </Button>
      }
    />
  )
}

describe('ScriptExecutionPopover', () => {
  it('renders all three phases with empty states when no retained run exists', async () => {
    const user = userEvent.setup()
    ipc.override('get_latest_launch_run', () => null)

    renderPopover()

    await user.click(screen.getByRole('button', { name: 'Scripts' }))

    const popover = await screen.findByText('Execution pipeline')
    expect(popover).toBeInTheDocument()
    expect(screen.getByText('No session')).toBeInTheDocument()
    expect(screen.getByText('No retained script execution')).toBeInTheDocument()

    expect(screen.getByTestId('script-phase-before')).toHaveTextContent(
      'No scripts queued before launch.'
    )
    expect(screen.getByTestId('script-phase-after')).toHaveTextContent(
      'No scripts queued after process detection.'
    )
    expect(screen.getByTestId('script-phase-onExit')).toHaveTextContent(
      'No scripts queued for game exit.'
    )
  })

  it('shows loading state before the query resolves', async () => {
    const user = userEvent.setup()
    let resolveRun!: (value: LaunchRun | null) => void
    ipc.override(
      'get_latest_launch_run',
      () =>
        new Promise<LaunchRun | null>((resolve) => {
          resolveRun = resolve
        })
    )

    renderPopover()

    await user.click(screen.getByRole('button', { name: 'Scripts' }))

    expect(await screen.findByText('Loading')).toBeInTheDocument()
    expect(screen.getByTestId('script-execution-loading')).toHaveTextContent(
      'Loading script execution details…'
    )

    resolveRun(null)
    await waitFor(() => {
      expect(screen.queryByTestId('script-execution-loading')).not.toBeInTheDocument()
    })
  })

  it('shows an error state when the latest-run query fails', async () => {
    const user = userEvent.setup()
    ipc.override('get_latest_launch_run', () => {
      throw new Error('Backend unavailable')
    })

    renderPopover()

    await user.click(screen.getByRole('button', { name: 'Scripts' }))

    expect(await screen.findByTestId('script-execution-error')).toHaveTextContent(
      'Backend unavailable'
    )
  })

  it('renders active run rows with icon, status, script name, and metadata', async () => {
    const user = userEvent.setup()
    ipc.override('get_latest_launch_run', () =>
      createLaunchRun({
        gameId: 1,
        scriptRecords: [
          {
            id: 1,
            launchRunId: 41,
            scriptId: 11,
            name: 'Auto-Save Manager',
            phase: 'before',
            provenance: 'direct',
            order: 1,
            priority: 8,
            requiredUtilityNames: ['SaveLib'],
            status: 'succeeded',
          },
          {
            id: 2,
            launchRunId: 41,
            scriptId: 12,
            name: 'HDR Toggle',
            phase: 'after',
            provenance: 'group',
            groupName: 'Display Tools',
            order: 1,
            priority: 5,
            requiredUtilityNames: [],
            status: 'running',
            details: 'Waiting for process attach',
          },
          {
            id: 3,
            launchRunId: 41,
            scriptId: 13,
            name: 'Restore HDR',
            phase: 'onExit',
            provenance: 'global',
            order: 1,
            priority: 5,
            requiredUtilityNames: ['Cleanup'],
            status: 'pending',
          },
        ],
      })
    )

    renderPopover()

    await user.click(screen.getByRole('button', { name: 'Scripts' }))

    expect(await screen.findByText('Live')).toBeInTheDocument()
    expect(screen.getByText('3 scripts')).toBeInTheDocument()

    const beforeRow = screen.getByTestId('script-execution-row-1')
    expect(within(beforeRow).getByText('Auto-Save Manager')).toBeInTheDocument()
    expect(within(beforeRow).getByText('Succeeded')).toBeInTheDocument()
    expect(screen.getByTestId('script-execution-status-1')).toHaveClass('text-emerald-700')
    expect(screen.getByTestId('script-execution-icon-1')).toHaveClass('text-emerald-700')
    expect(within(beforeRow).getByText('Direct · Requires SaveLib')).toBeInTheDocument()
    expect(within(beforeRow).getByText('check_circle')).toBeInTheDocument()

    const afterRow = screen.getByTestId('script-execution-row-2')
    expect(within(afterRow).getByText('HDR Toggle')).toBeInTheDocument()
    expect(within(afterRow).getByText('Running')).toBeInTheDocument()
    expect(screen.getByTestId('script-execution-status-2')).toHaveClass('text-primary')
    expect(screen.getByTestId('script-execution-icon-2')).toHaveClass('text-primary')
    expect(
      within(afterRow).getByText('Group: Display Tools · No utilities required')
    ).toBeInTheDocument()
    expect(within(afterRow).getByText('Waiting for process attach')).toBeInTheDocument()
    expect(within(afterRow).getByText('autorenew')).toBeInTheDocument()

    const exitRow = screen.getByTestId('script-execution-row-3')
    expect(within(exitRow).getByText('Restore HDR')).toBeInTheDocument()
    expect(within(exitRow).getByText('Pending')).toBeInTheDocument()
    expect(screen.getByTestId('script-execution-status-3')).toHaveClass('text-amber-700')
    expect(screen.getByTestId('script-execution-icon-3')).toHaveClass('text-amber-700')
    expect(within(exitRow).getByText('Global · Requires Cleanup')).toBeInTheDocument()
    expect(within(exitRow).getByText('radio_button_unchecked')).toBeInTheDocument()
  })

  it('renders the last-session label and phase grouping for completed runs', async () => {
    const user = userEvent.setup()
    ipc.override('get_latest_launch_run', () =>
      createLaunchRun({
        gameId: 1,
        status: 'completed',
        endedAt: '2026-06-19T10:01:15Z',
        failureCount: 1,
        scriptRecords: [
          {
            id: 9,
            launchRunId: 41,
            scriptId: 20,
            name: 'Validate mods',
            phase: 'before',
            provenance: 'direct',
            order: 1,
            priority: 2,
            requiredUtilityNames: [],
            status: 'failed',
            details: 'Process attach timed out',
          },
        ],
      })
    )

    renderPopover()

    await user.click(screen.getByRole('button', { name: 'Scripts' }))

    expect(await screen.findByText('Retained session')).toBeInTheDocument()
    expect(screen.getByText('1 script · 1 failed')).toBeInTheDocument()
    expect(screen.getByTestId('script-execution-status-9')).toHaveClass('text-destructive')
    expect(screen.getByTestId('script-execution-icon-9')).toHaveClass('text-destructive')
    expect(screen.getByTestId('script-phase-before')).toHaveTextContent('Validate mods')
    expect(screen.getByTestId('script-phase-after')).toHaveTextContent(
      'No scripts queued after process detection.'
    )
    expect(screen.getByTestId('script-phase-onExit')).toHaveTextContent(
      'No scripts queued for game exit.'
    )
  })

  it('renders per-row timing chips for running and completed records but not pending ones', async () => {
    const user = userEvent.setup()
    const startedAt = '2026-06-19T10:00:00Z'
    const runningStartedAt = new Date(Date.now() - 5_000).toISOString()
    ipc.override('get_latest_launch_run', () =>
      createLaunchRun({
        gameId: 1,
        scriptRecords: [
          {
            id: 1,
            launchRunId: 41,
            scriptId: 11,
            name: 'Auto-Save Manager',
            phase: 'before',
            provenance: 'direct',
            order: 1,
            priority: 8,
            requiredUtilityNames: [],
            status: 'succeeded',
            startedAt,
            endedAt: '2026-06-19T10:00:12Z',
          },
          {
            id: 2,
            launchRunId: 41,
            scriptId: 12,
            name: 'HDR Toggle',
            phase: 'after',
            provenance: 'direct',
            order: 1,
            priority: 5,
            requiredUtilityNames: [],
            status: 'running',
            startedAt: runningStartedAt,
          },
          {
            id: 3,
            launchRunId: 41,
            scriptId: 13,
            name: 'Restore HDR',
            phase: 'onExit',
            provenance: 'direct',
            order: 1,
            priority: 5,
            requiredUtilityNames: [],
            status: 'pending',
          },
        ],
      })
    )

    renderPopover()

    await user.click(screen.getByRole('button', { name: 'Scripts' }))

    // Completed record: exact 12s duration chip (endedAt - startedAt).
    const completedChip = await screen.findByTestId('script-execution-timing-1')
    expect(completedChip).toHaveTextContent('12s')

    // Running record: an elapsed chip is present (value depends on wall clock).
    expect(screen.getByTestId('script-execution-timing-2')).toBeInTheDocument()

    // Pending record: no timing chip.
    expect(screen.queryByTestId('script-execution-timing-3')).not.toBeInTheDocument()
  })

  it('supports keyboard open and escape close without losing focus semantics', async () => {
    const user = userEvent.setup()
    ipc.override('get_latest_launch_run', () => null)

    renderPopover()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Scripts' })).toHaveFocus()

    await user.keyboard('[Space]')
    expect(await screen.findByText('Execution pipeline')).toBeInTheDocument()

    await user.keyboard('[Escape]')
    await waitFor(() => {
      expect(screen.queryByText('Execution pipeline')).not.toBeInTheDocument()
    })
  })
})
