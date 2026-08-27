import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  publicDir: '../../fixtures',
  server: {
    port: 3101,
    strictPort: true
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@remotion/') || id.includes('/node_modules/remotion/')) return 'remotion'
          if (id.includes('/node_modules/react')) return 'react'
          return undefined
        }
      }
    }
  }
})
