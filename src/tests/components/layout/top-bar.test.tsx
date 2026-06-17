import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { TopBar } from '@/components/layout/top-bar'
import { renderWithProviders, resetUiStore } from '../../helpers/render-app'

describe('TopBar', () => {
  beforeEach(() => {
    resetUiStore()
  })

  it('renders the theme control without library search', () => {
    renderWithProviders(<TopBar />)
    expect(screen.getByTestId('top-bar')).toBeInTheDocument()
    expect(screen.getByTestId('theme-control')).toBeInTheDocument()
    expect(screen.queryByRole('searchbox', { name: 'Search games' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('play-now-button')).not.toBeInTheDocument()
  })
})
