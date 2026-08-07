<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { readClipboardPayload } from '@/lib/clipboard'
import { useWorkbenchStore } from '@/stores/workbench'

const router = useRouter(); const store = useWorkbenchStore(); const pasting = ref(false)
const recentJobs = computed(() => store.jobs.slice(0, 6))
const recentRecipes = computed(() => store.recipes.slice(0, 4))
const quickTools = [
  ['PDF 页面整理', '合并、拆分、旋转、提取', '/tools', 'PDF'],
  ['图片处理', '缩放、压缩、转格式', '/tools', 'IMG'],
  ['图片分享卡', '拼图、标题、水印、PNG 导出', '/visual', 'IMG'],
  ['代码分享图', '高亮、分页、PNG 导出', '/code-image', 'CODE']
]
async function paste() { pasting.value = true; const payload = await readClipboardPayload(); pasting.value = false; if (!payload) return; await store.addSource({ name: payload.name, kind: payload.kind, mime: payload.kind === 'image' ? 'image/png' : 'text/plain', size: (payload.content ?? payload.preview ?? '').length, content: payload.content, preview: payload.preview }); router.push('/library') }
function removeRecipe(id: string) { store.removeRecipe(id) }
</script>

<template>
  <div class="dashboard page-enter">
    <section class="control-hero"><div><p class="eyebrow">LOCAL-FIRST TOOLBOX</p><h2>少切换一点软件，<em>多完成一点事情。</em></h2><p>把临时文件处理、内容整理和表达输出放进同一个可靠工作台。</p><div class="hero-actions"><RouterLink class="new-task" to="/tools">开始处理文件 →</RouterLink><button class="secondary-action" :disabled="pasting" @click="paste">{{ pasting ? '读取中…' : '从剪贴板开始' }}</button></div></div><aside><span>READY</span><strong>{{ store.jobs.filter((job) => job.status === 'running').length }}</strong><small>正在执行的任务</small></aside></section>
    <section class="quick-section"><header><div><p class="eyebrow">FREQUENT TOOLS</p><h3>常用工具</h3></div><RouterLink to="/tools">查看全部 →</RouterLink></header><div class="quick-grid"><RouterLink v-for="tool in quickTools" :key="tool[0]" :to="tool[2]" class="quick-tool"><b>{{ tool[3] }}</b><div><h4>{{ tool[0] }}</h4><p>{{ tool[1] }}</p></div><i>→</i></RouterLink></div></section>
    <section class="recipe-section"><header><div><p class="eyebrow">TOOL RECIPES</p><h3>我的工具配方</h3></div><RouterLink to="/tools">新建配方 →</RouterLink></header><div v-if="recentRecipes.length" class="recipe-grid"><RouterLink v-for="recipe in recentRecipes" :key="recipe.id" :to="{ path: '/tools', query: { recipe: recipe.id } }" class="recipe-card"><span>{{ recipe.group.toUpperCase() }}</span><div><h4>{{ recipe.title }}</h4><p>{{ recipe.operation }} · {{ recipe.lastRunAt ? '已使用' : '等待首次使用' }}</p></div><button title="删除配方" @click.prevent="removeRecipe(recipe.id)">×</button></RouterLink></div><div v-else class="recipe-empty">把一组常用参数保存成配方，例如“证件照压缩”或“课程 PDF 拆页”；以后只需选择本次文件。</div></section>
    <section class="dashboard-columns"><article class="activity-panel"><header><div><p class="eyebrow">TASK HISTORY</p><h3>最近任务</h3></div><RouterLink to="/tools">新建任务</RouterLink></header><div v-if="recentJobs.length" class="task-list"><div v-for="job in recentJobs" :key="job.id" class="task-row"><b :class="job.status">{{ job.kind.toUpperCase() }}</b><div><h4>{{ job.label }}</h4><p>{{ job.outputNames?.join('、') || job.detail || new Date(job.createdAt).toLocaleString('zh-CN') }}</p></div><span :class="job.status">{{ job.status === 'succeeded' ? '已完成' : job.status === 'failed' ? '失败' : job.status === 'running' ? `${job.progress}%` : '等待中' }}</span></div></div><div v-else class="empty-state">还没有任务。选择一个工具，先处理第一份文件。</div></article>
      <aside class="inbox-panel"><p class="eyebrow">ARCHIVE</p><h3>需要长期留存？</h3><p>把截图、PDF、文本或代码收进归档库；学习工作区会自动保留来源。</p><RouterLink to="/library">打开收集与归档 →</RouterLink><div class="archive-count"><strong>{{ store.sources.length }}</strong><span>已归档文件</span></div></aside></section>
  </div>
</template>
