import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SettingsSection } from '@/features/settings/settings-section'

describe('SettingsSection', () => {
  it('renders title, description and children', () => {
    render(
      <SettingsSection icon="palette" title="Appearance" description="Theme and accent.">
        <p>body</p>
      </SettingsSection>
    )
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
    expect(screen.getByText('Theme and accent.')).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('omits the description when not provided', () => {
    render(
      <SettingsSection icon="palette" title="Appearance">
        <p>body</p>
      </SettingsSection>
    )
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })
})
