<script setup lang="ts">
const props = withDefaults(defineProps<{
  codeText?: string
  codeHtml: string
  lineCount: number
  startLine: number
  pageNumber: number
  totalPages: number
  fontSize: number
  showLineNumbers: boolean
  watermark: string
  theme: 'midnight' | 'forest' | 'paper'
  wrapLongLines?: boolean
  cardWidth?: number
  continuousPosition?: 'single' | 'start' | 'middle' | 'end'
}>(), { codeText: '', cardWidth: 720, continuousPosition: 'single' })

function copyExactCode(event: ClipboardEvent) {
  if (!event.clipboardData || !props.codeText) return
  event.preventDefault()
  event.clipboardData.setData('text/plain', props.codeText)
}
</script>

<template>
  <article class="codesnap-card" :class="[`codesnap-${theme}`, `codesnap-continuous-${continuousPosition}`, { 'codesnap-wrap-lines': wrapLongLines }]" :style="{ '--snap-card-width': `${cardWidth}px` }" @copy="copyExactCode">
    <header v-if="continuousPosition === 'single' || continuousPosition === 'start'" class="codesnap-titlebar">
      <span class="mac-controls" aria-hidden="true"><i></i><i></i><i></i></span>
    </header>
    <div class="codesnap-codebody" :style="{ '--code-font-size': `${fontSize}px` }">
      <div v-if="showLineNumbers" class="codesnap-lines" aria-hidden="true">
        <span v-for="index in lineCount" :key="index">{{ startLine + index - 1 }}</span>
      </div>
      <pre><code v-html="codeHtml"></code></pre>
    </div>
    <footer v-if="continuousPosition === 'single' || continuousPosition === 'end'">
      <span>{{ watermark }}</span>
      <small v-if="totalPages > 1">{{ pageNumber }} / {{ totalPages }}</small>
    </footer>
  </article>
</template>
