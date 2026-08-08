<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import { desktopFileExists, isDesktop, revealDesktopFile, saveOutputAs } from '@/lib/native'
import AppBreadcrumbs from '@/components/AppBreadcrumbs.vue'
import EmptyState from '@/components/EmptyState.vue'
const store = useWorkbenchStore(); const ui = useUiStore(); const router = useRouter()
const query = ref(''); const status = ref('all'); const kind = ref('all')
const jobs = computed(() => store.jobs.filter((job) => (status.value === 'all' || job.status === status.value) && (kind.value === 'all' || job.kind === kind.value) && `${job.label} ${job.inputNames?.join(' ')} ${job.outputNames?.join(' ')}`.toLowerCase().includes(query.value.toLowerCase())))
const statusLabel = (value: string) => ({ succeeded: '已完成', failed: '失败', running: '执行中', queued: '等待中', cancelled: '已取消' }[value] ?? value)
const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
async function rerun(id: string) {
  const job = store.jobs.find((item) => item.id === id); if (!job) return
  const paths = job.inputs?.map((item) => item.path).filter(Boolean) as string[]
  if (paths.length && isDesktop()) { const exists = await Promise.all(paths.map(desktopFileExists)); if (exists.some((value) => !value)) { ui.toast('无法重新执行', '部分输入文件已移动，请重新选择文件。', 'warning'); return } }
  router.push({ path: job.route || '/tools', query: { replay: id } })
}
async function reveal(path?: string) { if (!path) return; try { await revealDesktopFile(path) } catch (error) { ui.toast('无法打开文件位置', error instanceof Error ? error.message : '文件可能已移动。', 'error') } }
async function remove(id: string) { if (await ui.confirm({ title: '删除历史记录？', message: '只删除 ToolKnit 中的记录，不会删除输入或输出文件。', danger: true, confirmLabel: '删除记录' })) store.removeJob(id) }
async function copy(path?: string) { if (!path) return; await navigator.clipboard.writeText(path); ui.toast('路径已复制', path, 'success') }
async function saveAs(path?:string,name?:string){if(!path||!name)return;try{const destination=await saveOutputAs(path,name);if(destination)ui.toast('已另存输出',destination,'success')}catch(error){ui.toast('另存失败',error instanceof Error?error.message:'无法复制输出文件。','error')}}
</script>
<template><div class="history-view page-enter">
  <AppBreadcrumbs :items="[{label:'工作',to:'/'},{label:'处理历史'}]" />
  <section class="page-heading history-heading"><div><p class="eyebrow">PROCESS LEDGER</p><h2>每一次处理，<em>都有迹可循。</em></h2><p>参数、输入和真实输出路径保存在本机，随时继续上次操作。</p></div><RouterLink class="new-task" to="/tools">＋ 新建处理</RouterLink></section>
  <section class="history-toolbar panel"><input v-model="query" class="search-input" placeholder="搜索工具、输入或输出文件…"/><select v-model="status"><option value="all">全部状态</option><option value="succeeded">已完成</option><option value="failed">失败</option><option value="running">执行中</option></select><select v-model="kind"><option value="all">全部类型</option><option value="pdf">PDF</option><option value="image">图片</option><option value="text">文本</option><option value="code">代码</option><option value="ai">AI</option></select><span>{{ jobs.length }} 条记录</span></section>
  <section v-if="jobs.length" class="history-list">
    <article v-for="job in jobs" :key="job.id" class="history-card panel"><div class="history-status" :class="job.status"><i></i><span>{{ statusLabel(job.status) }}</span><small>{{ formatTime(job.completedAt || job.createdAt) }}</small></div><div class="history-content"><p class="eyebrow">{{ job.kind.toUpperCase() }} · {{ job.toolId || 'LOCAL TOOL' }}</p><h3>{{ job.label }}</h3><div class="file-flow"><span><b>输入</b>{{ job.inputs?.map(i=>i.name).join('、') || job.inputNames?.join('、') || '未记录' }}</span><i>→</i><span><b>输出</b>{{ job.outputs?.map(i=>i.name).join('、') || job.outputNames?.join('、') || job.detail || '等待生成' }}</span></div></div><div class="history-actions"><button class="quiet-button" :disabled="!job.retryable && !job.route" @click="rerun(job.id)">重新执行</button><button class="quiet-button" :disabled="!job.outputs?.[0]?.path" @click="reveal(job.outputs?.[0]?.path)">打开位置</button><button class="quiet-button" :disabled="!job.outputs?.[0]?.path" @click="saveAs(job.outputs?.[0]?.path,job.outputs?.[0]?.name)">另存为</button><button class="icon-button" :disabled="!job.outputs?.[0]?.path" title="复制输出路径" @click="copy(job.outputs?.[0]?.path)">⌘</button><button class="icon-button danger" title="删除记录" @click="remove(job.id)">×</button></div></article>
  </section><EmptyState v-else icon="clock" title="还没有匹配的处理记录" description="拖入一份 PDF、图片或文本，完成后的参数与输出会出现在这里。" action="开始第一次处理" @action="router.push('/tools')" />
  <details class="activity-log panel"><summary><span><b>操作日志</b><small>最近 {{ Math.min(store.activities.length,30) }} 条本地活动</small></span><i>展开</i></summary><div v-if="store.activities.length"><article v-for="item in store.activities.slice(0,30)" :key="item.id"><b>{{item.kind.toUpperCase()}}</b><span><strong>{{item.title}}</strong><small>{{item.detail||'ToolKnit 本地操作'}}</small></span><time>{{formatTime(item.createdAt)}}</time></article></div><p v-else>操作日志将在使用工具后生成。</p></details>
</div></template>
