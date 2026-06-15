import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RoutePlaceholder } from '@/routes/route-placeholder'

describe('RoutePlaceholder', () => {
  it('renders the title, description, and icon', () => {
    render(
      <RoutePlaceholder
        title="Script Manager"
        description="Manage launch scripts for your library."
        icon="terminal"
      />
    )

    expect(screen.getByRole('heading', { name: 'Script Manager' })).toBeInTheDocument()
    expect(screen.getByText('Manage launch scripts for your library.')).toBeInTheDocument()
  })
})
