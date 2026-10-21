import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    strictPort: true,
    allowedHosts: true,
  },
  hmr: {
      clientPort: 443,
      protocol: 'wss',
  },
})
