import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// @tauri-apps/cli sets TAURI_DEV_HOST when running `pnpm tauri dev`.
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
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
