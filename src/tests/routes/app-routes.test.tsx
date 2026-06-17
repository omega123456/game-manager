import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { AppRoutes } from '@/routes/app-routes'
import { renderWithProviders, resetUiStore } from '../helpers/render-app'

describe('AppRoutes', () => {
  beforeEach(() => resetUiStore())

  it('renders the Library route by default', async () => {
    renderWithProviders(<AppRoutes />, { route: '/' })
    expect(await screen.findByRole('heading', { name: 'Your collection' })).toBeInTheDocument()
  })

  it('navigates between all four destinations and highlights the active item', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/library' })

    const scriptsLink = screen.getByRole('link', { name: /Script Manager/ })
    await user.click(scriptsLink)
    expect(await screen.findByRole('heading', { name: 'Script Manager' })).toBeInTheDocument()
    expect(scriptsLink).toHaveClass('text-primary')

    await user.click(screen.getByRole('link', { name: /Group Manager/ }))
    expect(await screen.findByRole('heading', { name: 'Group Manager' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /Settings/ }))
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })

  it('renders the DLSS Management route (2nd nav item) and highlights it', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { route: '/library' })

    const links = screen.getAllByRole('link')
    expect(links[1]).toHaveTextContent('DLSS Management')

    const dlssLink = screen.getByRole('link', { name: /DLSS Management/ })
    await user.click(dlssLink)
    expect(
      await screen.findByRole('heading', { name: 'DLSS Management', level: 1 })
    ).toBeInTheDocument()
    expect(dlssLink).toHaveClass('text-primary')
  })

  it('redirects unknown paths to the library', async () => {
    renderWithProviders(<AppRoutes />, { route: '/does-not-exist' })
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Your collection' })).toBeInTheDocument()
    )
  })
})
