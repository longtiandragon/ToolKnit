import { createRouter, createWebHashHistory } from 'vue-router'
import { appRoutes } from '@/routes'

export default createRouter({
  history: createWebHashHistory(),
  scrollBehavior(to) {
    if (to.hash) return { el: to.hash, top: 14 }
    return { top: 0 }
  },
  routes: appRoutes
})
