import { useState } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { monacoEditorMock } from '@/tests/helpers/monaco-mock'

vi.mock('monaco-editor', () => ({}))
vi.mock('@monaco-editor/react', () => monacoEditorMock())

import { PhaseBlock } from '@/features/scripts/phase-block'
import { renderWithProviders } from '@/tests/helpers/render-app'
import { overrideIpcCommands } from '@/tests/ipc-mock'
import type { PhaseConfig } from '@/types/domain'

function Harness({ initial }: { initial: PhaseConfig }): React.JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <PhaseBlock
      label="Before Launch"
      icon="play_arrow"
      idPrefix="beforeLaunch"
      value={value}
      onChange={setValue}
    />
  )
}

describe('PhaseBlock', () => {
  beforeEach(() => {
    overrideIpcCommands({ 'plugin:dialog|open': () => 'C:/Commands/picked.ps1' })
  })

  it('starts on the Path tab for an empty phase and edits the path', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness initial={{ mode: 'none' }} />)

    const block = screen.getByTestId('phase-block-beforeLaunch')
    expect(within(block).getByRole('radio', { name: 'Path' })).toHaveAttribute(
      'aria-checked',
      'true'
    )

    await user.type(screen.getByLabelText('Before Launch script path'), 'C:/run.ps1')
    expect(screen.getByLabelText('Before Launch script path')).toHaveValue('C:/run.ps1')
  })

  it('switches to Code and edits inline content with an interpreter selector', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness initial={{ mode: 'none' }} />)

    await user.click(screen.getByRole('radio', { name: 'Code' }))
    const editor = await screen.findByTestId('monaco-mock')
    await user.type(editor, 'Write-Host hi')
    expect(editor).toHaveValue('Write-Host hi')

    await user.click(screen.getByRole('radio', { name: 'Batch' }))
    expect(screen.getByRole('radio', { name: 'Batch' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('monaco-mock')).toHaveAttribute('data-language', 'bat')
  })

  it('selects the PowerShell 7 interpreter while keeping PowerShell highlighting', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Harness initial={{ mode: 'inline', inline: 'Write-Output 1', interpreter: 'powershell' }} />
    )

    await user.click(screen.getByRole('radio', { name: 'PowerShell 7' }))
    expect(screen.getByRole('radio', { name: 'PowerShell 7' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByTestId('monaco-mock')).toHaveAttribute('data-language', 'powershell')
  })

  it('warns before discarding inline code when switching Code → Path', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Harness initial={{ mode: 'inline', inline: 'echo keep', interpreter: 'powershell' }} />
    )

    await user.click(screen.getByRole('radio', { name: 'Path' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('Discard inline code?')).toBeInTheDocument()

    // Cancel keeps us on Code.
    await user.click(screen.getByRole('button', { name: 'Keep editing code' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('monaco-mock')).toBeInTheDocument()

    // Confirm switches to Path.
    await user.click(screen.getByRole('radio', { name: 'Path' }))
    await user.click(await screen.findByRole('button', { name: 'Use a path' }))
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Path' })).toHaveAttribute('aria-checked', 'true')
    )
  })

  it('switches Code → Path without a warning when inline content is empty', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Harness initial={{ mode: 'inline', inline: '', interpreter: 'powershell' }} />
    )

    await user.click(screen.getByRole('radio', { name: 'Path' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Before Launch script path')).toBeInTheDocument()
  })

  it('fills the path from the file picker on Browse', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness initial={{ mode: 'path', path: '' }} />)

    await user.click(screen.getByRole('button', { name: 'Browse' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Before Launch script path')).toHaveValue(
        'C:/Commands/picked.ps1'
      )
    )
  })

  it('surfaces a browse error when the picker rejects', async () => {
    overrideIpcCommands({
      'plugin:dialog|open': () => {
        throw new Error('picker blew up')
      },
    })
    const user = userEvent.setup()
    renderWithProviders(<Harness initial={{ mode: 'path', path: '' }} />)

    await user.click(screen.getByRole('button', { name: 'Browse' }))
    expect(await screen.findByText('picker blew up')).toBeInTheDocument()
  })
})
