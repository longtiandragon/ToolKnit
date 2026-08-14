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
    <div ref="backdropElement" class="fixed inset-0 z-150 center p-4 bg-[var(--scrim)] backdrop-blur-[3px]" @pointerdown.self="closeMenu()">
      <!--
        Same shape as the vocabulary importer, because it is the same job: the
        parsed rows are what you came to look at, so the chrome above and below
        them is one 56px strip each and nothing more.
      -->
      <section class="stack w-full max-w-240 max-h-[86vh] panel shadow-lg overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="question-import-title" @click="closeMenu()">
        <header class="row gap-4 shrink-0 px-4 h-14 border-b border-line">
          <div class="row gap-2.5 min-w-0 flex-1">
            <span class="center w-9 h-9 shrink-0 rounded-sm bg-accent-soft text-accent"><AppIcon name="review" :size="19" /></span>
            <div class="stack gap-0.5 min-w-0">
              <h2 id="question-import-title" class="text-[15px] font-semibold text-fg">批量收集题目</h2>
              <small class="text-[11px] text-fg-3 truncate">把题干、答案与错因先检查，再写进本地复习系统。</small>
            </div>
          </div>
          <ol class="row gap-1 shrink-0 p-0.5 rounded-sm bg-well border border-line" aria-label="批量导入流程">
            <li class="row gap-1.5 h-7 px-2.5 rounded-[4px] text-[11px] transition-colors bg-surface text-fg font-medium"><i class="not-italic font-mono text-fg-3">01</i>粘贴</li>
            <li class="row gap-1.5 h-7 px-2.5 rounded-[4px] text-[11px] transition-colors" :class="source.trim() ? 'bg-surface text-fg font-medium' : 'text-fg-3'"><i class="not-italic font-mono text-fg-3">02</i>检查</li>
            <li class="row gap-1.5 h-7 px-2.5 rounded-[4px] text-[11px] transition-colors" :class="canImport ? 'bg-surface text-fg font-medium' : 'text-fg-3'"><i class="not-italic font-mono text-fg-3">03</i>写入</li>
          </ol>
          <button class="btn-ghost btn-icon w-8 h-8 shrink-0 text-[18px]" aria-label="关闭题目批量导入" :disabled="importing" @click="requestClose">×</button>
        </header>

        <!-- Below `lg` the panes stack, and a 760px-tall window cannot hold two
             of them plus the settings row: sized by `flex-1` they split what is
             left and both clip their own content — the paste area lost its last
             line, the preview lost its privacy note. So the whole body scrolls
             as one and the panes keep a floor; only at `lg`, where the panes sit
             side by side and fit, do they flex to fill instead. -->
        <div class="stack flex-1 min-h-0 overflow-y-auto lg:overflow-visible">
        <div class="grid gap-3 shrink-0 p-3 grid-cols-1 lg:shrink lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <section class="stack min-w-0 min-h-52 lg:min-h-0 overflow-hidden rounded-lg border border-line bg-surface transition-colors focus-within:border-line-strong">
            <header class="row-between gap-3 shrink-0 px-3 py-2 border-b border-line">
              <div class="stack gap-0.5 min-w-0">
                <b class="text-[12px] font-medium text-fg">原始题目</b>
                <small class="text-[11px] leading-snug text-fg-3">支持来源、题干、答案、解析、错因、知识点等表头；也可每行一道题</small>
              </div>
              <button class="btn-default btn-sm shrink-0" :disabled="importing" @click="fileInput?.click()"><AppIcon name="folder-open" :size="13" />读取文件</button>
            </header>
            <textarea ref="sourceInput" v-model="source" class="w-full flex-1 min-h-40 px-3 py-2.5 border-0 rounded-none bg-transparent font-mono text-[12px] leading-relaxed text-fg resize-none focus:outline-none" :maxlength="MAX_QUESTION_IMPORT_CHARS" :disabled="importing" spellcheck="false" placeholder="标题&#9;来源&#9;题干&#9;答案&#9;解析&#9;我的答案&#9;错因&#9;分类&#9;知识点&#10;二分边界&#9;LeetCode 704&#9;为什么循环会结束？&#9;区间严格缩小&#9;每轮排除一半&#9;漏写 +1&#9;边界未收缩&#9;算法&#9;二分|循环不变量&#10;&#10;也可写：TCP 为什么需要三次握手？ => 确认双方收发能力" />
            <footer class="row-between gap-3 shrink-0 px-3 h-8 border-t border-line text-[11px] text-fg-3">
              <span class="tabular-nums">{{ source.length.toLocaleString() }} / {{ MAX_QUESTION_IMPORT_CHARS.toLocaleString() }} 字符</span>
              <button v-if="source" class="text-accent hover:underline underline-offset-2 disabled:opacity-45" :disabled="importing" @click="source = ''">清空</button>
            </footer>
            <input ref="fileInput" class="hidden" type="file" tabindex="-1" aria-hidden="true" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" @change="readFile" />
          </section>

          <section class="stack min-w-0 min-h-52 lg:min-h-0 overflow-hidden rounded-lg border border-line bg-surface" :aria-busy="parsing">
            <header class="row-between gap-3 shrink-0 px-3 py-2 border-b border-line">
              <div class="stack gap-0.5 min-w-0">
                <b class="text-[12px] font-medium text-fg">结构化预览</b>
                <small class="text-[11px] text-fg-3 truncate">{{ parsing ? '正在本机解析…' : source.trim() ? `${formatLabel} · ${includedRows.length} 道可用` : '等待粘贴内容' }}</small>
              </div>
              <span class="row gap-1.5 shrink-0 h-6 px-2 rounded-full text-[11px] font-medium" :class="includedRows.length ? 'bg-success-soft text-success' : 'bg-warn-soft text-warn'">
                <i class="w-1.5 h-1.5 rounded-full" :class="includedRows.length ? 'bg-success' : 'bg-warn'"></i>{{ parsing ? '解析中' : includedRows.length ? '可检查' : '未就绪' }}
              </span>
            </header>
            <div v-if="parsing" class="stack items-center justify-center gap-2.5 flex-1 min-h-0" role="status">
              <span class="row gap-1"><i class="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"></i><i class="w-1.5 h-1.5 rounded-full bg-accent animate-pulse [animation-delay:160ms]"></i><i class="w-1.5 h-1.5 rounded-full bg-accent animate-pulse [animation-delay:320ms]"></i></span>
              <p class="text-[12px] text-fg-3">正在整理题干、答案与复习信息…</p>
            </div>
            <div v-else-if="previewRows.length" class="stack flex-1 min-h-0 overflow-y-auto" role="list" aria-label="待导入题目预览">
              <article
                v-for="row in previewRows"
                :key="row.line"
                class="grid gap-x-2.5 gap-y-1 items-start px-3 py-2 border-b border-line transition-colors grid-cols-[24px_minmax(104px,0.82fr)_minmax(0,1.18fr)] hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
                tabindex="0"
                role="listitem"
                aria-haspopup="menu"
                :aria-expanded="menu?.row.line === row.line"
                title="右键或 Shift+F10 可复制或排除"
                @contextmenu="openMenu($event, row)"
                @keydown="openMenuFromKeyboard($event, row)"
              >
                <i class="not-italic font-mono text-[11px] leading-5 text-right text-fg-3 tabular-nums">{{ row.line }}</i>
                <span class="stack gap-0.5 min-w-0">
                  <b class="text-[12px] font-medium text-fg truncate">{{ row.title || row.stem.split('\n')[0] }}</b>
                  <small class="text-[11px] text-fg-3 truncate">{{ row.subject }} · 难度 {{ row.difficulty }}<template v-if="row.source"> · {{ row.source }}</template><template v-if="row.tags.length"> · {{ row.tags.slice(0, 2).join(' / ') }}</template></small>
                </span>
                <p class="min-w-0 text-[12px] leading-snug text-fg-2 line-clamp-2">{{ row.stem }}</p>
                <em class="col-start-2 col-end-4 not-italic text-[11px] text-fg-3 truncate">{{ row.answer || '暂未填写答案' }}</em>
              </article>
              <p v-if="includedRows.length > previewRows.length" class="shrink-0 px-3 py-2 text-[11px] leading-snug text-fg-3">还有 {{ includedRows.length - previewRows.length }} 道题会在同一批次处理，不继续挂载预览 DOM。</p>
            </div>
            <div v-else class="stack items-center justify-center gap-2 flex-1 min-h-0 px-6 text-center">
              <AppIcon name="inbox" :size="23" class="text-fg-3" />
              <b class="text-[13px] font-medium text-fg">{{ source.trim() ? '没有可导入的有效题目' : '把题目放到左侧' }}</b>
              <p class="text-[12px] leading-relaxed text-fg-3">{{ source.trim() ? '检查表头和题干；有问题的行会在下方说明。' : '内容只在本机 Worker 中解析，不会上传。' }}</p>
            </div>
            <div v-if="parseResult.issues.length" class="stack gap-1.5 shrink-0 max-h-36 overflow-y-auto p-2.5 border-t border-line bg-warn-soft" role="alert">
              <header class="row gap-1.5 text-warn"><AppIcon name="warning" :size="14" class="shrink-0" /><b class="text-[11px] font-semibold">{{ parseResult.issues.length }} 行需要检查</b></header>
              <p v-for="issue in parseResult.issues.slice(0, 4)" :key="`${issue.line}:${issue.message}`" class="row items-start gap-2 text-[11px] leading-snug text-fg-2">
                <i class="center shrink-0 w-5 h-4 rounded-[3px] bg-surface not-italic font-mono text-fg-3">{{ issue.line || '!' }}</i>
                <span class="min-w-0">{{ issue.message }}<small v-if="issue.preview" class="block truncate text-fg-3">{{ issue.preview }}</small></span>
              </p>
              <small v-if="parseResult.issues.length > 4" class="text-[11px] text-fg-3">另有 {{ parseResult.issues.length - 4 }} 行未展示；这些行不会写入。</small>
            </div>
          </section>
        </div>

        <section class="grid gap-2 shrink-0 px-3 pb-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.25fr)]">
          <!-- The label and its select are stacked, not side by side: at a
               quarter of the dialog's width a 160px select left the sentence
               four characters per line. -->
          <label class="stack gap-1.5 min-h-15 px-3 py-2.5 rounded-md bg-surface-2 border border-line">
            <span class="stack gap-0.5 min-w-0"><b class="text-[12px] font-medium text-fg">遇到重复题目</b><small class="text-[11px] leading-snug text-fg-3">按标题与完整题干匹配，不改动已有进度</small></span>
            <select v-model="policy" class="field w-full h-8 text-[12px]" :disabled="importing"><option value="skip">跳过重复题（推荐）</option><option value="copy">仍创建独立副本</option></select>
          </label>
          <label class="row gap-2.5 min-h-15 px-3 py-2.5 rounded-md bg-surface-2 border border-line cursor-pointer">
            <input v-model="answerReview" type="checkbox" class="shrink-0 w-4 h-4 accent-[var(--accent-solid)]" :disabled="importing" />
            <span class="stack gap-0.5 min-w-0"><b class="text-[12px] font-medium text-fg">创建答案回忆卡</b><small class="text-[11px] leading-snug text-fg-3">仅有答案或解析的题目会加入</small></span>
          </label>
          <label class="row gap-2.5 min-h-15 px-3 py-2.5 rounded-md bg-surface-2 border border-line cursor-pointer">
            <input v-model="errorReview" type="checkbox" class="shrink-0 w-4 h-4 accent-[var(--accent-solid)]" :disabled="importing" />
            <span class="stack gap-0.5 min-w-0"><b class="text-[12px] font-medium text-fg">创建错因复盘卡</b><small class="text-[11px] leading-snug text-fg-3">仅有错误做法或错因的题目会加入</small></span>
          </label>
          <div class="grid grid-cols-4 items-center min-h-15 rounded-md bg-surface-2 border border-line">
            <span class="stack items-center gap-0.5 border-r border-line"><b class="text-[14px] font-semibold text-accent tabular-nums">{{ prepared.importedCount }}</b><small class="text-[11px] text-fg-3">新增题目</small></span>
            <span class="stack items-center gap-0.5 border-r border-line"><b class="text-[14px] font-semibold text-accent tabular-nums">{{ prepared.reviewCardCount }}</b><small class="text-[11px] text-fg-3">复习卡</small></span>
            <span class="stack items-center gap-0.5 border-r border-line"><b class="text-[14px] font-semibold text-fg-3 tabular-nums">{{ prepared.skippedCount }}</b><small class="text-[11px] text-fg-3">重复题</small></span>
            <span class="stack items-center gap-0.5"><b class="text-[14px] font-semibold text-fg-3 tabular-nums">{{ excludedLines.size }}</b><small class="text-[11px] text-fg-3">手动排除</small></span>
          </div>
        </section>

        </div>
        <footer class="row-between gap-4 shrink-0 px-4 h-14 border-t border-line bg-surface-2">
          <p class="row gap-2 min-w-0">
            <AppIcon name="shield" :size="14" class="shrink-0 text-success" />
            <span class="stack gap-0.5 min-w-0"><b class="text-[12px] font-medium text-fg">安全写入</b><small class="text-[11px] text-fg-3 truncate">先验证全部题目，再批量写入 Vault；不会覆盖已有题目。</small></span>
          </p>
          <div class="row gap-2 shrink-0">
            <button class="btn-default" :disabled="importing" @click="requestClose">取消</button>
            <button class="btn-primary" :disabled="!canImport" @click="commitImport">
              <AppIcon :name="importing ? 'refresh' : 'inbox'" :size="14" />{{ importing ? '正在写入 Vault…' : `导入 ${prepared.documents.length} 道题` }}
              <kbd class="row shrink-0 h-5 ml-1 px-1.5 rounded-[4px] border border-current font-mono text-[11px] opacity-70">Ctrl Enter</kbd>
            </button>
          </div>
        </footer>
      </section>
      <section v-if="menu" ref="menuElement" class="menu-panel w-60" role="menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleMenuKeydown">
        <p class="menu-title"><span class="truncate text-fg">{{ menu.row.title || '未命名题目' }}</span><small class="shrink-0 font-normal">第 {{ menu.row.line }} 行</small></p>
        <button class="menu-item" role="menuitem" @click="copyRow(menu.row)"><span class="row gap-2"><AppIcon name="duplicate" :size="14" />复制结构化题目</span></button>
        <button class="menu-item menu-item-danger" role="menuitem" @click="toggleExcluded(menu.row)"><span class="row gap-2"><AppIcon name="trash" :size="14" />从本次导入排除</span></button>
      </section>
    </div>
  </Teleport>
</template>
