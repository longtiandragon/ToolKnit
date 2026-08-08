<script setup lang="ts">
defineProps<{
  codeHtml: string
  lineCount: number
  startLine: number
  title: string
  languageLabel: string
  pageNumber: number
  totalPages: number
  fontSize: number
  showLineNumbers: boolean
  watermark: string
  theme: 'midnight' | 'forest' | 'paper'
}>()
</script>

<template>
  <article class="codesnap-card" :class="`codesnap-${theme}`">
    <header class="codesnap-titlebar">
      <span class="mac-controls" aria-hidden="true"><i></i><i></i><i></i></span>
      <strong>{{ title || 'Untitled' }}</strong>
      <small>{{ languageLabel }}</small>
    </header>
    <div class="codesnap-codebody" :style="{ '--code-font-size': `${fontSize}px` }">
      <div v-if="showLineNumbers" class="codesnap-lines" aria-hidden="true">
        <span v-for="index in lineCount" :key="index">{{ startLine + index - 1 }}</span>
      </div>
      <pre><code v-html="codeHtml"></code></pre>
    </div>
    <footer>
      <span>{{ watermark || 'ToolKnit' }}</span>
      <small v-if="totalPages > 1">{{ pageNumber }} / {{ totalPages }}</small>
    </footer>
  </article>
</template>
