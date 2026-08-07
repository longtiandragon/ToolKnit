<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useWorkbenchStore } from '@/stores/workbench'

const route = useRoute()
const store = useWorkbenchStore()
const commandOpen = ref(false)
const nav = [
  ['/', '▦', '操作台'], ['/library', '↙', '收集与归档'], ['/tools', '◇', '文件处理中心'], ['/code-image', '</>', '代码分享'], ['/ai', '✦', 'AI 内容工作台'],
]
const learning = [['/documents', '笔', '学习工作区'], ['/review', '复', '复习队列']]
const title = computed(() => String(route.meta.title ?? 'ToolKnit'))
const runningJobs = computed(() => store.jobs.filter((job) => job.status === 'running' || job.status === 'queued'))
</script>

<template>
  <main class="app-shell">
    <aside class="rail" aria-label="主导航">
      <RouterLink to="/" class="brand" title="ToolKnit 操作台">TK</RouterLink>
      <p class="rail-label">工作台</p>
      <nav><RouterLink v-for="item in nav" :key="item[0]" :to="item[0]" class="rail-link" :title="item[2]"><b>{{ item[1] }}</b><span>{{ item[2] }}</span></RouterLink></nav>
      <p class="rail-label">学习</p>
      <nav><RouterLink v-for="item in learning" :key="item[0]" :to="item[0]" class="rail-link" :title="item[2]"><b>{{ item[1] }}</b><span>{{ item[2] }}</span></RouterLink></nav>
      <div class="rail-bottom"><RouterLink to="/lab" class="rail-link"><b>⌁</b><span>实验室</span></RouterLink><RouterLink to="/settings" class="rail-link"><b>⚙</b><span>设置</span></RouterLink></div>
    </aside>
    <section class="workspace">
      <header class="topbar"><div><p class="eyebrow">{{ store.activeVaultName }} · WINDOWS DESKTOP</p><h1>{{ title }}</h1></div><div class="topbar-actions"><button class="command-trigger" @click="commandOpen = true"><kbd>⌘ K</kbd> 快速操作</button><RouterLink to="/tools" class="new-task">＋ 新建任务</RouterLink></div></header>
      <RouterView />
    </section>
    <div v-if="commandOpen" class="modal-backdrop" @click.self="commandOpen = false"><section class="command-palette"><header><span>快速操作</span><button @click="commandOpen = false">Esc</button></header><RouterLink to="/tools" @click="commandOpen = false"><b>◇</b><span>打开文件处理中心</span><kbd>F</kbd></RouterLink><RouterLink to="/library" @click="commandOpen = false"><b>↙</b><span>收集或归档资料</span><kbd>I</kbd></RouterLink><RouterLink to="/code-image" @click="commandOpen = false"><b>&lt;/&gt;</b><span>生成代码分享图</span><kbd>C</kbd></RouterLink><p v-if="runningJobs.length" class="command-jobs">{{ runningJobs.length }} 个任务正在执行</p></section></div>
  </main>
</template>
