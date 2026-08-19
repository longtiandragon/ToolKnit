import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { applyStoredTheme } from '@/lib/theme'
import { installCrashReporting } from '@/lib/crash-report'

// Order is load-bearing. Tokens and the frame come first; the legacy layers
// (still owning a handful of un-migrated controls, but speaking the design
// tokens directly now that the alias bridge is gone) come next; the reading
// surface after them, because it is the last word on the document; UnoCSS
// utilities last, so migrated markup always wins.
import './styles/theme.css'
import './styles/shell.css'
import './styles.css'
import './styles.refined.css'
import './styles.rebuild.css'
import './styles.workspace.css'
import './styles.knitspace.css'
import './styles.polish.css'
import './styles/reading.css'
import 'katex/dist/katex.min.css'
import 'virtual:uno.css'

// Before the app mounts, so a failure during setup is still recorded.
installCrashReporting()
applyStoredTheme()

createApp(App).use(createPinia()).use(router).mount('#app')
