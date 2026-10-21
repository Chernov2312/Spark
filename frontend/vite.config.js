import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true, // Позволяет Vite принимать запросы с любых хостов (включая Cloudflare)
    hmr: {
      // Так как трафик идет через Cloudflare HTTPS -> Nginx -> Vite,
      // для самого браузера HMR должен выглядеть как безопасный WebSocket.
      protocol: 'wss',
      // Мы НЕ указываем clientPort 443, чтобы порт наследовался от текущего URL в браузере,
      // либо оставляем пустые настройки хоста, чтобы Nginx сам прокинул сокет.
    },
  },
})
