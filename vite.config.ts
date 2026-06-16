import { readFileSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// @tauri-apps/cli sets TAURI_DEV_HOST when running `pnpm tauri dev`.
const host = process.env.TAURI_DEV_HOST
const tauriConfig = JSON.parse(
  readFileSync(path.resolve(__dirname, 'src-tauri/tauri.conf.json'), 'utf8')
) as {
  version: string
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(tauriConfig.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 1420,
    strictPort: false,
    host: host || false,
    watch: {
      // Tauri compiles the Rust side; ignore it so Vite does not thrash.
      ignored: ['**/src-tauri/**'],
    },
  },
})
