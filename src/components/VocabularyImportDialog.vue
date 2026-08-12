<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { MAX_VOCABULARY_IMPORT_CHARS, parseVocabularyImport, prepareVocabularyImport, type VocabularyImportDuplicatePolicy, type VocabularyImportParseResult, type VocabularyImportRow } from '@/lib/vocabulary-import'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import type { VocabularyReviewFacet } from '@/types'

const emit = defineEmits<{
  cancel: []
  complete: [summary: { imported: number; updated: number; skipped: number; reviewCards: number; firstId?: string }]
}>()

const store = useWorkbenchStore()
const ui = useUiStore()
const source = ref('')
const policy = ref<VocabularyImportDuplicatePolicy>('merge')
const reviewFacets = ref<VocabularyReviewFacet[]>([])
const parsing = ref(false)
const importing = ref(false)
const parseResult = shallowRef<VocabularyImportParseResult>({ rows: [], issues: [], format: 'simple', truncated: false })
const excludedLines = ref(new Set<number>())
const fileInput = ref<HTMLInputElement>()
const sourceInput = ref<HTMLTextAreaElement>()
const backdropElement = ref<HTMLElement>()
const menu = ref<{ row: VocabularyImportRow; x: number; y: number }>()
const menuElement = ref<HTMLElement>()
let menuTrigger: HTMLElement | undefined
let parseTimer: number | undefined
let requestId = 0
let worker: Worker | undefined

const includedRows = computed(() => parseResult.value.rows.filter(row => !excludedLines.value.has(row.line)))
const prepared = computed(() => prepareVocabularyImport(includedRows.value, store.vocabulary, policy.value, reviewFacets.value))
const previewRows = computed(() => includedRows.value.slice(0, 10))
const canImport = computed(() => includedRows.value.length > 0 && prepared.value.entries.length > 0 && !parsing.value && !importing.value)
const formatLabel = computed(() => parseResult.value.format === 'table' ? 'CSV / TSV 表格' : '单词—释义清单')
const reviewFacetChoices: Array<{ id: VocabularyReviewFacet; label: string; detail: string }> = [
  { id: 'meaning', label: '词义', detail: '单词 → 释义' },
  { id: 'spelling', label: '拼写', detail: '释义 → 单词' },
  { id: 'example', label: '例句', detail: '上下文填空' },
]
const reviewSelectionSummary = computed(() => {
  if (!reviewFacets.value.length) return '不自动加入复习；之后仍可按词义单独开启。'
  const cards = prepared.value.reviewCardCount
  const skipped = prepared.value.skippedReviewCardCount
  return `${cards} 张独立 FSRS 卡${skipped ? ` · ${skipped} 条因缺少例句未建例句卡` : ''}`
})

function applyResult(result: VocabularyImportParseResult) {
  parseResult.value = result
  const validLines = new Set(result.rows.map(row => row.line))
  excludedLines.value = new Set([...excludedLines.value].filter(line => validLines.has(line)))
  parsing.value = false
}

function parseNow() {
  const current = source.value
  const currentRequest = ++requestId
  if (!current.trim()) { applyResult({ rows: [], issues: [], format: 'simple', truncated: false }); return }
  parsing.value = true
  if (!worker) { applyResult(parseVocabularyImport(current)); return }
  worker.postMessage({ requestId: currentRequest, source: current })
}

function scheduleParse() {
  window.clearTimeout(parseTimer)
  parsing.value = Boolean(source.value.trim())
  parseTimer = window.setTimeout(parseNow, source.value.length > 200_000 ? 420 : 220)
}

async function readFile(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > MAX_VOCABULARY_IMPORT_CHARS) {
    ui.toast('词表文件过大', '单次最多读取约 1 MB 文本；请先拆分超大词表。', 'error')
    return
  }
  try { source.value = (await file.text()).slice(0, MAX_VOCABULARY_IMPORT_CHARS); await nextTick(); sourceInput.value?.focus() }
  catch (error) { ui.toast('无法读取词表', error instanceof Error ? error.message : '文件读取失败。', 'error') }
}

function toggleExcluded(row: VocabularyImportRow) {
  const next = new Set(excludedLines.value)
  if (next.has(row.line)) next.delete(row.line)
  else next.add(row.line)
  excludedLines.value = next
  closeMenu()
}

async function copyRow(row: VocabularyImportRow) {
  try { await navigator.clipboard.writeText(`${row.lemma}\t${row.partOfSpeech}\t${row.definition}`); ui.toast('已复制这一行', row.lemma, 'success') }
  catch { ui.toast('暂时无法复制', '系统剪贴板不可用。', 'error') }
  closeMenu(true)
}

function openMenu(event: MouseEvent | KeyboardEvent, row: VocabularyImportRow) {
  event.preventDefault(); event.stopPropagation()
  menuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = menuTrigger?.getBoundingClientRect()
  const x = event instanceof MouseEvent ? event.clientX : (bounds?.right ?? 650) - 20
  const y = event instanceof MouseEvent ? event.clientY : (bounds?.top ?? 200) + 24
  menu.value = { row, ...clampMenuPosition(x, y, { menuWidth: 226, menuHeight: 128, margin: 12 }) }
  void nextTick(() => menuElement.value?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus())
}
function openMenuFromKeyboard(event: KeyboardEvent, row: VocabularyImportRow) { if (isContextMenuShortcut(event)) openMenu(event, row) }
function closeMenu(restore = false) { menu.value = undefined; if (restore) void nextTick(() => menuTrigger?.focus({ preventScroll: true })) }
function handleMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return }
  const items = [...(menuElement.value?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])]
  const index = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (index === undefined) return
  event.preventDefault(); items[index]?.focus({ preventScroll: true })
}

async function requestClose() {
  if (importing.value) return
  if (source.value.trim() && !await ui.confirm({ title: '放弃这次批量导入？', message: '尚未写入单词库的粘贴内容会被清空。', danger: true, confirmLabel: '放弃导入' })) return
  emit('cancel')
}

async function commitImport() {
  if (!canImport.value) return
  const snapshot = prepared.value
  importing.value = true
  try {
    await store.importVocabularyEntries(snapshot.entries)
    emit('complete', { imported: snapshot.newCount, updated: snapshot.updatedCount, skipped: snapshot.skippedCount + excludedLines.value.size, reviewCards: snapshot.reviewCardCount, firstId: snapshot.entries[0]?.id })
  } catch (error) {
    ui.toast('单词没有导入', error instanceof Error ? error.message : '本地资料库没有完成这次事务。', 'error')
  } finally { importing.value = false }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Tab') {
    const focusable = [...(backdropElement.value?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), select:not([disabled]), input:not([disabled]):not([tabindex="-1"]), [tabindex="0"]') ?? [])]
      .filter(element => element.offsetParent !== null)
    const first = focusable[0]
    const last = focusable.at(-1)
    if (first && last && event.shiftKey && (document.activeElement === first || !backdropElement.value?.contains(document.activeElement))) { event.preventDefault(); last.focus(); return }
    if (first && last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); return }
  }
  if (event.key === 'Escape' && !menu.value) { event.preventDefault(); void requestClose() }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void commitImport() }
}

watch(source, scheduleParse)
watch([policy, reviewFacets], () => closeMenu(), { deep: true })
onMounted(() => {
  try {
    worker = new Worker(new URL('../workers/vocabulary-import.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ requestId: number; result: VocabularyImportParseResult }>) => { if (event.data.requestId === requestId) applyResult(event.data.result) }
    worker.onerror = () => { worker?.terminate(); worker = undefined; parseNow() }
  } catch { worker = undefined }
  window.addEventListener('keydown', handleKeydown)
  void nextTick(() => sourceInput.value?.focus())
})
onBeforeUnmount(() => { window.clearTimeout(parseTimer); worker?.terminate(); window.removeEventListener('keydown', handleKeydown) })
</script>

<template>
  <Teleport to="body">
    <div ref="backdropElement" class="word-import-backdrop" @pointerdown.self="closeMenu()">
      <section class="word-import-dialog" role="dialog" aria-modal="true" aria-labelledby="word-import-title" @click="closeMenu()">
        <header class="word-import-header">
          <div><span><AppIcon name="book" :size="19" /></span><div><p class="eyebrow">结构化导入</p><h2 id="word-import-title">批量收集单词</h2><small>粘贴词表，先检查，再一次写入本地 Vault。</small></div></div>
          <ol aria-label="批量导入流程"><li class="active"><i>01</i>粘贴</li><li :class="{ active: source.trim() }"><i>02</i>检查</li><li :class="{ active: canImport }"><i>03</i>写入</li></ol>
          <button aria-label="关闭批量导入" :disabled="importing" @click="requestClose">×</button>
        </header>

        <div class="word-import-body">
          <section class="word-import-source">
            <header><div><b>原始词表</b><small>支持词性、释义、例句、常用搭配等表头，或每行“单词 - 释义”</small></div><button class="quiet-button" :disabled="importing" @click="fileInput?.click()"><AppIcon name="folder-open" :size="13" />读取文件</button></header>
            <textarea ref="sourceInput" v-model="source" :maxlength="MAX_VOCABULARY_IMPORT_CHARS" :disabled="importing" spellcheck="false" placeholder="单词&#9;词性&#9;释义&#9;例句&#9;常用搭配&#10;run&#9;verb&#9;跑；运行&#9;The app runs.&#9;run a program&#10;compile - 编译" />
            <footer><span>{{ source.length.toLocaleString() }} / {{ MAX_VOCABULARY_IMPORT_CHARS.toLocaleString() }} 字符</span><button v-if="source" :disabled="importing" @click="source = ''">清空</button></footer>
            <input ref="fileInput" class="visually-hidden" type="file" tabindex="-1" aria-hidden="true" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" @change="readFile" />
          </section>

          <section class="word-import-preview" :aria-busy="parsing">
            <header><div><b>结构化预览</b><small>{{ parsing ? '正在本机解析…' : source.trim() ? `${formatLabel} · ${includedRows.length} 行可用` : '等待粘贴内容' }}</small></div><span :class="{ ready: includedRows.length }"><i></i>{{ parsing ? '解析中' : includedRows.length ? '可检查' : '未就绪' }}</span></header>
            <div v-if="parsing" class="word-import-loading" role="status"><i></i><i></i><i></i><p>正在整理词条、词义与例句…</p></div>
            <div v-else-if="previewRows.length" class="word-import-rows" role="list" aria-label="待导入单词预览">
              <article v-for="row in previewRows" :key="row.line" tabindex="0" role="listitem" aria-haspopup="menu" :aria-expanded="menu?.row.line === row.line" title="右键或 Shift+F10 可复制或排除" @contextmenu="openMenu($event, row)" @keydown="openMenuFromKeyboard($event, row)"><i>{{ row.line }}</i><span><b>{{ row.lemma }}</b><small>{{ row.pronunciation || row.language }}<template v-if="row.partOfSpeech"> · {{ row.partOfSpeech }}</template></small></span><p>{{ row.definition }}</p><em v-if="row.examples.length">{{ row.examples[0] }}</em></article>
              <p v-if="includedRows.length > previewRows.length" class="word-import-more">还有 {{ includedRows.length - previewRows.length }} 行将在同一事务中处理，不继续挂载预览 DOM。</p>
            </div>
            <div v-else class="word-import-empty"><AppIcon name="inbox" :size="23" /><b>{{ source.trim() ? '没有可导入的有效行' : '把词表放到左侧' }}</b><p>{{ source.trim() ? '检查分隔符和释义；有问题的行会在下方说明。' : '内容只在本机 Worker 中解析，不会上传。' }}</p></div>
            <div v-if="parseResult.issues.length" class="word-import-issues" role="alert"><header><AppIcon name="warning" :size="14" /><b>{{ parseResult.issues.length }} 行需要检查</b></header><p v-for="issue in parseResult.issues.slice(0, 4)" :key="`${issue.line}:${issue.message}`"><i>{{ issue.line || '!' }}</i><span>{{ issue.message }}<small v-if="issue.preview">{{ issue.preview }}</small></span></p><small v-if="parseResult.issues.length > 4">另有 {{ parseResult.issues.length - 4 }} 行未展示；这些行不会写入。</small></div>
          </section>
        </div>

        <section class="word-import-options">
          <label><span><b>遇到已有单词</b><small>匹配单词与语言，不依赖大小写</small></span><select v-model="policy" :disabled="importing"><option value="merge">合并新的词义（推荐）</option><option value="skip">跳过整个已有词条</option></select></label>
          <fieldset class="word-import-review" :disabled="importing">
            <legend>为本次词义创建复习卡</legend>
            <div class="word-import-review__choices">
              <label v-for="facet in reviewFacetChoices" :key="facet.id" :class="{ active: reviewFacets.includes(facet.id) }"><input v-model="reviewFacets" type="checkbox" :value="facet.id" /><span><b>{{ facet.label }}</b><small>{{ facet.detail }}</small></span></label>
            </div>
            <small class="word-import-review__summary" role="status">{{ reviewSelectionSummary }}</small>
          </fieldset>
          <div class="word-import-summary"><span><b>{{ prepared.newCount }}</b><small>新增词条</small></span><span><b>{{ prepared.updatedCount }}</b><small>更新词条</small></span><span><b>{{ prepared.addedSenseCount }}</b><small>新增词义</small></span><span><b>{{ prepared.skippedCount + excludedLines.size }}</b><small>跳过行</small></span></div>
        </section>

        <footer class="word-import-footer"><p><AppIcon name="shield" :size="14" /><span><b>安全写入</b><small>桌面版使用单个 SQLite 事务；失败不会留下半份词表。</small></span></p><div><button class="quiet-button" :disabled="importing" @click="requestClose">取消</button><button class="primary-button" :disabled="!canImport" @click="commitImport"><AppIcon :name="importing ? 'refresh' : 'inbox'" :size="14" />{{ importing ? '正在写入 Vault…' : `导入 ${prepared.entries.length} 个词条` }}<kbd>Ctrl Enter</kbd></button></div></footer>
      </section>
      <section v-if="menu" ref="menuElement" class="word-import-menu" role="menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleMenuKeydown"><p>{{ menu.row.lemma }}<small>第 {{ menu.row.line }} 行</small></p><button role="menuitem" @click="copyRow(menu.row)"><AppIcon name="duplicate" :size="14" />复制结构化行</button><button role="menuitem" @click="toggleExcluded(menu.row)"><AppIcon name="trash" :size="14" />从本次导入排除</button></section>
    </div>
  </Teleport>
</template>

<style src="../styles.import-dialog.css"></style>
