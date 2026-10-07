import {defineConfig} from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: {assetsDir: 'audience-assets/bundles'},
  ssr: {noExternal: [/@primer\/.*/]},
  server: {host: '127.0.0.1', port: 5191, strictPort: true, proxy: {'/api/auth': 'https://dev.astforum.ru'}},
  preview: {host: '127.0.0.1', port: 5191, strictPort: true},
  test: {server: {deps: {inline: [/@primer\/.*/]}}, environment: 'jsdom', setupFiles: ['./src/test-setup.ts']},
})
