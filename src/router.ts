import { createRouter, createWebHashHistory } from 'vue-router'
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: () => import('@/views/DashboardView.vue'), meta: { title: '操作台' } },
    { path: '/library', component: () => import('@/views/LibraryView.vue'), meta: { title: '收集与归档' } },
    { path: '/tools', component: () => import('@/views/BatchView.vue'), meta: { title: '文件处理中心' } },
    { path: '/history', component: () => import('@/views/HistoryView.vue'), meta: { title: '处理历史' } },
    { path: '/clipboard', component: () => import('@/views/ClipboardView.vue'), meta: { title: '剪贴板' } },
    { path: '/developer-tools', component: () => import('@/views/DeveloperToolsView.vue'), meta: { title: '开发者工具' } },
    { path: '/code-image', component: () => import('@/views/CodeImageView.vue'), meta: { title: '代码分享工作室' } },
    { path: '/visual', component: () => import('@/views/VisualStudioView.vue'), meta: { title: '图片表达工作室' } },
    { path: '/ai', component: () => import('@/views/AiStudioView.vue'), meta: { title: 'AI 内容工作台' } },
    { path: '/documents', component: () => import('@/views/DocumentsView.vue'), meta: { title: '学习工作区' } },
    { path: '/review', component: () => import('@/views/ReviewView.vue'), meta: { title: '学习复习' } },
    { path: '/lab', component: () => import('@/views/LabView.vue'), meta: { title: '实验室' } },
    { path: '/settings', component: () => import('@/views/SettingsView.vue'), meta: { title: '配置与备份' } }
  ]
})
