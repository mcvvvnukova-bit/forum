import {createRequire} from 'node:module'
import {defineConfig} from 'vitest/config'
import react from '@vitejs/plugin-react'
const require = createRequire(import.meta.url)
// Accepted component regression composition shares the same React/Primer context.
// apps/web now owns the single production dev bootstrap and shared session.
export default defineConfig({
  plugins: [react()],
  resolve: {dedupe: ['react', 'react-dom', '@primer/react', '@primer/octicons-react'], alias: [
    {find: /^react(?=\/|$)/, replacement: require.resolve('react/package.json').replace(/\/package.json$/, '')},
    {find: /^react-dom(?=\/|$)/, replacement: require.resolve('react-dom/package.json').replace(/\/package.json$/, '')},
  ]},
  ssr: {noExternal: [/@primer\/.*/]},
  test: {
    // Match the published homepage entry destination without contacting providers.
    env: {VITE_START_URL: '/login'},
    include: ['tests/integration/public-site-composition.test.tsx'],
    server: {deps: {inline: [/@primer\/.*/]}},
    environment: 'jsdom',
    environmentOptions: {jsdom: {url: 'http://localhost/'}},
    setupFiles: ['./tests/integration/setup.ts'],
  },
})
