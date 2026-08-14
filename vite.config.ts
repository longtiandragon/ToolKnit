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
    // Rollup warns at 500 kB. Two chunks are above it and neither can be made
    // smaller from here, because both are Mermaid's own code: `mermaid.core`,
    // and the Langium parser that eleven of its diagram types share. That
    // second one is reported under the name `cynefin-*` — Rollup names a
    // shared chunk after whichever module reached it first, and it is not a
    // 670 kB cynefin diagram. (Naming it properly needs the function form of
    // `manualChunks`; the object form below cannot address a transitive
    // dependency, and rewriting the whole map to reach one label is a worse
    // trade than this comment.)
    //
    // Both are dynamic imports reached only when a document actually contains
    // a diagram, so neither is on the startup path — that path is what
    // `scripts/check-startup-budget.mjs` measures, and it is an order of
    // magnitude smaller. The limit is raised to just above the larger of the
    // two rather than switched off, so a *new* oversized chunk still gets
    // reported.
    chunkSizeWarningLimit: 700,
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
