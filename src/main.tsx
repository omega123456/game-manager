import React from 'react'
import ReactDOM from 'react-dom/client'
import { mockIPC } from '@tauri-apps/api/mocks'

import './styles/global.css'
import App from './App'
import { playwrightIpcMockHandler } from './lib/playwright-ipc-mock'

async function init(): Promise<void> {
  // Install the Playwright IPC mock FIRST (before any invoke), so the plain web
  // build (VITE_PLAYWRIGHT=true) runs without a Tauri runtime for E2E.
  if (import.meta.env.VITE_PLAYWRIGHT === 'true') {
    mockIPC((cmd, args) => playwrightIpcMockHandler(cmd, args as Record<string, unknown>))
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void init()
