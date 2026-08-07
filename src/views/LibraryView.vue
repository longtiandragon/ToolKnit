<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import TagPill from '@/components/TagPill.vue'
import { blobToDataUrl, readClipboardPayload } from '@/lib/clipboard'
import { toolActions } from '@/lib/tools'
import type { Source, SourceKind } from '@/types'
import { useWorkbenchStore } from '@/stores/workbench'

const store = useWorkbenchStore()
const router = useRouter()
const fileInput = ref<HTMLInputElement>()
const dragging = ref(false)
const selected = ref<Source | null>(null)
const filter = ref<'all' | SourceKind>('all')
const notice = ref('')
const filtered = computed(() => filter.value === 'all' ? store.sources : store.sources.filter((source) => source.kind === filter.value))

function kindOf(file: File): SourceKind {
  if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) return 'pdf'
  if (file.type.startsWith('image/')) return 'image'
  if (/\.(c|cc|cpp|h|hpp|py|java|js|ts|rs|go|vue|md)$/i.test(file.name)) return 'code'
  return 'text'
}

async function ingest(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    const kind = kindOf(file)
    const preview = kind === 'image' ? await blobToDataUrl(file) : undefined
    const content = kind === 'image' || kind === 'pdf' ? undefined : await file.text()
    const { source, duplicate } = await store.addSource({ name: file.name, kind, mime: file.type || 'application/octet-stream', size: file.size, preview, content, pageCount: kind === 'pdf' ? undefined : 1 })
    selected.value = source
    notice.value = duplicate ? `“${file.name}” 已在资料库中，已跳到原件。` : `已收进资料库：${file.name}`
  }
}

async function onFiles(event: Event) { const files = (event.target as HTMLInputElement).files; if (files) await ingest(files) }
async function paste() {
  const payload = await readClipboardPayload(); if (!payload) { notice.value = '浏览器没有授予剪贴板权限，试试拖入文件。'; return }
  const { source } = await store.addSource({ name: payload.name, kind: payload.kind, mime: payload.kind === 'image' ? 'image/png' : 'text/plain', size: (payload.content ?? payload.preview ?? '').length, content: payload.content, preview: payload.preview })
  selected.value = source; notice.value = '已从剪贴板收集。'
}
function action(source: Source, id: string) {
  if (id === 'create-question') { store.createQuestion(source, { sourceId: source.id, pageIndex: 0, bbox: [0, 0, 1, 1] }); router.push('/documents') }
  else if (id === 'code-image') { router.push('/code-image') }
  else if (id === 'batch') { router.push('/batch') }
  else { notice.value = `${id === 'ocr' ? '文字 OCR' : '公式 OCR'} 引擎未安装。请在设置中安装可选离线引擎包。` }
}
</script>

<template>
  <div class="library page-enter">
    <section class="section-heading"><div><p class="eyebrow">SOURCE LIBRARY</p><h2>把原始材料留在身边。</h2><p>导入后会复制进资料库；原文件移动、改名都不会断开错题来源。</p></div><button class="primary-button" @click="fileInput?.click()">导入文件 <span>＋</span></button><input ref="fileInput" class="visually-hidden" type="file" multiple accept="image/*,.pdf,.md,.txt,.cpp,.c,.py,.java,.js,.ts,.rs,.go,.vue" @change="onFiles" /></section>
    <p v-if="notice" class="notice">{{ notice }}</p>
    <section class="inbox-zone" :class="{ dragging }" @dragenter.prevent="dragging = true" @dragover.prevent @dragleave.prevent="dragging = false" @drop.prevent="dragging = false; ingest($event.dataTransfer?.files ?? [])">
      <div class="inbox-mark">↙</div><h3>拖进来，或者从剪贴板捞一把。</h3><p>图片 · PDF · 文本 · 源代码。ToolKnit 会先放进收集箱，再让你决定它去哪。</p><button class="quiet-button" @click="paste">读取剪贴板</button>
    </section>
    <div class="library-layout">
      <section class="source-list panel">
        <div class="filter-row"><button v-for="item in [['all','全部'],['image','图片'],['pdf','PDF'],['code','代码'],['text','文本']] as const" :key="item[0]" :class="{ active: filter === item[0] }" @click="filter = item[0]">{{ item[1] }}</button></div>
        <button v-for="source in filtered" :key="source.id" class="source-row" :class="{ selected: selected?.id === source.id }" @click="selected = source"><span class="source-icon">{{ source.kind === 'image' ? '图' : source.kind === 'pdf' ? 'PDF' : source.kind === 'code' ? '&lt;/&gt;' : '文' }}</span><div><h4>{{ source.name }}</h4><p>{{ Math.max(1, Math.round(source.size / 1024)) }} KB · {{ new Date(source.importedAt).toLocaleDateString('zh-CN') }}</p></div></button>
        <div v-if="!filtered.length" class="empty-strip">资料库还是空的。把第一份资料拖进来吧。</div>
      </section>
      <section class="source-detail panel">
        <template v-if="selected"><div class="detail-title"><div><p class="eyebrow">{{ selected.kind.toUpperCase() }}</p><h3>{{ selected.name }}</h3></div><span class="hash" :title="selected.sha256">#{{ selected.sha256?.slice(0, 8) }}</span></div>
          <div class="source-preview"><img v-if="selected.kind === 'image' && selected.preview" :src="selected.preview" :alt="selected.name" /><pre v-else-if="selected.content">{{ selected.content }}</pre><div v-else class="pdf-placeholder"><b>PDF</b><span>已安全收录</span><small>首版会在 Tauri 桌面端渲染页码与框选区域。</small></div></div>
          <div class="action-grid"><button v-for="item in toolActions.filter((tool) => tool.accepts.includes(selected!.kind))" :key="item.id" @click="action(selected!, item.id)"><b>{{ item.id === 'create-question' ? '题' : item.id === 'ocr' ? '字' : item.id === 'formula' ? '∑' : item.id === 'code-image' ? '码' : '批' }}</b><span>{{ item.title }}<small>{{ item.description }}</small></span></button></div>
          <div class="source-meta"><TagPill v-for="tag in selected.tags" :key="tag" :label="tag" /><span>来源定位：第 1 页 · 全页区域</span></div>
        </template><div v-else class="detail-empty">从左边选一份资料，查看它能变成什么。</div>
      </section>
    </div>
  </div>
</template>
