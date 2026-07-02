// v0.11.18
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  server: {
    port: 5050,
    strictPort: true,
    proxy: {
      '/resource': {
        target: 'http://localhost:3050',
        changeOrigin: true,
      },
    },
  },
})


