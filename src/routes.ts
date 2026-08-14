import type { RouteRecordRaw } from 'vue-router'
import { personalPackEnabled } from '@/lib/build-profile'

/** Route metadata is kept browser-independent so navigation coverage can be
 * verified in Node without constructing a hash history. */
export const appRoutes: RouteRecordRaw[] = [
  { path: '/', name: 'toolbox', component: () => import('@/views/ToolboxView.vue'), meta: { title: '工具箱' } },
  { path: '/c/:category', name: 'toolbox-category', component: () => import('@/views/ToolboxView.vue'), meta: { title: '工具箱' } },
  { path: '/today', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: '今天' } },
  { path: '/quick', name: 'quick-intake', component: () => import('@/views/QuickIntakeView.vue'), meta: { title: '快速处理' } },
  { path: '/knowledge', name: 'knowledge', component: () => import('@/views/KnowledgeSpaceView.vue'), meta: { title: '知识空间' } },
  { path: '/relations', name: 'knowledge-relations', component: () => import('@/views/KnowledgeRelationsView.vue'), meta: { title: '知识关系图谱' } },
  { path: '/library', name: 'library', component: () => import('@/views/LibraryView.vue'), meta: { title: '收集与归档' } },
  { path: '/tools', name: 'tools', component: () => import('@/views/BatchView.vue'), // The top bar says where you are; the page heading says what you are about
// to do. Titling the route with the operation as well left both lines
// claiming to be the same thing.
meta: { title: '文件工具' } },
  { path: '/tool-space', name: 'tool-space', component: () => import('@/views/ToolsSpaceView.vue'), meta: { title: '工具空间' } },
  { path: '/media', name: 'media', component: () => import('@/views/MediaDeskView.vue'), meta: { title: '媒体转换台' } },
  { path: '/subtitles', name: 'subtitles', component: () => import('@/views/SubtitleView.vue'), meta: { title: '字幕校对台' } },
  { path: '/ocr', name: 'ocr', component: () => import('@/views/OcrView.vue'), meta: { title: '离线文字识别' } },
  ...(personalPackEnabled ? [{ path: '/private-tools', name: 'private-tools', component: () => import('@/views/PrivateToolsView.vue'), meta: { title: '私人工具包' } }] : []),
  { path: '/history', name: 'history', component: () => import('@/views/HistoryView.vue'), meta: { title: '处理历史' } },
  { path: '/clipboard', name: 'clipboard', component: () => import('@/views/ClipboardView.vue'), meta: { title: '剪贴板' } },
  { path: '/developer-tools', name: 'developer-tools', component: () => import('@/views/DeveloperToolsView.vue'), meta: { title: '开发者工具' } },
  { path: '/code-image', name: 'code-image', component: () => import('@/views/CodeImageView.vue'), meta: { title: '代码分享工作室' } },
  { path: '/visual', name: 'visual', component: () => import('@/views/VisualStudioView.vue'), meta: { title: '视觉画布工作室' } },
  { path: '/create', name: 'create', component: () => import('@/views/CreateView.vue'), meta: { title: '创作空间' } },
  { path: '/ai', name: 'ai', component: () => import('@/views/AiStudioView.vue'), meta: { title: 'AI 内容工作台' } },
  { path: '/documents', name: 'documents', component: () => import('@/views/DocumentsView.vue'), meta: { title: '学习工作区' } },
  { path: '/words', name: 'words', component: () => import('@/views/VocabularyView.vue'), meta: { title: '单词库' } },
  { path: '/review', name: 'review', component: () => import('@/views/ReviewView.vue'), meta: { title: '学习复习' } },
  { path: '/lab', name: 'lab', component: () => import('@/views/LabView.vue'), meta: { title: '本机能力与实验' } },
  { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { title: '设置' } },
]
