import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { studioApiPlugin, studioPort } from './src/studio-server.js'

export default defineConfig({
  plugins: [react(), studioApiPlugin],
  publicDir: false,
  server: {
    port: studioPort(),
    strictPort: true
  },
  preview: {
    port: studioPort(),
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
