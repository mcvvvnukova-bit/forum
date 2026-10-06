import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: {
    outDir: 'dist/site/auth',
    emptyOutDir: true,
    assetsDir: 'auth-assets',
    chunkSizeWarningLimit: 900,
  },
})
