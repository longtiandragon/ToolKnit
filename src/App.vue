<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useWorkbenchStore } from '@/stores/workbench'

const route = useRoute()
const store = useWorkbenchStore()
const commandOpen = ref(false)
const menu = [
  ['/', '织', '今日织网'], ['/library', '藏', '资料库'], ['/documents', '题', '错题与笔记'],
  ['/review', '复', '今日复习'], ['/code-image', '码', '长代码图'], ['/batch', '批', '文档批处理']
]
const title = computed(() => String(route.meta.title ?? 'ToolKnit'))
</script>

<template>
  <main class="app-shell">
    <aside class="rail" aria-label="主导航">
      <RouterLink to="/" class="brand" title="ToolKnit 首页">TK<span>·</span></RouterLink>
      <nav>
        <RouterLink v-for="item in menu" :key="item[0]" :to="item[0]" class="rail-link" :title="item[2]">
          <span>{{ item[1] }}</span>
        </RouterLink>
      </nav>
      <button class="rail-link command-button" title="快速命令" @click="commandOpen = true"><span>⌘</span></button>
      <RouterLink to="/settings" class="rail-link bottom" title="设置"><span>设</span></RouterLink>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ store.activeVaultName }}</p>
          <h1>{{ title }}</h1>
        </div>
        <div class="topbar-actions">
          <span class="sync-dot"><i></i> 本地优先</span>
          <RouterLink to="/review" class="due-chip">{{ store.dueDocuments.length }} 待复习</RouterLink>
        </div>
      </header>
      <RouterView />
    </section>

    <div v-if="commandOpen" class="modal-backdrop" @click.self="commandOpen = false">
      <section class="command-palette">
        <div class="command-header"><span>快速收集</span><button @click="commandOpen = false">Esc</button></div>
        <RouterLink to="/library" @click="commandOpen = false"><b>＋</b><span>导入资料到收集箱</span><kbd>I</kbd></RouterLink>
        <RouterLink to="/documents" @click="commandOpen = false"><b>题</b><span>新建一张错题卡</span><kbd>Q</kbd></RouterLink>
        <RouterLink to="/code-image" @click="commandOpen = false"><b>码</b><span>从代码生成长图</span><kbd>C</kbd></RouterLink>
      </section>
    </div>
  </main>
</template>
