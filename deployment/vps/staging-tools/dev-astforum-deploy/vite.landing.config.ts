import {resolve} from 'node:path'
import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/site/landing',
    emptyOutDir: true,
    assetsDir: 'landing-assets',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'landing.html'),
    },
  },
})
