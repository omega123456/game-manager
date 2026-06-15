import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { GlobalScriptsSection } from '@/features/settings/global-scripts-section'

describe('GlobalScriptsSection', () => {
  it('renders the placeholder empty-state when no scripts exist', () => {
    render(<GlobalScriptsSection />)
    expect(screen.getByRole('heading', { name: 'Global Scripts' })).toBeInTheDocument()
    expect(screen.getByTestId('global-scripts-placeholder')).toBeInTheDocument()
    expect(
      screen.getByText('Global script toggles appear here once you create scripts.')
    ).toBeInTheDocument()
  })
})
