import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: './review/setup.js', css: false, testTimeout: 120000, hookTimeout: 120000, include: ['review/**/*.test.jsx'] },
})
