import {defineConfig} from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: {outDir: 'dist/site/auth', emptyOutDir: true, assetsDir: 'auth-assets', chunkSizeWarningLimit: 900},
  ssr: {noExternal: [/@primer\/.*/]},
  test: {server: {deps: {inline: [/@primer\/.*/]}}, environment: 'jsdom', setupFiles: './src/test-setup.ts', globals: true},
})
