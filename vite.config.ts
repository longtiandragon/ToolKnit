import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  define: { __APP_VERSION__: JSON.stringify('0.1.0') },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vue-core': ['vue', 'vue-router', 'pinia'],
          'pdf-tools': ['pdf-lib', 'pdfjs-dist'],
          'content-rendering': ['markdown-it', 'highlight.js', 'katex'],
          'study-engine': ['ts-fsrs']
        }
      }
    }
  },
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' }
})
