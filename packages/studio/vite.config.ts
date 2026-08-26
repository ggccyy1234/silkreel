import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  publicDir: '../../fixtures',
  server: {
    port: 3101,
    strictPort: true
  }
})
