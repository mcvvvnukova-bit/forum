import {createRequire} from 'node:module'
import {defineConfig} from 'vitest/config'
import react from '@vitejs/plugin-react'
const require = createRequire(import.meta.url)
// Independently installed packages must share React and the provider context in
// this composition harness; production still builds each existing entrypoint.
export default defineConfig({
  plugins: [react()],
  resolve: {dedupe: ['react', 'react-dom', '@primer/react', '@primer/octicons-react'], alias: [
    {find: /^react(?=\/|$)/, replacement: require.resolve('react/package.json').replace(/\/package.json$/, '')},
    {find: /^react-dom(?=\/|$)/, replacement: require.resolve('react-dom/package.json').replace(/\/package.json$/, '')},
  ]},
  ssr: {noExternal: [/@primer\/.*/]},
  test: {
    // Match the real live-home registration destination without contacting providers.
    env: {VITE_START_URL: '/auth/sber-id/start?intent=register&subject=individual'},
    include: ['tests/integration/public-site-composition.test.tsx'],
    server: {deps: {inline: [/@primer\/.*/]}},
    environment: 'jsdom',
    environmentOptions: {jsdom: {url: 'http://localhost/'}},
    setupFiles: ['./tests/integration/setup.ts'],
  },
})
