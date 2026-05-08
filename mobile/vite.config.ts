import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Mobile PWA build. Outputs to mobile/dist/, served by RemoteServer.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../src/shared')
    }
  },
  server: {
    host: true,
    port: 5180,
    // Proxy /api/* and the /api/events WebSocket to the RemoteServer running
    // inside the Electron main process. In dev, that pins to port 4790 (see
    // src/main/index.ts). Override with CLAUDEX_REMOTE_URL to point elsewhere
    // (e.g. a tailnet host). Run `npm run dev` in one terminal and
    // `npm run mobile:dev` in another, then open http://localhost:5180/.
    proxy: {
      '/api': {
        target: process.env.CLAUDEX_REMOTE_URL || 'http://127.0.0.1:4790',
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020'
  }
})
