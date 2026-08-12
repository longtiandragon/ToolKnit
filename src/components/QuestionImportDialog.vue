<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { MAX_QUESTION_IMPORT_CHARS, parseQuestionImport, prepareQuestionImport, type QuestionImportDuplicatePolicy, type QuestionImportParseResult, type QuestionImportRow } from '@/lib/question-import'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'

const emit = defineEmits<{
  cancel: []
  complete: [summary: { imported: number; skipped: number; reviewCards: number; firstId?: string }]
}>()

const store = useWorkbenchStore()
const ui = useUiStore()
const source = ref('')
const policy = ref<QuestionImportDuplicatePolicy>('skip')
const answerReview = ref(true)
const errorReview = ref(false)
const parsing = ref(false)
const importing = ref(false)
const parseResult = shallowRef<QuestionImportParseResult>({ rows: [], issues: [], format: 'simple', truncated: false })
const excludedLines = ref(new Set<number>())
const fileInput = ref<HTMLInputElement>()
const sourceInput = ref<HTMLTextAreaElement>()
const backdropElement = ref<HTMLElement>()
const menu = ref<{ row: QuestionImportRow; x: number; y: number }>()
const menuElement = ref<HTMLElement>()
let menuTrigger: HTMLElement | undefined
let parseTimer: number | undefined
let requestId = 0
let worker: Worker | undefined

const includedRows = computed(() => parseResult.value.rows.filter(row => !excludedLines.value.has(row.line)))
const prepared = computed(() => prepareQuestionImport(includedRows.value, store.documents, policy.value, answerReview.value, errorReview.value))
const previewRows = computed(() => includedRows.value.slice(0, 10))
const canImport = computed(() => prepared.value.documents.length > 0 && !parsing.value && !importing.value)
const formatLabel = computed(() => parseResult.value.format === 'table' ? 'CSV / TSV 表格' : '每行一道题')

function applyResult(result: QuestionImportParseResult) {
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
  if (!worker) { applyResult(parseQuestionImport(current)); return }
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
  if (file.size > MAX_QUESTION_IMPORT_CHARS) { ui.toast('题目文件过大', '单次最多读取约 1 MB；请先拆分文件。', 'error'); return }
  try { source.value = (await file.text()).slice(0, MAX_QUESTION_IMPORT_CHARS); await nextTick(); sourceInput.value?.focus() }
  catch (error) { ui.toast('无法读取题目文件', error instanceof Error ? error.message : '文件读取失败。', 'error') }
}
function toggleExcluded(row: QuestionImportRow) {
  const next = new Set(excludedLines.value)
  if (next.has(row.line)) next.delete(row.line)
  else next.add(row.line)
  excludedLines.value = next
  closeMenu()
}
async function copyRow(row: QuestionImportRow) {
  try { await navigator.clipboard.writeText([row.title, row.source, row.stem, row.answer, row.explanation, row.wrongAnswer, row.errorReason, row.subject, row.tags.join('|')].join('\t')); ui.toast('已复制这道题', row.title || row.stem.slice(0, 40), 'success') }
  catch { ui.toast('暂时无法复制', '系统剪贴板不可用。', 'error') }
  closeMenu(true)
}
function openMenu(event: MouseEvent | KeyboardEvent, row: QuestionImportRow) {
  event.preventDefault(); event.stopPropagation()
  menuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = menuTrigger?.getBoundingClientRect()
  const x = event instanceof MouseEvent ? event.clientX : (bounds?.right ?? 650) - 20
  const y = event instanceof MouseEvent ? event.clientY : (bounds?.top ?? 200) + 24
  menu.value = { row, ...clampMenuPosition(x, y, { menuWidth: 236, menuHeight: 128, margin: 12 }) }
  void nextTick(() => menuElement.value?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus())
}
function openMenuFromKeyboard(event: KeyboardEvent, row: QuestionImportRow) { if (isContextMenuShortcut(event)) openMenu(event, row) }
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
  if (source.value.trim() && !await ui.confirm({ title: '放弃这次题目导入？', message: '尚未写入题目库的内容会被清空。', danger: true, confirmLabel: '放弃导入' })) return
  emit('cancel')
}
async function commitImport() {
  if (!canImport.value) return
  const snapshot = prepared.value
  importing.value = true
  try {
    await store.importQuestionDocuments(snapshot.documents)
    emit('complete', { imported: snapshot.importedCount, skipped: snapshot.skippedCount, reviewCards: snapshot.reviewCardCount, firstId: snapshot.documents[0]?.id })
  } catch (error) { ui.toast('题目没有导入', error instanceof Error ? error.message : '本地资料库没有完成这次写入。', 'error') }
  finally { importing.value = false }
}
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Tab') {
    const focusable = [...(backdropElement.value?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), select:not([disabled]), input:not([disabled]):not([tabindex="-1"]), [tabindex="0"]') ?? [])].filter(element => element.offsetParent !== null)
    const first = focusable[0]; const last = focusable.at(-1)
    if (first && last && event.shiftKey && (document.activeElement === first || !backdropElement.value?.contains(document.activeElement))) { event.preventDefault(); last.focus(); return }
    if (first && last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); return }
  }
  if (event.key === 'Escape' && !menu.value) { event.preventDefault(); void requestClose() }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void commitImport() }
}

watch(source, scheduleParse)
watch([policy, answerReview, errorReview], () => closeMenu())
onMounted(() => {
  try {
    worker = new Worker(new URL('../workers/question-import.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ requestId: number; result: QuestionImportParseResult }>) => { if (event.data.requestId === requestId) applyResult(event.data.result) }
    worker.onerror = () => { worker?.terminate(); worker = undefined; parseNow() }
  } catch { worker = undefined }
  window.addEventListener('keydown', handleKeydown)
  void nextTick(() => sourceInput.value?.focus())
})
onBeforeUnmount(() => { window.clearTimeout(parseTimer); worker?.terminate(); window.removeEventListener('keydown', handleKeydown) })
</script>

<template>
  <Teleport to="body">
    <div ref="backdropElement" class="word-import-backdrop question-import-backdrop" @pointerdown.self="closeMenu()">
      <section class="word-import-dialog" role="dialog" aria-modal="true" aria-labelledby="question-import-title" @click="closeMenu()">
        <header class="word-import-header">
          <div><span><AppIcon name="review" :size="19" /></span><div><p class="eyebrow">结构化导入</p><h2 id="question-import-title">批量收集题目</h2><small>把题干、答案与错因先检查，再写进本地复习系统。</small></div></div>
          <ol aria-label="批量导入流程"><li class="active"><i>01</i>粘贴</li><li :class="{ active: source.trim() }"><i>02</i>检查</li><li :class="{ active: canImport }"><i>03</i>写入</li></ol>
          <button aria-label="关闭题目批量导入" :disabled="importing" @click="requestClose">×</button>
        </header>

        <div class="word-import-body">
          <section class="word-import-source">
            <header><div><b>原始题目</b><small>支持来源、题干、答案、解析、错因、知识点等表头；也可每行一道题</small></div><button class="quiet-button" :disabled="importing" @click="fileInput?.click()"><AppIcon name="folder-open" :size="13" />读取文件</button></header>
            <textarea ref="sourceInput" v-model="source" :maxlength="MAX_QUESTION_IMPORT_CHARS" :disabled="importing" spellcheck="false" placeholder="标题&#9;来源&#9;题干&#9;答案&#9;解析&#9;我的答案&#9;错因&#9;分类&#9;知识点&#10;二分边界&#9;LeetCode 704&#9;为什么循环会结束？&#9;区间严格缩小&#9;每轮排除一半&#9;漏写 +1&#9;边界未收缩&#9;算法&#9;二分|循环不变量&#10;&#10;也可写：TCP 为什么需要三次握手？ => 确认双方收发能力" />
            <footer><span>{{ source.length.toLocaleString() }} / {{ MAX_QUESTION_IMPORT_CHARS.toLocaleString() }} 字符</span><button v-if="source" :disabled="importing" @click="source = ''">清空</button></footer>
            <input ref="fileInput" class="visually-hidden" type="file" tabindex="-1" aria-hidden="true" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" @change="readFile" />
          </section>

          <section class="word-import-preview" :aria-busy="parsing">
            <header><div><b>结构化预览</b><small>{{ parsing ? '正在本机解析…' : source.trim() ? `${formatLabel} · ${includedRows.length} 道可用` : '等待粘贴内容' }}</small></div><span :class="{ ready: includedRows.length }"><i></i>{{ parsing ? '解析中' : includedRows.length ? '可检查' : '未就绪' }}</span></header>
            <div v-if="parsing" class="word-import-loading" role="status"><i></i><i></i><i></i><p>正在整理题干、答案与复习信息…</p></div>
            <div v-else-if="previewRows.length" class="word-import-rows question-import-rows" role="list" aria-label="待导入题目预览">
              <article v-for="row in previewRows" :key="row.line" tabindex="0" role="listitem" aria-haspopup="menu" :aria-expanded="menu?.row.line === row.line" title="右键或 Shift+F10 可复制或排除" @contextmenu="openMenu($event, row)" @keydown="openMenuFromKeyboard($event, row)"><i>{{ row.line }}</i><span><b>{{ row.title || row.stem.split('\n')[0] }}</b><small>{{ row.subject }} · 难度 {{ row.difficulty }}<template v-if="row.source"> · {{ row.source }}</template><template v-if="row.tags.length"> · {{ row.tags.slice(0, 2).join(' / ') }}</template></small></span><p>{{ row.stem }}</p><em>{{ row.answer || '暂未填写答案' }}</em></article>
              <p v-if="includedRows.length > previewRows.length" class="word-import-more">还有 {{ includedRows.length - previewRows.length }} 道题会在同一批次处理，不继续挂载预览 DOM。</p>
            </div>
            <div v-else class="word-import-empty"><AppIcon name="inbox" :size="23" /><b>{{ source.trim() ? '没有可导入的有效题目' : '把题目放到左侧' }}</b><p>{{ source.trim() ? '检查表头和题干；有问题的行会在下方说明。' : '内容只在本机 Worker 中解析，不会上传。' }}</p></div>
            <div v-if="parseResult.issues.length" class="word-import-issues" role="alert"><header><AppIcon name="warning" :size="14" /><b>{{ parseResult.issues.length }} 行需要检查</b></header><p v-for="issue in parseResult.issues.slice(0, 4)" :key="`${issue.line}:${issue.message}`"><i>{{ issue.line || '!' }}</i><span>{{ issue.message }}<small v-if="issue.preview">{{ issue.preview }}</small></span></p><small v-if="parseResult.issues.length > 4">另有 {{ parseResult.issues.length - 4 }} 行未展示；这些行不会写入。</small></div>
          </section>
        </div>

        <section class="word-import-options question-import-options">
          <label><span><b>遇到重复题目</b><small>按标题与完整题干匹配，不改动已有进度</small></span><select v-model="policy" :disabled="importing"><option value="skip">跳过重复题（推荐）</option><option value="copy">仍创建独立副本</option></select></label>
          <label class="word-import-review"><input v-model="answerReview" type="checkbox" :disabled="importing" /><span><b>创建答案回忆卡</b><small>仅有答案或解析的题目会加入</small></span></label>
          <label class="word-import-review"><input v-model="errorReview" type="checkbox" :disabled="importing" /><span><b>创建错因复盘卡</b><small>仅有错误做法或错因的题目会加入</small></span></label>
          <div class="word-import-summary"><span><b>{{ prepared.importedCount }}</b><small>新增题目</small></span><span><b>{{ prepared.reviewCardCount }}</b><small>复习卡</small></span><span><b>{{ prepared.skippedCount }}</b><small>重复题</small></span><span><b>{{ excludedLines.size }}</b><small>手动排除</small></span></div>
        </section>

        <footer class="word-import-footer"><p><AppIcon name="shield" :size="14" /><span><b>安全写入</b><small>先验证全部题目，再批量写入 Vault；不会覆盖已有题目。</small></span></p><div><button class="quiet-button" :disabled="importing" @click="requestClose">取消</button><button class="primary-button" :disabled="!canImport" @click="commitImport"><AppIcon :name="importing ? 'refresh' : 'inbox'" :size="14" />{{ importing ? '正在写入 Vault…' : `导入 ${prepared.documents.length} 道题` }}<kbd>Ctrl Enter</kbd></button></div></footer>
      </section>
      <section v-if="menu" ref="menuElement" class="word-import-menu" role="menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleMenuKeydown"><p>{{ menu.row.title || '未命名题目' }}<small>第 {{ menu.row.line }} 行</small></p><button role="menuitem" @click="copyRow(menu.row)"><AppIcon name="duplicate" :size="14" />复制结构化题目</button><button role="menuitem" @click="toggleExcluded(menu.row)"><AppIcon name="trash" :size="14" />从本次导入排除</button></section>
    </div>
  </Teleport>
</template>

<style src="../styles.import-dialog.css"></style>
<style scoped>
.question-import-rows article{grid-template-columns:28px minmax(130px,.82fr) minmax(170px,1.18fr);align-items:start;padding-block:9px}.question-import-rows article>i{margin-top:2px}.question-import-rows article>p{display:-webkit-box;max-height:34px;line-height:1.55;white-space:normal;-webkit-box-orient:vertical;-webkit-line-clamp:2}.question-import-rows article>em{display:block;grid-column:2/-1;overflow:hidden;margin-top:-2px;color:var(--muted);font:11px/1.5 var(--font-ui);font-style:normal;text-overflow:ellipsis;white-space:nowrap}.question-import-options{grid-template-columns:1.2fr .9fr .9fr 1.25fr}.question-import-options .word-import-summary{min-height:60px}@media(max-width:1100px){.question-import-options{grid-template-columns:1fr 1fr}.question-import-options .word-import-summary{grid-column:1/-1}}@media(max-width:900px){.question-import-options{grid-template-columns:1fr}.question-import-options .word-import-summary{grid-column:auto}}
</style>
