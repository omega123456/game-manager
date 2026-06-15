import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from '../App'

describe('App', () => {
  it('renders the app root shell', () => {
    render(<App />)
    expect(screen.getByTestId('app-root')).toBeInTheDocument()
    expect(screen.getByText('Game Manager')).toBeInTheDocument()
  })
})
