import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import App from '@/App'
import { useUpdateStore } from '@/stores/update-store'
import { ipc } from './ipc-mock'
import { resetUiStore } from './helpers/render-app'

describe('App', () => {
  beforeEach(() => {
    resetUiStore()
    useUpdateStore.setState({
      status: 'idle',
      availableVersion: null,
      downloadProgress: 0,
      errorMessage: null,
      hasCheckedOnStartup: false,
      updateObject: null,
    })
  })

  it('checks for updates once on startup', async () => {
    render(<App />)

    await waitFor(() => expect(ipc.calls('plugin:updater|check')).toHaveLength(1))
  })
})
