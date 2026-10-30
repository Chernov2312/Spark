import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    allowedHosts: true,
    hmr: {
      protocol: 'wss',
    },
    proxy: {
      '/api': {
        target: 'http://backend:8001',
        changeOrigin: true,
      },
      '^/[0-9a-f-]+/ws': {
        target: 'ws://backend:8001',
        ws: true,
        changeOrigin: true,
      }
    }
  },
})