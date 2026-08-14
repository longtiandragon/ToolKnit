<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { getSessionApiKey, runFormulaVision } from '@/lib/ai'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { formatFormulaImageSize, prepareFormulaVisionImage, type PreparedFormulaImage } from '@/lib/formula-recognition'
import { createMarkdownFormula, createMarkdownTable, normalizeMarkdownFormulaSource, type MarkdownFormulaMode, type MarkdownInsertion, type MarkdownTableAlignment } from '@/lib/markdown-insert'
import { renderMarkdown } from '@/lib/markdown'
import { isDesktop } from '@/lib/native'
import { useUiStore } from '@/stores/ui'
import { useWorkbenchStore } from '@/stores/workbench'

const props = withDefaults(defineProps<{
  initialPanel?: 'table' | 'formula'
  initialFormulaRecognition?: boolean
  selectedText?: string
}>(), { initialPanel: 'table', initialFormulaRecognition: false, selectedText: '' })

const emit = defineEmits<{
  close: []
  insert: [insertion: MarkdownInsertion, block: boolean]
}>()

const panel = ref<'table' | 'formula'>(props.initialPanel)
const store = useWorkbenchStore()
const ui = useUiStore()
const columns = ref(3)
const rows = ref(2)
const fillHeader = ref(true)
const alignment = ref<MarkdownTableAlignment>('default')
const formulaMode = ref<MarkdownFormulaMode>('block')
const formulaSource = ref(normalizeMarkdownFormulaSource(props.selectedText) || 'x^2 + y^2 = z^2')
const dialog = ref<HTMLElement>()
const formulaInput = ref<HTMLTextAreaElement>()
const formulaImageInput = ref<HTMLInputElement>()
const formulaVisionOpen = ref(props.initialFormulaRecognition)
const formulaImage = shallowRef<PreparedFormulaImage>()
const formulaImageBusy = ref(false)
const formulaVisionRunning = ref(false)
const formulaVisionError = ref('')
const formulaProfileId = ref(store.aiProfiles[0]?.id ?? '')
const imageMenu = ref<{ x: number; y: number } | null>(null)
const imageMenuElement = ref<HTMLElement>()

const tableInsertion = computed(() => createMarkdownTable({ columns: columns.value, rows: rows.value, fillHeader: fillHeader.value, alignment: alignment.value }))
const formulaInsertion = computed(() => createMarkdownFormula(formulaSource.value, formulaMode.value))
const formulaPreviewSource = ref(formulaInsertion.value.text)
const formulaPreview = computed(() => renderMarkdown(formulaPreviewSource.value))
const formulaProfile = computed(() => store.aiProfiles.find((profile) => profile.id === formulaProfileId.value))
const formulaProvider = computed(() => {
  const profile = formulaProfile.value
  if (!profile) return '未选择服务'
  try { return `${new URL(profile.baseUrl).host} · ${profile.model}` } catch { return `${profile.label} · ${profile.model}` }
})
const tableCells = computed(() => Array.from({ length: rows.value * columns.value }, (_, index) => index))
let formulaPreviewTimer: number | undefined
const formulaSnippets = [
  { label: '分数', source: '\\frac{}{}' },
  { label: '根号', source: '\\sqrt{}' },
  { label: '上标', source: '^{}' },
  { label: '下标', source: '_{}' },
  { label: '求和', source: '\\sum_{i=1}^{n}' },
  { label: '极限', source: '\\lim_{x \\to 0}' },
]

function focusInitial() {
  void nextTick(() => dialog.value?.querySelector<HTMLElement>('[data-dialog-initial], button, input, textarea')?.focus())
}

function setPanel(next: 'table' | 'formula') {
  panel.value = next
  void nextTick(() => next === 'formula' ? formulaInput.value?.focus() : focusInitial())
}

function changeDimension(target: 'columns' | 'rows', delta: number) {
  if (target === 'columns') columns.value = Math.min(8, Math.max(1, columns.value + delta))
  else rows.value = Math.min(12, Math.max(1, rows.value + delta))
}

function normalizeDimensions() {
  columns.value = Math.min(8, Math.max(1, Math.round(Number(columns.value) || 1)))
  rows.value = Math.min(12, Math.max(1, Math.round(Number(rows.value) || 1)))
}

function insertFormulaSnippet(source: string) {
  const input = formulaInput.value
  if (!input) return
  const start = input.selectionStart
  const end = input.selectionEnd
  formulaSource.value = `${formulaSource.value.slice(0, start)}${source}${formulaSource.value.slice(end)}`
  const brace = source.indexOf('{}')
  const cursor = start + (brace >= 0 ? brace + 1 : source.length)
  void nextTick(() => {
    input.focus()
    input.setSelectionRange(cursor, cursor)
  })
}

function confirmInsertion() {
  emit('insert', panel.value === 'table' ? tableInsertion.value : formulaInsertion.value, panel.value === 'table' || formulaMode.value === 'block')
}

async function chooseFormulaImage(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  formulaVisionError.value = ''
  formulaImageBusy.value = true
  try {
    formulaImage.value = await prepareFormulaVisionImage(file)
  } catch (error) {
    formulaImage.value = undefined
    formulaVisionError.value = error instanceof Error ? error.message : '公式图片处理失败。'
  } finally {
    formulaImageBusy.value = false
    if (formulaImageInput.value) formulaImageInput.value.value = ''
  }
}

function selectFormulaImage() {
  closeImageMenu()
  formulaImageInput.value?.click()
}

function clearFormulaImage() {
  closeImageMenu()
  formulaImage.value = undefined
  formulaVisionError.value = ''
}

async function copyFormulaImageName() {
  if (!formulaImage.value) return
  try { await navigator.clipboard.writeText(formulaImage.value.name); ui.toast('已复制图片名称', undefined, 'success') }
  catch { ui.toast('无法写入系统剪贴板', undefined, 'error') }
  closeImageMenu()
}

function openImageMenu(event: MouseEvent | KeyboardEvent) {
  if (!formulaImage.value) return
  event.preventDefault()
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const point = event instanceof MouseEvent && event.clientX ? { x: event.clientX, y: event.clientY } : { x: rect.left + 24, y: rect.top + 24 }
  imageMenu.value = clampMenuPosition(point.x, point.y, { menuWidth: 184, menuHeight: 116 })
  void nextTick(() => imageMenuElement.value?.querySelector<HTMLElement>('button')?.focus())
}

function handleImagePreviewKeydown(event: KeyboardEvent) {
  if (isContextMenuShortcut(event)) openImageMenu(event)
}

function closeImageMenu() { imageMenu.value = null }

function handleImageMenuKeydown(event: KeyboardEvent) {
  if (!imageMenuElement.value) return
  if (event.key === 'Escape') { event.preventDefault(); closeImageMenu(); return }
  const buttons = [...imageMenuElement.value.querySelectorAll<HTMLButtonElement>('button')]
  const nextIndex = nextMenuItemIndex(event.key, buttons.indexOf(document.activeElement as HTMLButtonElement), buttons.length)
  if (nextIndex !== undefined) { event.preventDefault(); buttons[nextIndex]?.focus() }
}

async function recognizeFormula() {
  formulaVisionError.value = ''
  const image = formulaImage.value
  const profile = formulaProfile.value
  if (!image) { formulaVisionError.value = '先选择一张公式图片。'; return }
  if (!profile) { formulaVisionError.value = '先到设置中配置支持图片输入的 OpenAI 兼容服务。'; return }
  if (isDesktop() && !profile.hasKey) { formulaVisionError.value = '该服务尚未保存系统凭据，请先到设置中补充。'; return }
  const key = getSessionApiKey(profile.id)
  if (!isDesktop() && !key) { formulaVisionError.value = '浏览器开发模式需要先在设置中输入 Session API Key。'; return }
  const confirmed = await ui.confirm({
    title: '发送这张公式图片？',
    message: `将把页面当前显示的 ${image.width} × ${image.height} JPEG（${formatFormulaImageSize(image.sentSize)}）发送到 ${formulaProvider.value}。不会发送笔记正文、文件路径或其他资料。`,
    confirmLabel: '确认并识别',
  })
  if (!confirmed) return
  const job = store.addJob('ai', '公式图片识别', [image.name], { toolId: 'formula-image-recognition', route: '/documents', parameters: { provider: profile.label, model: profile.model, width: image.width, height: image.height, sentSize: image.sentSize }, retryable: true })
  store.updateJob(job.id, { status: 'running', progress: 18, detail: '正在发送你刚刚确认的公式图片…' })
  formulaVisionRunning.value = true
  try {
    formulaSource.value = await runFormulaVision(profile, key, image.dataUrl)
    store.updateJob(job.id, { status: 'succeeded', progress: 100, outputNames: ['LaTeX 草稿'], detail: '识别结果已回填公式编辑器，仍需人工校对。' })
    ui.toast('LaTeX 草稿已生成', '请对照原图校对后再插入。', 'success')
    void nextTick(() => formulaInput.value?.focus())
  } catch (error) {
    const detail = error instanceof Error ? error.message : '公式识别请求失败。'
    formulaVisionError.value = detail
    store.updateJob(job.id, { status: 'failed', progress: 100, errorCode: 'FORMULA_RECOGNITION_FAILED', detail })
    ui.toast('公式识别失败', detail, 'error')
  } finally { formulaVisionRunning.value = false }
}

function handleKeydown(event: KeyboardEvent) {
  if (imageMenu.value) { handleImageMenuKeydown(event); return }
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable.at(-1)!
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

onMounted(() => { focusInitial(); document.addEventListener('pointerdown', closeImageMenu) })
watch([formulaSource, formulaMode], () => {
  if (formulaPreviewTimer !== undefined) window.clearTimeout(formulaPreviewTimer)
  formulaPreviewTimer = window.setTimeout(() => { formulaPreviewSource.value = formulaInsertion.value.text }, 100)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeImageMenu)
  if (formulaPreviewTimer !== undefined) window.clearTimeout(formulaPreviewTimer)
})
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-150 center p-4 bg-[var(--scrim)] backdrop-blur-[3px]" @mousedown.self="$emit('close')">
      <section ref="dialog" class="stack w-full max-w-200 max-h-[88vh] panel shadow-lg overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="markdown-insert-title" @mousedown.stop @keydown="handleKeydown">
        <header class="row-between items-start gap-4 shrink-0 px-5 pt-4 pb-3">
          <div class="stack gap-1 min-w-0">
            <p class="text-[11px] font-semibold text-fg-3">Markdown 构建器</p>
            <h2 id="markdown-insert-title" class="text-[16px] font-semibold text-fg">插入表格或公式</h2>
            <span class="text-[12px] leading-relaxed text-fg-3">生成的是标准 Markdown，可继续交给 Typora 或 Obsidian 打开。</span>
          </div>
          <button class="btn-ghost btn-icon w-8 h-8 shrink-0 text-[18px]" type="button" aria-label="关闭插入器" @click="$emit('close')">×</button>
        </header>

        <nav class="row gap-1 shrink-0 px-5 pb-3 border-b border-line" role="tablist" aria-label="插入类型">
          <button data-dialog-initial type="button" role="tab" class="btn btn-sm" :aria-selected="panel === 'table'" :class="panel === 'table' ? 'bg-accent-soft text-accent' : 'text-fg-2 hover:bg-surface-2 hover:text-fg'" @click="setPanel('table')"><AppIcon name="table" :size="15" />表格</button>
          <button type="button" role="tab" class="btn btn-sm" :aria-selected="panel === 'formula'" :class="panel === 'formula' ? 'bg-accent-soft text-accent' : 'text-fg-2 hover:bg-surface-2 hover:text-fg'" @click="setPanel('formula')"><AppIcon name="math" :size="15" />公式</button>
        </nav>

        <!-- Controls on the left, the thing being built on the right. Both
             panels keep that split so switching tabs does not move the eye. -->
        <div v-if="panel === 'table'" class="grid gap-5 flex-1 min-h-0 overflow-y-auto p-5 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.9fr)]" role="tabpanel">
          <div class="stack content-start gap-3.5 min-w-0">
            <label class="stack gap-1.5">
              <span class="text-[12px] font-medium text-fg-2">列数</span>
              <div class="row w-36 h-9 rounded-sm bg-well border border-line overflow-hidden">
                <button type="button" class="center w-9 h-full shrink-0 text-[15px] text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg" aria-label="减少列数" @click="changeDimension('columns', -1)">−</button>
                <input v-model.number="columns" type="number" min="1" max="8" class="min-w-0 flex-1 h-full px-1 bg-transparent border-x border-line text-center font-mono text-[12px] text-fg focus:outline-none [&::-webkit-inner-spin-button]:appearance-none" aria-label="表格列数" @change="normalizeDimensions" />
                <button type="button" class="center w-9 h-full shrink-0 text-[15px] text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg" aria-label="增加列数" @click="changeDimension('columns', 1)">＋</button>
              </div>
            </label>
            <label class="stack gap-1.5">
              <span class="text-[12px] font-medium text-fg-2">内容行</span>
              <div class="row w-36 h-9 rounded-sm bg-well border border-line overflow-hidden">
                <button type="button" class="center w-9 h-full shrink-0 text-[15px] text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg" aria-label="减少内容行" @click="changeDimension('rows', -1)">−</button>
                <input v-model.number="rows" type="number" min="1" max="12" class="min-w-0 flex-1 h-full px-1 bg-transparent border-x border-line text-center font-mono text-[12px] text-fg focus:outline-none [&::-webkit-inner-spin-button]:appearance-none" aria-label="表格内容行数" @change="normalizeDimensions" />
                <button type="button" class="center w-9 h-full shrink-0 text-[15px] text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg" aria-label="增加内容行" @click="changeDimension('rows', 1)">＋</button>
              </div>
            </label>
            <label class="row items-start gap-2.5 px-3 py-2.5 rounded-md bg-surface-2 border border-line cursor-pointer">
              <input v-model="fillHeader" type="checkbox" class="shrink-0 mt-0.5 w-4 h-4 accent-[var(--accent-solid)]" />
              <span class="stack gap-0.5 min-w-0"><b class="text-[12px] font-medium text-fg">填写表头</b><small class="text-[11px] leading-snug text-fg-3">关闭后保留空白表头，仍兼容 GFM。</small></span>
            </label>
            <fieldset class="min-w-0 m-0 p-0 border-0">
              <legend class="text-[12px] font-medium text-fg-2">列对齐</legend>
              <div class="row gap-0.5 w-max max-w-full mt-1.5 p-0.5 rounded-sm bg-well border border-line">
                <button
                  v-for="item in [{ value: 'default', label: '默认' }, { value: 'left', label: '左' }, { value: 'center', label: '居中' }, { value: 'right', label: '右' }]"
                  :key="item.value"
                  type="button"
                  class="h-7 px-2.5 rounded-[4px] text-[12px] transition-colors"
                  :aria-pressed="alignment === item.value"
                  :class="alignment === item.value ? 'bg-surface text-fg font-medium shadow-sm' : 'text-fg-3 hover:text-fg'"
                  @click="alignment = item.value as MarkdownTableAlignment"
                >{{ item.label }}</button>
              </div>
            </fieldset>
          </div>
          <div class="stack content-start gap-3 min-w-0 p-4 rounded-md bg-surface-2 border border-line" aria-label="表格结构预览">
            <header class="row-between gap-2"><span class="text-[11px] font-semibold text-fg-3">结构预览</span><code class="font-mono text-[11px] font-semibold text-accent">{{ columns }} × {{ rows + 1 }}</code></header>
            <div class="grid gap-[3px] min-h-33 content-center" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(22px, 1fr))` }">
              <i v-for="column in columns" :key="`head-${column}`" class="center min-h-5.5 rounded-[3px] bg-accent-soft border border-accent not-italic font-mono text-[11px] font-semibold text-accent">{{ fillHeader ? column : '' }}</i>
              <i v-for="cell in tableCells" :key="cell" class="min-h-5.5 rounded-[3px] bg-surface border border-line"></i>
            </div>
            <small class="text-[11px] leading-relaxed text-fg-3">最多 8 列、12 行，避免误操作生成超大表格。</small>
          </div>
        </div>

        <div v-else class="grid gap-5 flex-1 min-h-0 overflow-y-auto p-5 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.9fr)]" role="tabpanel">
          <!-- Recognition is optional and it leaves the machine, so it stays
               folded away above the editor rather than beside it. -->
          <section class="stack md:col-span-2 min-w-0 overflow-hidden rounded-md bg-surface-2 border" :class="formulaVisionOpen ? 'border-accent' : 'border-line'">
            <button class="row-between gap-3 w-full h-11 px-3 text-left transition-colors hover:bg-surface-3" type="button" :aria-expanded="formulaVisionOpen" @click="formulaVisionOpen = !formulaVisionOpen">
              <span class="row gap-2 min-w-0"><AppIcon name="file-image" :size="15" class="shrink-0 text-fg-3" /><b class="text-[12px] font-medium text-fg">从公式图片生成草稿</b><small class="pl-2 border-l border-line text-[11px] text-fg-3">可选 AI · 发送前再次确认</small></span>
              <i class="shrink-0 not-italic text-[15px] text-fg-3">{{ formulaVisionOpen ? '−' : '＋' }}</i>
            </button>
            <div v-if="formulaVisionOpen" class="grid gap-2.5 p-3 border-t border-line grid-cols-1 md:grid-cols-[minmax(210px,0.9fr)_minmax(240px,1.1fr)]">
              <input ref="formulaImageInput" class="hidden" type="file" accept="image/png,image/jpeg,image/webp" @change="chooseFormulaImage" />
              <button v-if="!formulaImage" class="row gap-2.5 min-h-21 p-2.5 rounded-md bg-surface border border-dashed border-line text-left transition-colors hover:border-accent hover:bg-accent-soft disabled:opacity-45 disabled:cursor-not-allowed" type="button" :disabled="formulaImageBusy" @click="selectFormulaImage">
                <AppIcon name="file-image" :size="20" class="shrink-0 text-fg-3" /><span class="stack gap-1 min-w-0"><b class="text-[12px] font-medium text-fg truncate">{{ formulaImageBusy ? '正在后台准备图片…' : '选择公式截图' }}</b><small class="text-[11px] leading-snug text-fg-3">PNG / JPG / WebP，原图不超过 12 MB</small></span>
              </button>
              <button v-else class="row gap-2.5 min-h-21 p-2.5 rounded-md bg-surface border border-dashed border-line text-left transition-colors hover:border-accent" type="button" aria-label="公式图片预览；右键可重新选择或移除" aria-haspopup="menu" :aria-expanded="Boolean(imageMenu)" @click="selectFormulaImage" @contextmenu="openImageMenu" @keydown="handleImagePreviewKeydown">
                <img :src="formulaImage.dataUrl" alt="当前确认后将发送给识别服务的公式图片" class="shrink-0 w-19 h-15 object-contain rounded-sm bg-well border border-line" />
                <span class="stack gap-1 min-w-0"><b class="text-[12px] font-medium text-fg truncate">{{ formulaImage.name }}</b><small class="text-[11px] leading-snug text-fg-3">实际发送：{{ formulaImage.width }} × {{ formulaImage.height }} JPEG · {{ formatFormulaImageSize(formulaImage.sentSize) }}</small></span>
              </button>
              <div class="stack justify-center gap-2 min-w-0">
                <label v-if="store.aiProfiles.length" class="stack gap-1.5"><span class="text-[12px] font-medium text-fg-2">识别服务</span><select v-model="formulaProfileId" class="field w-full h-8 text-[12px]" aria-label="公式图片识别服务"><option v-for="profile in store.aiProfiles" :key="profile.id" :value="profile.id">{{ profile.label }} · {{ profile.model }}</option></select></label>
                <p v-else class="text-[11px] leading-relaxed text-fg-3">尚未配置兼容服务。<RouterLink to="/settings?section=ai" class="text-accent hover:underline underline-offset-2">前往 AI 服务与凭据</RouterLink></p>
                <button class="btn-primary btn-sm" type="button" :disabled="!formulaImage || !formulaProfile || formulaImageBusy || formulaVisionRunning" @click="recognizeFormula"><AppIcon name="sparkle" :size="13" />{{ formulaVisionRunning ? '正在识别…' : '确认发送并生成草稿' }}</button>
              </div>
              <p class="row items-start gap-1.5 md:col-span-2 px-2.5 py-2 rounded-sm bg-accent-soft text-[11px] leading-relaxed text-fg-2"><AppIcon name="shield" :size="13" class="shrink-0 mt-0.5 text-accent" />预览就是将发送的图片；不会附带笔记正文、文件路径或其他资料。服务需要支持图片输入。</p>
              <p v-if="formulaVisionError" class="md:col-span-2 px-2.5 py-2 rounded-sm bg-danger-soft text-[11px] leading-relaxed text-danger" role="alert">{{ formulaVisionError }}</p>
            </div>
          </section>
          <div class="stack content-start gap-3 min-w-0">
            <div class="row gap-0.5 w-max max-w-full p-0.5 rounded-sm bg-well border border-line" role="group" aria-label="公式显示方式">
              <button type="button" class="h-7 px-2.5 rounded-[4px] text-[12px] transition-colors" :class="formulaMode === 'inline' ? 'bg-surface text-fg font-medium shadow-sm' : 'text-fg-3 hover:text-fg'" :aria-pressed="formulaMode === 'inline'" @click="formulaMode = 'inline'">行内公式</button>
              <button type="button" class="h-7 px-2.5 rounded-[4px] text-[12px] transition-colors" :class="formulaMode === 'block' ? 'bg-surface text-fg font-medium shadow-sm' : 'text-fg-3 hover:text-fg'" :aria-pressed="formulaMode === 'block'" @click="formulaMode = 'block'">独立公式块</button>
            </div>
            <label class="stack gap-1.5"><span class="text-[12px] font-medium text-fg-2">LaTeX 源码</span><textarea ref="formulaInput" v-model="formulaSource" class="field-area w-full min-h-33 font-mono text-[12px] text-accent" rows="6" maxlength="4000" spellcheck="false" placeholder="例如：\\frac{a}{b}" /></label>
            <div class="row flex-wrap gap-1.5" aria-label="常用公式片段"><button v-for="snippet in formulaSnippets" :key="snippet.label" type="button" class="btn-default btn-sm" :title="snippet.source" @click="insertFormulaSnippet(snippet.source)">{{ snippet.label }}</button></div>
          </div>
          <div class="stack content-start gap-3 min-w-0 p-4 rounded-md bg-surface-2 border border-line">
            <header class="row-between gap-2"><span class="text-[11px] font-semibold text-fg-3">即时预览</span><code class="font-mono text-[11px] font-semibold text-accent">{{ formulaMode === 'block' ? '$$…$$' : '$…$' }}</code></header>
            <div class="center min-h-37 overflow-auto p-3.5 rounded-sm bg-surface border border-line text-fg" v-html="formulaPreview"></div>
            <small class="text-[11px] leading-relaxed text-fg-3">预览只渲染当前短公式，不会触发整篇文档重排。</small>
          </div>
        </div>

        <footer class="row-between gap-4 shrink-0 px-5 h-14 border-t border-line bg-surface-2">
          <span class="row gap-1.5 min-w-0 text-[11px] text-fg-3"><kbd class="kbd">Esc</kbd> 取消 · 插入后会选中第一个可编辑内容</span>
          <div class="row gap-2 shrink-0"><button class="btn-default" type="button" @click="$emit('close')">取消</button><button class="btn-primary" type="button" @click="confirmInsertion">插入{{ panel === 'table' ? '表格' : '公式' }}</button></div>
        </footer>
        <div v-if="imageMenu" ref="imageMenuElement" class="menu-panel w-52" role="menu" aria-label="公式图片操作" :style="{ left: `${imageMenu.x}px`, top: `${imageMenu.y}px` }" @pointerdown.stop @keydown.stop="handleImageMenuKeydown">
          <button class="menu-item" role="menuitem" type="button" @click="selectFormulaImage"><span class="row gap-2"><AppIcon name="file-image" :size="13" />重新选择图片</span></button>
          <button class="menu-item" role="menuitem" type="button" @click="copyFormulaImageName"><span class="row gap-2"><AppIcon name="clipboard" :size="13" />复制图片名称</span></button>
          <button class="menu-item menu-item-danger" role="menuitem" type="button" @click="clearFormulaImage"><span class="row gap-2"><AppIcon name="trash" :size="13" />移除本次图片</span></button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
