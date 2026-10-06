import {defineConfig} from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  ssr: {noExternal: [/@primer\/.*/]},
  server: {host: '127.0.0.1', port: 5188, strictPort: true},
  preview: {host: '127.0.0.1', port: 5188, strictPort: true},
  test: {server: {deps: {inline: [/@primer\/.*/]}}, environment: 'jsdom', setupFiles: ['./src/test-setup.ts']},
})
