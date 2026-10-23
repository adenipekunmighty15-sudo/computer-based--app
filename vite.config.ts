import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // A full paper's worth of diagrams runs for many minutes, and http-proxy
      // applies this as a hard socket timeout on the request it forwards.
      // Left unset it inherits nothing useful and the dev server drops the
      // connection mid-draw, which the browser reports as a network failure
      // rather than as the slow answer it is. The API server's own per-route
      // budget is the deadline that matters.
      '/api': {
        target: 'http://localhost:5050',
        proxyTimeout: 0,
        timeout: 0,
      },
    },
  },
  test: {
    // Component tests render into a real document; node alone cannot do that.
    environment: 'jsdom',
    globals: true,
    // The default forks/threads pool times out booting workers on this checkout path (with spaces).
    pool: 'vmThreads',
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.mjs'],
  },
})
