import {defineConfig} from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: {proxy: {'/api/auth': 'https://dev.astforum.ru'}},
  build: {assetsDir: 'public-auth-assets', manifest: true, chunkSizeWarningLimit: 1200},
  ssr: {noExternal: [/@primer\/.*/]},
  test: {server: {deps: {inline: [/@primer\/.*/]}}, environment: 'jsdom', setupFiles: ['./src/test-setup.ts']},
})
