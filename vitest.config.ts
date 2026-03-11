import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    setupFiles: ['src/renderer/src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/renderer/src/lib/**',
        'src/renderer/src/constants/**',
        'src/renderer/src/stores/**',
        'src/renderer/src/hooks/**'
      ]
    }
  }
})
