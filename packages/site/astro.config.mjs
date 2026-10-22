import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

export default defineConfig({
  site: 'https://silkreel.dev',
  integrations: [sitemap()],
  prefetch: { prefetchAll: true, defaultStrategy: 'viewport' },
  build: { inlineStylesheets: 'auto' },
  vite: {
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/@remotion/') || id.includes('/node_modules/remotion/')) return 'remotion'
            if (id.includes('/packages/render/') || id.includes('/packages/choreo/')) return 'reel'
            return undefined
          }
        }
      }
    }
  }
})
