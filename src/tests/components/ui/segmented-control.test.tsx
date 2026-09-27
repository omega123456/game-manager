import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { SegmentedControl } from '@/components/ui/segmented-control'

type Fruit = 'apple' | 'pear' | 'plum'

function Harness(): React.JSX.Element {
  const [value, setValue] = useState<Fruit>('apple')
  return (
    <SegmentedControl
      aria-label="Fruit"
      value={value}
      onValueChange={setValue}
      options={[
        { value: 'apple', label: 'Apple', count: 3 },
        { value: 'pear', label: 'Pear' },
        { value: 'plum', label: 'Plum', count: 0 },
      ]}
    />
  )
}

describe('SegmentedControl', () => {
  it('renders a radiogroup with counts and only the selected segment tabbable', () => {
    render(<Harness />)

    expect(screen.getByRole('radiogroup', { name: 'Fruit' })).toBeInTheDocument()
    const apple = screen.getByRole('radio', { name: 'Apple, 3' })
    expect(apple).toHaveAttribute('aria-checked', 'true')
    expect(apple).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'Pear' })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('radio', { name: 'Plum, 0' })).toBeInTheDocument()
  })

  it('selects on click', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('radio', { name: 'Pear' }))

    expect(screen.getByRole('radio', { name: 'Pear' })).toHaveAttribute('aria-checked', 'true')
  })

  it('moves the selection with arrow, Home and End keys and wraps around', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const checked = () =>
      screen.getAllByRole('radio').find((radio) => radio.getAttribute('aria-checked') === 'true')

    await user.click(screen.getByRole('radio', { name: 'Apple, 3' }))
    await user.keyboard('{ArrowRight}')
    expect(checked()).toHaveAccessibleName('Pear')
    expect(checked()).toHaveFocus()

    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(checked()).toHaveAccessibleName('Apple, 3')

    await user.keyboard('{ArrowLeft}')
    expect(checked()).toHaveAccessibleName('Plum, 0')

    await user.keyboard('{ArrowUp}')
    expect(checked()).toHaveAccessibleName('Pear')

    await user.keyboard('{Home}')
    expect(checked()).toHaveAccessibleName('Apple, 3')

    await user.keyboard('{End}')
    expect(checked()).toHaveAccessibleName('Plum, 0')

    await user.keyboard('{Enter}')
    expect(checked()).toHaveAccessibleName('Plum, 0')
  })
})
