import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'

export default defineConfig(({ mode }) => {
  const personalPack = mode !== 'public'
  return {
  plugins: [
    UnoCSS(),
    vue(),
    {
      name: 'knitspace-build-profile',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'build-profile.json',
          source: `${JSON.stringify({ profile: personalPack ? 'personal' : 'public', personalPack }, null, 2)}\n`,
        })
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify('0.1.0'),
    __PERSONAL_PACK__: JSON.stringify(personalPack),
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vue-core': ['vue', 'vue-router', 'pinia'],
          // Viewing PDFs and authoring PDFs are used by different pages. Keep
          // them separate so a code-image PNG workflow never pays for PDF.js.
          'pdf-authoring': ['pdf-lib'],
          'pdf-viewer': ['pdfjs-dist'],
          'content-rendering': ['markdown-it', 'highlight.js', 'katex'],
          'study-engine': ['ts-fsrs']
        }
      }
    }
  },
  clearScreen: false,
  server: { port: 1421, strictPort: true, host: '127.0.0.1' }
  }
})
