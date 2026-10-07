import {defineConfig} from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  ssr: {
    noExternal: [/@primer\/.*/],
  },
  test: {
    deps: {
      inline: [/@primer\/.*/],
    },
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    globals: true,
  },
})
