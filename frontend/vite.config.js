import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    hmr: {
      protocol: 'wss',
    },
    proxy: {
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
      '^/[0-9a-f-]+/ws': {
        target: 'ws://backend:8000',
        ws: true,
        changeOrigin: true,
      }
    }
  },
})