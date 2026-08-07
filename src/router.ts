import { createRouter, createWebHashHistory } from 'vue-router'
import DashboardView from '@/views/DashboardView.vue'
import LibraryView from '@/views/LibraryView.vue'
import DocumentsView from '@/views/DocumentsView.vue'
import ReviewView from '@/views/ReviewView.vue'
import CodeImageView from '@/views/CodeImageView.vue'
import BatchView from '@/views/BatchView.vue'
import SettingsView from '@/views/SettingsView.vue'
import LabView from '@/views/LabView.vue'
import AiStudioView from '@/views/AiStudioView.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: DashboardView, meta: { title: '操作台' } },
    { path: '/library', component: LibraryView, meta: { title: '收集与归档' } },
    { path: '/tools', component: BatchView, meta: { title: '文件处理中心' } },
    { path: '/code-image', component: CodeImageView, meta: { title: '代码分享工作室' } },
    { path: '/ai', component: AiStudioView, meta: { title: 'AI 内容工作台' } },
    { path: '/documents', component: DocumentsView, meta: { title: '学习工作区' } },
    { path: '/review', component: ReviewView, meta: { title: '学习复习' } },
    { path: '/lab', component: LabView, meta: { title: '实验室' } },
    { path: '/settings', component: SettingsView, meta: { title: '设置' } }
  ]
})
