import {resolve} from 'node:path'
import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), {
    name: 'landing-root-entry',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        if (url.pathname === '/') request.url = `/landing.html${url.search}`
        next()
      })
    },
  }],
  server: {
    proxy: {
      '/auth/sber-id': {target: process.env.FORUM_API_ORIGIN ?? 'http://127.0.0.1:3001'},
      '^/authorization(?:\\?|$)': {target: process.env.FORUM_API_ORIGIN ?? 'http://127.0.0.1:3001'},
      '/api/auth': {target: process.env.FORUM_API_ORIGIN ?? 'http://127.0.0.1:3001'},
    },
  },
  build: {
    outDir: 'dist/site/landing',
    emptyOutDir: true,
    assetsDir: 'landing-assets',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'landing.html'),
        customers: resolve(import.meta.dirname, 'customers/index.html'),
      },
    },
  },
})
