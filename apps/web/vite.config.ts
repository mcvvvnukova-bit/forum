import {defineConfig} from 'vitest/config'
import react from '@vitejs/plugin-react'
import {immutableMedia} from './scripts/immutable-media'
import {resolve} from 'node:path'
export default defineConfig({
  root: import.meta.dirname,
  plugins: [immutableMedia(resolve(import.meta.dirname, 'public')), react()],
  publicDir: false,
  envDir: false,
  build: {assetsDir: 'web-assets', chunkSizeWarningLimit:1200},
  ssr: {noExternal: [/@primer\/.*/]},
  test: {server: {deps: {inline: [/@primer\/.*/]}}, environment:'jsdom', setupFiles:['./src/home/test-setup.ts']},
})
