import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import DlssRoute, { DlssRoute as NamedDlssRoute } from '@/routes/dlss-route'
import { renderWithProviders } from '../helpers/render-app'

describe('DlssRoute', () => {
  it('renders the DLSS Management page (named + default export are the same)', async () => {
    expect(DlssRoute).toBe(NamedDlssRoute)
    renderWithProviders(<DlssRoute />, { route: '/dlss' })
    expect(
      await screen.findByRole('heading', { name: 'DLSS Management', level: 1 })
    ).toBeInTheDocument()
  })
})
