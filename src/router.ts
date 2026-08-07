import { createRouter, createWebHashHistory } from 'vue-router'
import DashboardView from '@/views/DashboardView.vue'
import LibraryView from '@/views/LibraryView.vue'
import DocumentsView from '@/views/DocumentsView.vue'
import ReviewView from '@/views/ReviewView.vue'
import CodeImageView from '@/views/CodeImageView.vue'
import BatchView from '@/views/BatchView.vue'
import SettingsView from '@/views/SettingsView.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: DashboardView, meta: { title: '今日织网' } },
    { path: '/library', component: LibraryView, meta: { title: '资料库' } },
    { path: '/documents', component: DocumentsView, meta: { title: '错题与笔记' } },
    { path: '/review', component: ReviewView, meta: { title: '今日复习' } },
    { path: '/code-image', component: CodeImageView, meta: { title: '长代码图' } },
    { path: '/batch', component: BatchView, meta: { title: '文档批处理' } },
    { path: '/settings', component: SettingsView, meta: { title: '设置' } }
  ]
})
