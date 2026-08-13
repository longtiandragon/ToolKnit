import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { applyStoredTheme } from '@/lib/theme'

// Order is load-bearing. Tokens and the reset come first; the legacy layers
// (still owning the not-yet-migrated views) resolve their colours through
// those tokens; UnoCSS utilities come last so migrated markup always wins.
import './styles/theme.css'
import './styles/shell.css'
import './styles.css'
import './styles.refined.css'
import './styles.rebuild.css'
import './styles.workspace.css'
import './styles.knitspace.css'
import './styles.polish.css'
import './styles/legacy-bridge.css'
import 'katex/dist/katex.min.css'
import 'virtual:uno.css'

applyStoredTheme()

createApp(App).use(createPinia()).use(router).mount('#app')
