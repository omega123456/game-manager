import { useRef } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ScrollContainerProvider } from '@/components/layout/scroll-container-context'
import { useScrollContainerRef } from '@/components/layout/use-scroll-container'

function Consumer(): React.JSX.Element {
  const ref = useScrollContainerRef()
  return <div data-testid="consumer">{ref ? 'has-ref' : 'no-ref'}</div>
}

describe('scroll-container-context', () => {
  it('exposes the provided scroll ref to descendants', () => {
    function Tree(): React.JSX.Element {
      const scrollRef = useRef<HTMLElement>(null)
      return (
        <ScrollContainerProvider scrollRef={scrollRef}>
          <Consumer />
        </ScrollContainerProvider>
      )
    }

    render(<Tree />)
    expect(screen.getByTestId('consumer')).toHaveTextContent('has-ref')
  })

  it('returns null when used outside a provider', () => {
    render(<Consumer />)
    expect(screen.getByTestId('consumer')).toHaveTextContent('no-ref')
  })
})
