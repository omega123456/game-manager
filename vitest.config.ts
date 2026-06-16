import { readFileSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const tauriConfig = JSON.parse(
  readFileSync(path.resolve(__dirname, 'src-tauri/tauri.conf.json'), 'utf8')
) as {
  version: string
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(tauriConfig.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/tests/setup.ts'],
    globals: true,
    include: ['src/tests/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'html', 'lcov'],
      include: ['src/**'],
      exclude: [
        'src/main.tsx',
        'src/tests/**',
        'src/types/**',
        'src/styles/**',
        'src/vite-env.d.ts',
        'src/**/*.css',
        'src/lib/playwright-ipc-mock.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
})
