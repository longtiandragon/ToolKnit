<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { extractWebArticleAsync } from '@/lib/article-extract-worker'
import type { WebArticleExtraction } from '@/lib/html-to-markdown'
import { useUiStore } from '@/stores/ui'
import { useWorkbenchStore } from '@/stores/workbench'

const props = defineProps<{ html: string }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const router = useRouter()
const ui = useUiStore()
const store = useWorkbenchStore()
const result = ref<WebArticleExtraction>()
const title = ref('')
const markdown = ref('')
const sourceUrl = ref('')
const busy = ref(false)
const error = ref('')
let extractionVersion = 0

const confidenceLabel = computed(() => result.value?.confidence === 'high' ? '高置信度正文' : result.value?.confidence === 'medium' ? '正文候选' : '低置信度回退')
const confidenceTone = computed(() => result.value?.confidence === 'high' ? 'text-success bg-success-soft' : result.value?.confidence === 'medium' ? 'text-accent bg-accent-soft' : 'text-warn bg-warn-soft')
const validSourceUrl = computed(() => {
  if (!sourceUrl.value.trim()) return ''
  try {
    const url = new URL(sourceUrl.value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
  } catch { return '' }
})
const canSave = computed(() => Boolean(title.value.trim() && markdown.value.trim()) && !busy.value)

watch(() => props.html, async (html, _previous, onCleanup) => {
  const version = ++extractionVersion
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  busy.value = true
  error.value = ''
  result.value = undefined
  try {
    const extracted = await extractWebArticleAsync(html, controller.signal)
    if (version !== extractionVersion) return
    result.value = extracted
    title.value = extracted.title
    markdown.value = extracted.markdown
  } catch (cause) {
    if (version === extractionVersion && !controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '网页正文提取失败。'
  } finally {
    if (version === extractionVersion) busy.value = false
  }
}, { immediate: true })

async function copyMarkdown() {
  if (!markdown.value.trim()) return
  try {
    await navigator.clipboard.writeText(markdown.value)
    ui.toast('已复制 Markdown', `${markdown.value.length.toLocaleString('zh-CN')} 个字符`, 'success')
  } catch {
    ui.toast('复制失败', '系统剪贴板暂不可用。', 'error')
  }
}

function noteContent() {
  const metadata = [
    validSourceUrl.value ? `> 来源：[${validSourceUrl.value}](${validSourceUrl.value.replace(/[()]/g, '\\$&')})` : '',
    result.value?.siteName ? `> 站点：${result.value.siteName}` : '',
    result.value?.byline ? `> 作者：${result.value.byline}` : '',
    result.value?.publishedAt ? `> 发布：${result.value.publishedAt}` : '',
  ].filter(Boolean).join('\n')
  const body = markdown.value.trim()
  const hasOwnTitle = /^#\s+/m.test(body.slice(0, 300))
  return `${hasOwnTitle ? '' : `# ${title.value.trim()}\n\n`}${metadata}${metadata ? '\n\n' : ''}${body}\n`
}

async function saveAsNote() {
  if (!canSave.value) return
  const note = store.createNote(title.value.trim().slice(0, 100), '网页摘录', noteContent())
  store.saveDocument({ ...note, subject: '网页资料', tags: ['网页摘录', '待整理'] })
  store.addActivity('source', '从网页源码提取正文', note.title, '/documents', note.id)
  emit('saved')
  await router.push({ path: '/documents', query: { kind: 'note', document: note.id, mode: 'split' } })
  ui.toast('已存为 Markdown 笔记', '网页源码未写入 Vault，只保存了你确认的正文。', 'success')
}
</script>

<template>
  <section class="pane mt-4" aria-labelledby="article-extract-title">
    <header class="pane-head gap-3 flex-wrap">
      <span class="stack gap-0.5 min-w-0">
        <strong id="article-extract-title" class="pane-title">网页正文预览</strong>
        <small class="text-[11px] text-fg-3">纯本地分析，不请求网页、不执行脚本；确认后再存笔记。</small>
      </span>
      <button class="btn-ghost btn-sm" :disabled="busy" @click="emit('close')"><AppIcon name="close" :size="13" />关闭预览</button>
    </header>

    <div v-if="busy" class="min-h-56 center stack gap-2 text-fg-3" aria-live="polite">
      <AppIcon name="refresh" :size="22" class="animate-spin" />
      <p class="text-[12px]">正在 Worker 中识别正文与模板噪声…</p>
    </div>
    <div v-else-if="error" class="m-4 p-4 rounded-md bg-danger-soft text-danger" role="alert">{{ error }}</div>
    <div v-else-if="result" class="grid grid-cols-1 xl:grid-cols-[minmax(0,0.38fr)_minmax(0,0.62fr)] gap-4 p-4">
      <aside class="stack gap-3 min-w-0">
        <label class="stack gap-1 text-[12px] text-fg-2">笔记标题<input v-model="title" class="field w-full" maxlength="100" /></label>
        <label class="stack gap-1 text-[12px] text-fg-2">原网页地址（可选，不会联网）<input v-model="sourceUrl" class="field w-full" inputmode="url" placeholder="https://example.com/article" /></label>
        <p v-if="sourceUrl.trim() && !validSourceUrl" class="text-[11px] text-warn" role="alert">只接受 HTTP 或 HTTPS 地址；无效地址不会写入笔记。</p>
        <div class="row gap-2 flex-wrap">
          <span class="px-2 py-1 rounded-full text-[11px]" :class="confidenceTone">{{ confidenceLabel }}</span>
          <span class="chip">移除 {{ result.removedBlocks }} 个模板块</span>
          <span class="chip">{{ result.sourceCharacters.toLocaleString('zh-CN') }} 源字符</span>
        </div>
        <p v-if="result.confidence === 'low'" class="p-2.5 rounded-sm bg-warn-soft text-[11px] leading-relaxed text-warn">没有找到明确的正文容器，当前结果来自清理后的整页内容。保存前请重点检查开头和结尾。</p>
        <p v-if="result.truncated" class="p-2.5 rounded-sm bg-warn-soft text-[11px] leading-relaxed text-warn">源码、节点或输出触及安全上限，结果已截断；请缩小输入后重试或人工补全。</p>
        <dl v-if="result.siteName || result.byline || result.publishedAt" class="stack gap-1.5 p-3 rounded-sm bg-surface-2 text-[11px]">
          <div v-if="result.siteName" class="row-between gap-3"><dt class="text-fg-3">站点</dt><dd class="truncate">{{ result.siteName }}</dd></div>
          <div v-if="result.byline" class="row-between gap-3"><dt class="text-fg-3">作者</dt><dd class="truncate">{{ result.byline }}</dd></div>
          <div v-if="result.publishedAt" class="row-between gap-3"><dt class="text-fg-3">发布</dt><dd class="truncate">{{ result.publishedAt }}</dd></div>
        </dl>
        <div class="row gap-2 flex-wrap">
          <button class="btn-primary btn-sm" :disabled="!canSave" @click="saveAsNote"><AppIcon name="book" :size="14" />存为笔记</button>
          <button class="btn-default btn-sm" :disabled="!markdown.trim()" @click="copyMarkdown"><AppIcon name="copy" :size="14" />复制 Markdown</button>
        </div>
      </aside>
      <label class="stack gap-1 min-w-0 text-[12px] text-fg-2">提取结果（可直接修订）
        <textarea v-model="markdown" class="w-full min-h-96 p-3 rounded-md bg-well border border-line font-mono text-[12px] leading-relaxed resize-y focus:outline-none focus:border-accent" aria-label="提取后的 Markdown" />
        <span class="text-[11px] text-fg-3 text-right">{{ markdown.length.toLocaleString('zh-CN') }} 个字符</span>
      </label>
    </div>
  </section>
</template>
