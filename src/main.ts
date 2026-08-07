import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles.css'
import './styles.refined.css'
import 'katex/dist/katex.min.css'

createApp(App).use(createPinia()).use(router).mount('#app')
