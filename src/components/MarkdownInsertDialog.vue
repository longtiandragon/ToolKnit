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
    <div class="markdown-insert-backdrop" @mousedown.self="$emit('close')">
      <section ref="dialog" class="markdown-insert-dialog" role="dialog" aria-modal="true" aria-labelledby="markdown-insert-title" @mousedown.stop @keydown="handleKeydown">
        <header>
          <div>
            <p>Markdown 构建器</p>
            <h2 id="markdown-insert-title">插入表格或公式</h2>
            <span>生成的是标准 Markdown，可继续交给 Typora 或 Obsidian 打开。</span>
          </div>
          <button class="markdown-insert-close" type="button" aria-label="关闭插入器" @click="$emit('close')">×</button>
        </header>

        <nav class="markdown-insert-tabs" role="tablist" aria-label="插入类型">
          <button data-dialog-initial type="button" role="tab" :aria-selected="panel === 'table'" :class="{ active: panel === 'table' }" @click="setPanel('table')"><AppIcon name="table" :size="15" />表格</button>
          <button type="button" role="tab" :aria-selected="panel === 'formula'" :class="{ active: panel === 'formula' }" @click="setPanel('formula')"><AppIcon name="math" :size="15" />公式</button>
        </nav>

        <div v-if="panel === 'table'" class="markdown-insert-body markdown-table-builder" role="tabpanel">
          <div class="markdown-table-controls">
            <label><span>列数</span><div class="markdown-stepper"><button type="button" aria-label="减少列数" @click="changeDimension('columns', -1)">−</button><input v-model.number="columns" type="number" min="1" max="8" aria-label="表格列数" @change="normalizeDimensions" /><button type="button" aria-label="增加列数" @click="changeDimension('columns', 1)">＋</button></div></label>
            <label><span>内容行</span><div class="markdown-stepper"><button type="button" aria-label="减少内容行" @click="changeDimension('rows', -1)">−</button><input v-model.number="rows" type="number" min="1" max="12" aria-label="表格内容行数" @change="normalizeDimensions" /><button type="button" aria-label="增加内容行" @click="changeDimension('rows', 1)">＋</button></div></label>
            <label class="markdown-table-header-toggle"><input v-model="fillHeader" type="checkbox" /><span><b>填写表头</b><small>关闭后保留空白表头，仍兼容 GFM。</small></span></label>
            <fieldset><legend>列对齐</legend><div class="markdown-segments"><button v-for="item in [{ value: 'default', label: '默认' }, { value: 'left', label: '左' }, { value: 'center', label: '居中' }, { value: 'right', label: '右' }]" :key="item.value" type="button" :aria-pressed="alignment === item.value" :class="{ active: alignment === item.value }" @click="alignment = item.value as MarkdownTableAlignment">{{ item.label }}</button></div></fieldset>
          </div>
          <div class="markdown-table-preview" aria-label="表格结构预览">
            <header><span>结构预览</span><code>{{ columns }} × {{ rows + 1 }}</code></header>
            <div class="markdown-table-preview__grid" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(22px, 1fr))` }">
              <i v-for="column in columns" :key="`head-${column}`" class="head">{{ fillHeader ? column : '' }}</i>
              <i v-for="cell in tableCells" :key="cell"></i>
            </div>
            <small>最多 8 列、12 行，避免误操作生成超大表格。</small>
          </div>
        </div>

        <div v-else class="markdown-insert-body markdown-formula-builder" role="tabpanel">
          <section class="formula-vision-card" :class="{ open: formulaVisionOpen }">
            <button class="formula-vision-toggle" type="button" :aria-expanded="formulaVisionOpen" @click="formulaVisionOpen = !formulaVisionOpen">
              <span><AppIcon name="file-image" :size="15" /><b>从公式图片生成草稿</b><small>可选 AI · 发送前再次确认</small></span><i>{{ formulaVisionOpen ? '−' : '＋' }}</i>
            </button>
            <div v-if="formulaVisionOpen" class="formula-vision-body">
              <input ref="formulaImageInput" class="formula-vision-input" type="file" accept="image/png,image/jpeg,image/webp" @change="chooseFormulaImage" />
              <button v-if="!formulaImage" class="formula-image-picker" type="button" :disabled="formulaImageBusy" @click="selectFormulaImage">
                <AppIcon name="file-image" :size="20" /><span><b>{{ formulaImageBusy ? '正在后台准备图片…' : '选择公式截图' }}</b><small>PNG / JPG / WebP，原图不超过 12 MB</small></span>
              </button>
              <button v-else class="formula-image-preview" type="button" aria-label="公式图片预览；右键可重新选择或移除" aria-haspopup="menu" :aria-expanded="Boolean(imageMenu)" @click="selectFormulaImage" @contextmenu="openImageMenu" @keydown="handleImagePreviewKeydown">
                <img :src="formulaImage.dataUrl" alt="当前确认后将发送给识别服务的公式图片" />
                <span><b>{{ formulaImage.name }}</b><small>实际发送：{{ formulaImage.width }} × {{ formulaImage.height }} JPEG · {{ formatFormulaImageSize(formulaImage.sentSize) }}</small></span>
              </button>
              <div class="formula-vision-control">
                <label v-if="store.aiProfiles.length"><span>识别服务</span><select v-model="formulaProfileId" aria-label="公式图片识别服务"><option v-for="profile in store.aiProfiles" :key="profile.id" :value="profile.id">{{ profile.label }} · {{ profile.model }}</option></select></label>
                <p v-else>尚未配置兼容服务。<RouterLink to="/settings?section=ai">前往 AI 服务与凭据</RouterLink></p>
                <button class="primary-button" type="button" :disabled="!formulaImage || !formulaProfile || formulaImageBusy || formulaVisionRunning" @click="recognizeFormula"><AppIcon name="sparkle" :size="13" />{{ formulaVisionRunning ? '正在识别…' : '确认发送并生成草稿' }}</button>
              </div>
              <p class="formula-vision-privacy"><AppIcon name="shield" :size="13" />预览就是将发送的图片；不会附带笔记正文、文件路径或其他资料。服务需要支持图片输入。</p>
              <p v-if="formulaVisionError" class="formula-vision-error" role="alert">{{ formulaVisionError }}</p>
            </div>
          </section>
          <div class="markdown-formula-editor">
            <div class="markdown-segments markdown-formula-mode" role="group" aria-label="公式显示方式"><button type="button" :class="{ active: formulaMode === 'inline' }" :aria-pressed="formulaMode === 'inline'" @click="formulaMode = 'inline'">行内公式</button><button type="button" :class="{ active: formulaMode === 'block' }" :aria-pressed="formulaMode === 'block'" @click="formulaMode = 'block'">独立公式块</button></div>
            <label><span>LaTeX 源码</span><textarea ref="formulaInput" v-model="formulaSource" rows="6" maxlength="4000" spellcheck="false" placeholder="例如：\\frac{a}{b}" /></label>
            <div class="markdown-formula-snippets" aria-label="常用公式片段"><button v-for="snippet in formulaSnippets" :key="snippet.label" type="button" :title="snippet.source" @click="insertFormulaSnippet(snippet.source)">{{ snippet.label }}</button></div>
          </div>
          <div class="markdown-formula-preview">
            <header><span>即时预览</span><code>{{ formulaMode === 'block' ? '$$…$$' : '$…$' }}</code></header>
            <div class="markdown-formula-preview__surface" v-html="formulaPreview"></div>
            <small>预览只渲染当前短公式，不会触发整篇文档重排。</small>
          </div>
        </div>

        <footer><span><kbd>Esc</kbd> 取消 · 插入后会选中第一个可编辑内容</span><div><button class="quiet-button" type="button" @click="$emit('close')">取消</button><button class="primary-button" type="button" @click="confirmInsertion">插入{{ panel === 'table' ? '表格' : '公式' }}</button></div></footer>
        <div v-if="imageMenu" ref="imageMenuElement" class="formula-image-menu" role="menu" aria-label="公式图片操作" :style="{ left: `${imageMenu.x}px`, top: `${imageMenu.y}px` }" @pointerdown.stop @keydown.stop="handleImageMenuKeydown">
          <button role="menuitem" type="button" @click="selectFormulaImage"><AppIcon name="file-image" :size="13" />重新选择图片</button>
          <button role="menuitem" type="button" @click="copyFormulaImageName"><AppIcon name="clipboard" :size="13" />复制图片名称</button>
          <button role="menuitem" type="button" class="danger" @click="clearFormulaImage"><AppIcon name="trash" :size="13" />移除本次图片</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.markdown-insert-backdrop{position:fixed;inset:0;z-index:310;display:grid;place-items:center;padding:24px;background:var(--line-strong)}
.markdown-insert-dialog{width:min(780px,calc(100vw - 32px));max-height:min(760px,calc(100vh - 32px));overflow:auto;border:1px solid var(--accent-soft);border-radius:16px;color:var(--text);background:var(--surface);box-shadow:0 28px 80px var(--line-strong),0 4px 16px var(--line);font-family:var(--font-ui)}
.markdown-insert-dialog>header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:22px 24px 18px;border-bottom:1px solid var(--line-weak);background:linear-gradient(145deg,var(--accent-soft),transparent 56%)}
.markdown-insert-dialog>header>div{display:grid;gap:4px}.markdown-insert-dialog>header p{margin:0;color:var(--green-strong);font:700 9px var(--font-mono);letter-spacing:.1em}.markdown-insert-dialog>header h2{margin:0;font:710 22px/1.3 var(--font-display);letter-spacing:-.025em}.markdown-insert-dialog>header span{color:var(--muted);font-size:10px;line-height:1.55}
.markdown-insert-close{display:grid;width:31px;height:31px;flex:0 0 auto;place-items:center;border:1px solid transparent;border-radius:8px;color:var(--muted);background:transparent;font-size:20px}.markdown-insert-close:hover,.markdown-insert-close:focus-visible{border-color:var(--accent-soft);color:var(--green-strong);background:var(--green-bg)}
.markdown-insert-tabs{display:flex;gap:5px;padding:10px 24px 0}.markdown-insert-tabs button{display:inline-flex;min-height:34px;align-items:center;gap:7px;padding:0 13px;border:1px solid transparent;border-radius:8px;color:var(--text-secondary);background:transparent;font:680 11px var(--font-ui)}.markdown-insert-tabs button.active{border-color:var(--accent-soft);color:var(--green-strong);background:var(--green-bg)}
.markdown-insert-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,.9fr);gap:22px;padding:18px 24px 23px}.markdown-table-controls,.markdown-formula-editor{display:grid;align-content:start;gap:14px}.markdown-table-controls>label:not(.markdown-table-header-toggle),.markdown-formula-editor>label{display:grid;gap:7px}.markdown-table-controls label>span,.markdown-formula-editor label>span,.markdown-table-controls legend{color:var(--text-secondary);font:680 10px var(--font-ui)}
.markdown-stepper{display:grid;width:142px;grid-template-columns:36px 1fr 36px;overflow:hidden;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface)}.markdown-stepper button{border:0;color:var(--green-strong);background:var(--green-bg);font-size:16px}.markdown-stepper input{width:100%;min-width:0;border:0;border-inline:1px solid var(--line);outline:0;color:var(--text);background:transparent;font:700 11px var(--font-mono);text-align:center}.markdown-stepper input::-webkit-inner-spin-button{appearance:none}
.markdown-table-header-toggle{display:flex;align-items:flex-start;gap:9px;padding:11px;border:1px solid var(--line-weak);border-radius:9px;background:var(--surface-2)}.markdown-table-header-toggle input{margin-top:2px;accent-color:var(--green)}.markdown-table-header-toggle>span{display:grid;gap:3px}.markdown-table-header-toggle b{font-size:10px}.markdown-table-header-toggle small{color:var(--muted);font-size:9px;line-height:1.45}
.markdown-table-controls fieldset{display:grid;gap:7px;margin:0;padding:0;border:0}.markdown-table-controls legend{margin-bottom:7px}.markdown-segments{display:flex;width:max-content;max-width:100%;padding:3px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2)}.markdown-segments button{min-height:28px;padding:0 10px;border:0;border-radius:6px;color:var(--muted);background:transparent;font:650 9px var(--font-ui)}.markdown-segments button.active{color:var(--green-strong);background:var(--surface);box-shadow:0 1px 4px var(--accent-soft)}
.markdown-table-preview,.markdown-formula-preview{display:grid;min-width:0;align-content:start;gap:13px;padding:15px;border:1px solid var(--accent-soft);border-radius:11px;background:linear-gradient(145deg,var(--surface-2),var(--surface-2))}.markdown-table-preview>header,.markdown-formula-preview>header{display:flex;align-items:center;justify-content:space-between;color:var(--text-secondary);font:700 9px var(--font-mono);letter-spacing:.04em}.markdown-table-preview code,.markdown-formula-preview code{color:var(--green-strong);font:700 9px var(--font-mono)}.markdown-table-preview__grid{display:grid;gap:3px;min-height:132px;align-content:center}.markdown-table-preview__grid i{display:grid;min-height:22px;place-items:center;border:1px solid var(--accent-soft);border-radius:3px;background:var(--surface-2);color:var(--muted);font:700 8px var(--font-mono);font-style:normal}.markdown-table-preview__grid i.head{border-color:var(--accent-soft);color:var(--green-strong);background:var(--accent-soft)}.markdown-table-preview>small,.markdown-formula-preview>small{color:var(--muted);font-size:8.5px;line-height:1.5}
.markdown-formula-mode{margin-bottom:1px}.markdown-formula-editor textarea{box-sizing:border-box;width:100%;min-height:134px;resize:vertical;padding:11px 12px;border:1px solid var(--line-strong);border-radius:9px;outline:0;color:var(--accent);background:var(--surface);font:11px/1.65 var(--font-mono)}.markdown-formula-editor textarea:focus{border-color:var(--green);box-shadow:0 0 0 3px var(--accent-soft)}.markdown-formula-snippets{display:flex;flex-wrap:wrap;gap:6px}.markdown-formula-snippets button{min-height:29px;padding:0 9px;border:1px solid var(--line);border-radius:7px;color:var(--text-secondary);background:var(--surface);font:620 9px var(--font-ui)}.markdown-formula-snippets button:hover,.markdown-formula-snippets button:focus-visible{border-color:var(--accent-soft);color:var(--green-strong);background:var(--green-bg)}
.formula-vision-card{grid-column:1/-1;overflow:hidden;border:1px solid var(--accent-soft);border-radius:11px;background:var(--surface-2)}.formula-vision-card.open{border-color:var(--accent-soft);background:var(--surface-2)}.formula-vision-toggle{display:flex;width:100%;min-height:43px;align-items:center;justify-content:space-between;padding:0 13px;border:0;color:var(--text-secondary);background:transparent}.formula-vision-toggle>span{display:flex;align-items:center;gap:7px}.formula-vision-toggle b{font:690 10px var(--font-ui)}.formula-vision-toggle small{padding-left:7px;border-left:1px solid var(--line);color:var(--muted);font:9px var(--font-ui)}.formula-vision-toggle i{color:var(--green-strong);font:normal 16px var(--font-ui)}
.formula-vision-body{display:grid;grid-template-columns:minmax(210px,.9fr) minmax(240px,1.1fr);gap:10px;padding:0 12px 12px;border-top:1px solid var(--line-weak)}.formula-vision-input{position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none}.formula-image-picker,.formula-image-preview{display:flex;min-height:86px;align-items:center;gap:11px;margin-top:11px;padding:10px;border:1px dashed var(--accent-soft);border-radius:9px;color:var(--text-secondary);background:var(--surface);text-align:left}.formula-image-picker:hover,.formula-image-preview:hover{border-color:var(--green);background:var(--green-bg)}.formula-image-picker>span,.formula-image-preview>span{display:grid;min-width:0;gap:4px}.formula-image-picker b,.formula-image-preview b{overflow:hidden;font:670 9.5px var(--font-ui);text-overflow:ellipsis;white-space:nowrap}.formula-image-picker small,.formula-image-preview small{color:var(--muted);font:8.5px/1.45 var(--font-ui)}.formula-image-preview img{width:78px;height:62px;flex:0 0 auto;object-fit:contain;border:1px solid var(--line-weak);border-radius:6px;background:var(--surface)}
.formula-vision-control{display:grid;align-content:center;gap:8px;margin-top:11px}.formula-vision-control label{display:grid;gap:5px}.formula-vision-control label>span{color:var(--text-secondary);font:680 9px var(--font-ui)}.formula-vision-control select{box-sizing:border-box;width:100%;min-height:34px;padding:0 9px;border:1px solid var(--line-strong);border-radius:8px;color:var(--text);background:var(--surface);font:9px var(--font-ui)}.formula-vision-control>.primary-button{display:inline-flex;min-height:34px;align-items:center;justify-content:center;gap:7px;margin:0}.formula-vision-control p{margin:0;color:var(--muted);font:9px/1.55 var(--font-ui)}.formula-vision-control a{color:var(--green-strong)}.formula-vision-privacy,.formula-vision-error{grid-column:1/-1;display:flex;align-items:flex-start;gap:6px;margin:0;padding:8px 9px;border-radius:7px;color:var(--muted);background:var(--accent-soft);font:8.5px/1.5 var(--font-ui)}.formula-vision-error{color:var(--danger);background:var(--danger-soft)}
.formula-image-menu{position:fixed;z-index:380;display:grid;width:184px;padding:5px;border:1px solid var(--accent-soft);border-radius:9px;background:var(--surface);box-shadow:0 14px 36px var(--line-strong)}.formula-image-menu button{display:flex;min-height:33px;align-items:center;gap:8px;padding:0 9px;border:0;border-radius:6px;color:var(--text-secondary);background:transparent;font:9px var(--font-ui);text-align:left}.formula-image-menu button:hover,.formula-image-menu button:focus-visible{color:var(--green-strong);background:var(--green-bg)}.formula-image-menu button.danger{color:var(--danger)}.formula-image-menu button.danger:hover,.formula-image-menu button.danger:focus-visible{background:var(--danger-soft)}
.markdown-formula-preview__surface{display:grid;min-height:150px;place-items:center;overflow:auto;padding:14px;border:1px solid var(--accent-soft);border-radius:8px;background:var(--surface)}.markdown-formula-preview__surface :deep(p){margin:0}.markdown-formula-preview__surface :deep(.math-block){margin:0;max-width:100%;overflow:auto}.markdown-formula-preview__surface :deep(.katex){font-size:1.08em}
.markdown-insert-dialog>footer{display:flex;min-height:64px;align-items:center;justify-content:space-between;gap:16px;padding:11px 24px;border-top:1px solid var(--line-weak);background:var(--surface-2)}.markdown-insert-dialog>footer>span{color:var(--muted);font:9px var(--font-ui)}.markdown-insert-dialog>footer kbd{padding:2px 5px;border:1px solid var(--line);border-radius:4px;background:var(--surface);font:8px var(--font-mono)}.markdown-insert-dialog>footer>div{display:flex;gap:8px}.markdown-insert-dialog>footer button{min-height:34px;margin:0;padding:0 14px;font-size:10px}
.markdown-insert-dialog button:focus-visible,.markdown-insert-dialog input:focus-visible{outline:2px solid color-mix(in srgb,var(--green) 48%,transparent);outline-offset:2px}
@media(max-width:700px){.markdown-insert-backdrop{padding:10px}.markdown-insert-dialog{width:calc(100vw - 20px);max-height:calc(100vh - 20px)}.markdown-insert-body{grid-template-columns:1fr}.formula-vision-body{grid-template-columns:1fr}.formula-vision-control{margin-top:0}.formula-vision-toggle small{display:none}.markdown-insert-dialog>header,.markdown-insert-body,.markdown-insert-dialog>footer{padding-inline:16px}.markdown-insert-tabs{padding-inline:16px}.markdown-insert-dialog>footer{align-items:flex-end;flex-direction:column}.markdown-insert-dialog>footer>span{align-self:flex-start}}
</style>
