import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { applyStoredTheme } from '@/lib/theme'

// Order is load-bearing. Tokens and the reset come first; the legacy layers
// (still owning a handful of un-migrated controls) resolve their colours
// through those tokens; the reading surface comes after them because it is the
// last word on the document; UnoCSS utilities come last so migrated markup
// always wins.
import './styles/theme.css'
import './styles/shell.css'
import './styles.css'
import './styles.refined.css'
import './styles.rebuild.css'
import './styles.workspace.css'
import './styles.knitspace.css'
import './styles.polish.css'
import './styles/legacy-bridge.css'
import './styles/reading.css'
import 'katex/dist/katex.min.css'
import 'virtual:uno.css'

applyStoredTheme()

createApp(App).use(createPinia()).use(router).mount('#app')
