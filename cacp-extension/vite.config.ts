import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import { resolve } from 'path'
import manifest from './manifest.json' with { type: 'json' }

const srcDir = resolve(import.meta.dirname, 'src')

export default defineConfig({
  resolve: {
    alias: {
      '@': srcDir,
      '@components': resolve(srcDir, 'components'),
      '@hooks': resolve(srcDir, 'hooks'),
      '@managers': resolve(srcDir, 'managers'),
      '@sites': resolve(srcDir, 'sites'),
      'cacp-ui': resolve(import.meta.dirname, '../cacp-ui'),
    },
  },
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5150,
    strictPort: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
  plugins: [react(), crx({ manifest })],
})
