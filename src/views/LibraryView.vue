<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import FileDropZone from '@/components/FileDropZone.vue'
import { blobToDataUrl, readClipboardPayload } from '@/lib/clipboard'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { filterSources, SOURCE_TAG_LIMIT, sourceFilterFromQuery, sourcePageFromQuery, sourceSearchFromQuery, sourceTagsFromInput, type SourceFilter } from '@/lib/source-list'
import { toolActions } from '@/lib/tools'
import { fixedRowVirtualWindow } from '@/lib/virtual-window'
import { sourceHandoffRoute, type SourceHandoffDestination } from '@/lib/source-handoff'
import { sourceNoteScaffold, sourceNoteTitle } from '@/lib/source-note'
import { stageLocalFileHandoff } from '@/lib/local-file-handoff'
import { formulaDraftScaffold } from '@/lib/formula-draft'
import { nextAvailableNoteTitle } from '@/lib/note-template'
import type { Source, SourceAnchor, SourceKind } from '@/types'
import { useWorkbenchStore } from '@/stores/workbench'
import { isDesktop, readDesktopInputFile, revealDesktopFile } from '@/lib/native'

const store = useWorkbenchStore()
// PDF.js is substantial; opening the library must stay fast for a plain text
// or image workflow. The source renderer loads only after an item is selected.
const SourceCanvas = defineAsyncComponent(() => import('@/components/SourceCanvas.vue'))
const router = useRouter()
const route = useRoute()
const fileInput = ref<HTMLInputElement>()
const dragging = ref(false)
const selected = ref<Source | null>(null)
const filter = ref<SourceFilter>(sourceFilterFromQuery(route.query.filter))
const query = ref(sourceSearchFromQuery(route.query.q))
const appliedQuery = ref(query.value)
const notice = ref('')
const selectedBbox = ref<[number, number, number, number] | null>(null)
const selectedPage = ref(0)
const selectedCropId = ref<string>()
const selectedLoading = ref(false)
const handoffBusy = ref(false)
const sourceTagSaving = ref(false)
const newSourceTag = ref('')
const sourceMenu = ref<{ source: Source; x: number; y: number }>()
const sourceMenuElement = ref<HTMLElement>()
const sourceListViewport = ref<HTMLElement>()
const sourceListScrollTop = ref(0)
const sourceListViewportHeight = ref(0)
const desktop = isDesktop()
const libraryFiles=ref<File[]>(store.consumeIntakeFiles())
const libraryImporting = ref(false)
const BROWSER_LIBRARY_FILE_LIMIT = 64 * 1024 * 1024
const BROWSER_LIBRARY_TOTAL_LIMIT = 192 * 1024 * 1024
const filtered = computed(() => filterSources(store.sources, filter.value, appliedQuery.value))
const sourceStats = computed(() => {
  const counts: Record<SourceKind, number> = { image: 0, pdf: 0, code: 0, text: 0 }
  for (const source of store.sources) counts[source.kind] += 1
  return counts
})
const libraryWorkflows = [
  { id: 'create-note', kind: 'all', icon: 'file-text', label: '整理笔记', detail: '原文、页码与选区相连' },
  { id: 'create-question', kind: 'all', icon: 'review', label: '建立错题', detail: '题干、答案与来源关联' },
  { id: 'image-edit', kind: 'image', icon: 'palette', label: '标注图片', detail: '裁剪、箭头与文字' },
  { id: 'ocr', kind: 'image', icon: 'file-text', label: '识别文字', detail: '调用 Windows 本机 OCR' },
  { id: 'formula', kind: 'pdf', icon: 'math', label: '整理公式', detail: '保留页码与选区来源' },
  { id: 'code-image', kind: 'code', icon: 'terminal', label: '分享代码', detail: '连续长图，不截断' },
] as const
const toolActionById = new Map(toolActions.map((item) => [item.id, item]))
const searchPending = computed(() => query.value.trim() !== appliedQuery.value.trim())
const sourceRowHeight = 68
const sourceListOverscan = 8
const sourceWindow = computed(() => fixedRowVirtualWindow(filtered.value.length, sourceListScrollTop.value, sourceListViewportHeight.value, sourceRowHeight, sourceListOverscan))
const visibleSources = computed(() => filtered.value.slice(sourceWindow.value.start, sourceWindow.value.end))
const sourcePage = computed(() => sourcePageFromQuery(route.query.page))

let sourceSearchTimer: number | undefined
let sourceListFrame: number | undefined
let sourceListResizeObserver: ResizeObserver | undefined
let selectionRevision = 0

watch([() => route.query.source, () => store.sources.length], () => {
  const sourceId = typeof route.query.source === 'string' ? route.query.source : ''
  const target = store.sources.find((source) => source.id === sourceId)
  if (target && selected.value?.id !== target.id) void selectSource(target, { syncRoute: false, initialPage: sourcePage.value })
  else if (!sourceId && selected.value) {
    selectionRevision += 1
    selected.value = null
    selectedLoading.value = false
  }
}, { immediate: true })
watch([() => route.query.filter, () => route.query.q], () => {
  const nextFilter = sourceFilterFromQuery(route.query.filter)
  const nextQuery = sourceSearchFromQuery(route.query.q)
  if (filter.value !== nextFilter) filter.value = nextFilter
  if (query.value !== nextQuery) {
    window.clearTimeout(sourceSearchTimer)
    query.value = nextQuery
    appliedQuery.value = nextQuery
  }
})
watch(sourcePage, (page) => { selectedPage.value = page })
watch(libraryFiles,files=>{if(files.length)ingest(files)},{immediate:true})
watch(query, (value) => {
  window.clearTimeout(sourceSearchTimer)
  sourceSearchTimer = window.setTimeout(() => {
    appliedQuery.value = value
    void syncLibraryRoute({ q: value.trim() || undefined })
  }, 140)
})
watch(filter, (value) => {
  resetSourceListScroll()
  void syncLibraryRoute({ filter: value === 'all' ? undefined : value })
})
watch(appliedQuery, () => resetSourceListScroll())
watch(() => selected.value?.id, () => { newSourceTag.value = '' })
watch(filtered, () => {
  const maxScroll = Math.max(0, filtered.value.length * sourceRowHeight - sourceListViewportHeight.value)
  if (sourceListScrollTop.value > maxScroll) resetSourceListScroll()
  void nextTick(syncSourceListViewport)
}, { flush: 'post' })

let sourceMenuTrigger: HTMLElement | undefined
async function syncLibraryRoute(patch: Record<string, string | undefined>) {
  const nextQuery = { ...route.query }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete nextQuery[key]
    else nextQuery[key] = value
  }
  const unchanged = Object.keys(nextQuery).length === Object.keys(route.query).length
    && Object.entries(nextQuery).every(([key, value]) => route.query[key] === value)
  if (!unchanged) await router.replace({ query: nextQuery })
}
async function selectSource(source: Source, options: { syncRoute?: boolean; initialPage?: number } = {}) {
  const revision = ++selectionRevision
  ensureSourceVisible(source.id)
  const initialPage = options.initialPage ?? 0
  selected.value=source;selectedLoading.value=true;selectedBbox.value=null;selectedCropId.value=undefined;selectedPage.value=initialPage;store.touchSource(source.id)
  if (options.syncRoute !== false) await syncLibraryRoute({ source: source.id, page: initialPage ? String(initialPage) : undefined })
  try {
    const detail = await store.loadSourceDetail(source.id)
    if (revision === selectionRevision && detail) selected.value = detail
  } catch (error) {
    if (revision === selectionRevision) notice.value = error instanceof Error ? error.message : '无法读取本地资料详情。'
  } finally {
    if (revision === selectionRevision) selectedLoading.value=false
  }
}

function syncSourceListViewport() {
  sourceListViewportHeight.value = sourceListViewport.value?.clientHeight ?? 0
}
function handleSourceListScroll() {
  if (sourceListFrame) return
  sourceListFrame = window.requestAnimationFrame(() => {
    sourceListScrollTop.value = sourceListViewport.value?.scrollTop ?? 0
    sourceListFrame = undefined
  })
}
function resetSourceListScroll() {
  sourceListScrollTop.value = 0
  if (sourceListViewport.value) sourceListViewport.value.scrollTop = 0
  void nextTick(syncSourceListViewport)
}
function ensureSourceVisible(id: string) {
  void nextTick(() => {
    const rowIndex = filtered.value.findIndex((source) => source.id === id)
    const viewport = sourceListViewport.value
    if (rowIndex < 0 || !viewport) return
    const rowTop = rowIndex * sourceRowHeight
    const rowBottom = rowTop + sourceRowHeight
    if (rowTop >= viewport.scrollTop && rowBottom <= viewport.scrollTop + viewport.clientHeight) return
    const nextTop = Math.max(0, rowTop - Math.max(0, (viewport.clientHeight - sourceRowHeight) / 2))
    viewport.scrollTop = nextTop
    sourceListScrollTop.value = nextTop
  })
}
function clearSearch() {
  window.clearTimeout(sourceSearchTimer)
  query.value = ''
  appliedQuery.value = ''
  void syncLibraryRoute({ q: undefined })
}

function handleSourcePage(page: number) {
  selectedPage.value = page
  void syncLibraryRoute({ page: page ? String(page) : undefined })
}

function kindOf(file: File): SourceKind {
  if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) return 'pdf'
  if (file.type.startsWith('image/')) return 'image'
  if (/\.(c|cc|cpp|h|hpp|py|java|js|ts|rs|go|vue|md)$/i.test(file.name)) return 'code'
  return 'text'
}

async function ingest(files: FileList | File[]) {
  let last: { source: Source; duplicate: boolean } | undefined
  let duplicateCount = 0
  for (const file of Array.from(files)) {
    const kind = kindOf(file)
    const preview = kind === 'image' || kind === 'pdf' ? await blobToDataUrl(file) : undefined
    const content = kind === 'image' || kind === 'pdf' ? undefined : await file.text()
    last = await store.addSource({ name: file.name, kind, mime: file.type || 'application/octet-stream', size: file.size, preview, content, pageCount: kind === 'pdf' ? undefined : 1, originalPath:(file as File&{path?:string}).path })
    if (last.duplicate) duplicateCount += 1
  }
  if (!last) return
  // Reading files remains sequential to avoid a burst of data URLs in memory,
  // while the costly PDF/image preview is created only once for the batch.
  await selectSource(last.source)
  notice.value = files.length === 1
    ? (last.duplicate ? `“${last.source.name}” 已在资料库中，已跳到原件。` : `已收进资料库：${last.source.name}`)
    : `已收进 ${files.length} 份资料${duplicateCount ? `，其中 ${duplicateCount} 份为已有原件` : ''}；正在预览最后一份。`
}

async function onFiles(event: Event) { const files = (event.target as HTMLInputElement).files; if (files) await ingest(files) }
async function importDesktopPaths(paths: string[]) {
  if (!paths.length || libraryImporting.value) return
  libraryImporting.value = true
  notice.value = paths.length === 1 ? '正在复制资料并建立本地索引…' : `正在复制 ${paths.length} 份资料并建立本地索引…`
  try {
    let last: { source: Source; duplicate: boolean } | undefined
    let duplicateCount = 0
    for (const path of paths) {
      last = await store.importDesktopSource(path)
      if (last.duplicate) duplicateCount += 1
    }
    if (!last) return
    await selectSource(last.source)
    notice.value = paths.length === 1
      ? (last.duplicate ? `“${last.source.name}” 已在资料库中，已跳到原件。` : `已直接复制到本地资料库：${last.source.name}`)
      : `已复制 ${paths.length} 份资料到本地库${duplicateCount ? `，其中 ${duplicateCount} 份为已有原件` : ''}；正在预览最后一份。`
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '无法从磁盘导入资料。'
  } finally {
    libraryImporting.value = false
  }
}
async function chooseImport() {
  if (!desktop) { fileInput.value?.click(); return }
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selectedPaths = await open({
      title: '直接导入到 Knitspace Vault', multiple: true,
      filters: [{ name: '资料文件', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'md', 'txt', 'c', 'cc', 'cpp', 'h', 'hpp', 'py', 'java', 'js', 'jsx', 'ts', 'tsx', 'rs', 'go', 'vue'] }],
    })
    const paths = typeof selectedPaths === 'string' ? [selectedPaths] : selectedPaths ?? []
    await importDesktopPaths(paths)
  } catch (error) { notice.value = error instanceof Error ? error.message : '无法从磁盘导入资料。' }
}
async function paste() {
  const payload = await readClipboardPayload(); if (!payload) { notice.value = '浏览器没有授予剪贴板权限，试试拖入文件。'; return }
  const { source } = await store.addSource({ name: payload.name, kind: payload.kind, mime: payload.kind === 'image' ? 'image/png' : 'text/plain', size: (payload.content ?? payload.preview ?? '').length, content: payload.content, preview: payload.preview })
  await selectSource(source); notice.value = '已从剪贴板收集。'
}
function sourceDesktopPath(source: Source) {
  return desktop ? source.managedPath ?? source.originalPath : undefined
}
async function saveSelectedSourceTags(tags: string[]) {
  if (!selected.value || sourceTagSaving.value) return false
  sourceTagSaving.value = true
  try {
    selected.value.tags = await store.updateSourceTags(selected.value.id, tags)
    notice.value = selected.value.tags.length ? '资料标签已保存到本地索引。' : '资料标签已清空。'
    return true
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '无法保存资料标签。'
    return false
  } finally { sourceTagSaving.value = false }
}
async function addSelectedSourceTags() {
  if (!selected.value) return
  const additions = sourceTagsFromInput(newSourceTag.value)
  if (!additions.length) {
    notice.value = '请输入一个标签；多个标签可用逗号分隔。'
    return
  }
  if (await saveSelectedSourceTags([...selected.value.tags, ...additions])) newSourceTag.value = ''
}
async function removeSelectedSourceTag(tag: string) {
  if (!selected.value) return
  await saveSelectedSourceTags(selected.value.tags.filter((item) => item !== tag))
}
async function sourceFileForHandoff(source: Source) {
  if (desktop && source.managedPath) return readDesktopInputFile(source.managedPath)
  if (source.preview) {
    const response = await fetch(source.preview)
    return new File([await response.blob()], source.name, { type: source.mime || 'application/octet-stream' })
  }
  if (source.content !== undefined) return new File([source.content], source.name, { type: source.mime || 'text/plain' })
  throw new Error('这份资料还没有可用于下一步的本地内容。')
}

async function stageSourceForTool(source: Source, destination: SourceHandoffDestination) {
  if (handoffBusy.value) return
  handoffBusy.value = true
  notice.value = destination === 'visual' ? '正在准备图片编辑…' : destination === 'ocr' ? '正在打开本机文字识别…' : '正在带入文件工具…'
  try {
    const target = sourceHandoffRoute(source.kind, destination)
    if (!target) throw new Error('这份资料不支持该处理方式。')
    if (destination === 'ocr') {
      const path = sourceDesktopPath(source)
      if (!path) throw new Error('离线 OCR 需要桌面版中的本地图片。')
      stageLocalFileHandoff('ocr', [path], '本地资料库')
      await router.push(target)
      return
    }
    const file = await sourceFileForHandoff(source)
    store.stageIntake([file])
    await router.push(target)
  } finally { handoffBusy.value = false }
}

async function openFormulaDraft(source: Source, anchor?: SourceAnchor) {
  const scaffold = formulaDraftScaffold(source, anchor)
  const note = store.createNote(scaffold.title, scaffold.folder, scaffold.content)
  const next = {
    ...note,
    subject: scaffold.subject,
    tags: scaffold.tags,
    sourceAnchor: scaffold.sourceAnchor,
  }
  store.saveDocument(next)
  store.addActivity('source', '从资料整理公式草稿', source.name, '/documents', next.id)
  await router.push({ path: '/documents', query: { kind: 'note', document: next.id, mode: 'split', insert: 'formula' } })
}

function currentSourceAnchor(source: Source): SourceAnchor {
  if (selected.value?.id !== source.id) return { sourceId: source.id, pageIndex: 0, bbox: [0, 0, 1, 1] }
  return {
    sourceId: source.id,
    pageIndex: selectedPage.value,
    bbox: selectedBbox.value ?? [0, 0, 1, 1],
    ...(selectedCropId.value ? { cropAssetId: selectedCropId.value } : {}),
  }
}

async function createSourceNote(source: Source, anchor = currentSourceAnchor(source)) {
  const detail = source.content === undefined && (source.kind === 'code' || source.kind === 'text')
    ? await store.loadSourceDetail(source.id)
    : source
  if (!detail) throw new Error('无法读取这份资料的本地正文。')
  const title = nextAvailableNoteTitle(sourceNoteTitle(detail), store.documents.map((document) => document.title))
  const scaffold = sourceNoteScaffold(detail, anchor, title)
  const note = store.createNote(scaffold.title, scaffold.folder, scaffold.content)
  const next = { ...note, subject: scaffold.subject, tags: scaffold.tags, sourceAnchor: scaffold.sourceAnchor }
  store.saveDocument(next)
  store.addActivity('source', '从资料整理为笔记', source.name, '/documents', next.id)
  await router.push({ path: '/documents', query: { kind: 'note', document: next.id, mode: 'split' } })
}

async function action(source: Source, id: string) {
  const anchor = currentSourceAnchor(source)
  if (id === 'create-note') {
    try { await createSourceNote(source, anchor) }
    catch (error) { notice.value = error instanceof Error ? error.message : '无法把这份资料整理为笔记。' }
  }
  else if (id === 'create-question') {
    const question = store.createQuestion(source, anchor)
    await router.push({ path: '/documents', query: { kind: 'question', document: question.id, mode: 'edit' } })
  }
  else if (id === 'image-edit') {
    try { await stageSourceForTool(source, 'visual') }
    catch (error) { notice.value = error instanceof Error ? error.message : '无法把这张图片带入编辑器。' }
  }
  else if (id === 'code-image') {
    try { store.prepareCodeImage(source); router.push('/code-image') }
    catch (error) { notice.value = error instanceof Error ? error.message : '无法读取这份代码。' }
  }
  else if (id === 'ocr') {
    try { await stageSourceForTool(source, 'ocr') }
    catch (error) { notice.value = error instanceof Error ? error.message : '无法把这张图片带入离线 OCR。' }
  }
  else if (id === 'formula') {
    await openFormulaDraft(source, anchor)
  }
  else if (id === 'batch') {
    try { await stageSourceForTool(source, 'batch') }
    catch (error) { notice.value = error instanceof Error ? error.message : '无法把这份资料带入文件工具。' }
  }
  else { notice.value = '这个处理动作尚未与当前资料类型连接。' }
}
function workflowAcceptsSource(workflow: typeof libraryWorkflows[number], source: Source | null) {
  return Boolean(source && toolActionById.get(workflow.id)?.accepts.includes(source.kind))
}
async function startLibraryWorkflow(workflow: typeof libraryWorkflows[number]) {
  if (workflowAcceptsSource(workflow, selected.value)) {
    await action(selected.value!, workflow.id)
    return
  }
  const targetFilter: SourceFilter = workflow.kind === 'all' ? 'all' : workflow.kind
  filter.value = targetFilter
  const firstCompatible = store.sources.find((source) => workflowAcceptsSource(workflow, source))
  if (firstCompatible) {
    await selectSource(firstCompatible)
    notice.value = `已定位到可用于“${workflow.label}”的资料；确认预览或选区后，再点击右侧操作。`
  } else {
    notice.value = `“${workflow.label}”需要${workflow.kind === 'image' ? '图片' : workflow.kind === 'pdf' ? 'PDF' : workflow.kind === 'code' ? '代码或文本' : '一份'}资料；请先从磁盘导入或拖入文件。`
  }
}
function captureSelection(bbox: [number, number, number, number], crop?: string) { selectedBbox.value = bbox; selectedCropId.value = selected.value ? store.attachCrop(selected.value.id, crop) : undefined; notice.value = '已记录选区。整理为笔记或错题后，都可以回到这个位置。' }
function clearCapturedSelection() { selectedBbox.value = null; selectedCropId.value = undefined; notice.value = '已清除当前选区。' }
function actionIcon(id: string) { return id === 'create-note' ? 'file-text' : id === 'create-question' ? 'review' : id === 'image-edit' ? 'palette' : id === 'ocr' ? 'file-text' : id === 'formula' ? 'math' : id === 'code-image' ? 'terminal' : 'toolbox' }
function closeSourceMenu(restoreFocus = false) {
  sourceMenu.value = undefined
  if (restoreFocus) sourceMenuTrigger?.focus({ preventScroll: true })
}
function sourceMenuActionCount(source: Source) {
  const kindActions = source.kind === 'image' ? 4 : source.kind === 'pdf' ? 2 : source.kind === 'code' || source.kind === 'text' ? 1 : 0
  return 5 + kindActions + (sourceDesktopPath(source) ? 2 : 0) + (store.isContentRecent('source', source.id) ? 1 : 0)
}
function sourceMenuHeight(source: Source) { return 38 + sourceMenuActionCount(source) * 35 }
function showSourceMenu(source: Source, x: number, y: number, trigger: HTMLElement) {
  sourceMenuTrigger = trigger
  sourceMenu.value = { source, ...clampMenuPosition(x, y, { menuWidth: 218, menuHeight: sourceMenuHeight(source), margin: 12 }) }
  void nextTick(() => sourceMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}
function openSourceMenu(event: MouseEvent, source: Source) {
  showSourceMenu(source, event.clientX, event.clientY, event.currentTarget as HTMLElement)
}
function openSourceMenuFromKeyboard(source: Source, trigger: HTMLElement) {
  const bounds = trigger.getBoundingClientRect()
  showSourceMenu(source, bounds.right + 6, bounds.top + 6, trigger)
}
function handleSourceKeydown(event: KeyboardEvent, source: Source) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  openSourceMenuFromKeyboard(source, event.currentTarget as HTMLElement)
}
function handleSourceMenuKeydown(event: KeyboardEvent) {
  const menuItems = [...(sourceMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (event.key === 'Escape') {
    event.preventDefault()
    closeSourceMenu(true)
    return
  }
  const nextIndex = nextMenuItemIndex(event.key, menuItems.indexOf(document.activeElement as HTMLButtonElement), menuItems.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  menuItems[nextIndex]?.focus()
}
async function runSourceMenu(actionId: 'open' | 'favorite' | 'remove-recent' | 'note' | 'question' | 'image-edit' | 'ocr' | 'formula' | 'code-image' | 'batch' | 'copy-name' | 'copy-path' | 'reveal') {
  const source = sourceMenu.value?.source
  closeSourceMenu()
  if (!source) return
  if (actionId === 'open') { await selectSource(source); return }
  if (actionId === 'favorite') {
    try {
      const favorite = await store.toggleContentFavorite('source', source.id)
      notice.value = favorite ? '已收藏资料；可从今天、知识库或 Ctrl K 快速返回。' : '已取消收藏；资料本身没有被删除。'
    } catch (error) { notice.value = error instanceof Error ? error.message : '收藏状态没有保存。' }
    return
  }
  if (actionId === 'remove-recent') {
    try { await store.removeFromContentRecents('source', source.id); notice.value = '已从最近使用移除；资料本身没有被删除。' }
    catch (error) { notice.value = error instanceof Error ? error.message : '最近使用没有更新。' }
    return
  }
  if (actionId === 'copy-name') {
    try { await navigator.clipboard.writeText(source.name); notice.value = '已复制资料名称。' }
    catch { notice.value = '无法访问系统剪贴板。' }
    return
  }
  const sourcePath = sourceDesktopPath(source)
  if (actionId === 'copy-path') {
    if (!sourcePath) return
    try { await navigator.clipboard.writeText(sourcePath); notice.value = '已复制 Vault 文件路径。' }
    catch { notice.value = '无法访问系统剪贴板。' }
    return
  }
  if (actionId === 'reveal') {
    if (!sourcePath) return
    try { await revealDesktopFile(sourcePath); notice.value = '已在文件夹中定位资料。' }
    catch (error) { notice.value = error instanceof Error ? error.message : '无法在文件夹中定位资料。' }
    return
  }
  const detail = await store.loadSourceDetail(source.id)
  if (!detail) return
  if (actionId === 'note') {
    try { await createSourceNote(detail, currentSourceAnchor(detail)) }
    catch (error) { notice.value = error instanceof Error ? error.message : '无法把这份资料整理为笔记。' }
    return
  }
  if (actionId === 'question') {
    const question = store.createQuestion(detail, currentSourceAnchor(detail))
    await router.push({ path: '/documents', query: { kind: 'question', document: question.id, mode: 'edit' } })
    return
  }
  if (actionId === 'image-edit') {
    try { await stageSourceForTool(detail, 'visual') }
    catch (error) { notice.value = error instanceof Error ? error.message : '无法把这张图片带入编辑器。' }
    return
  }
  if (actionId === 'ocr') {
    try { await stageSourceForTool(detail, 'ocr') }
    catch (error) { notice.value = error instanceof Error ? error.message : '无法把这张图片带入离线 OCR。' }
    return
  }
  if (actionId === 'formula') {
    await openFormulaDraft(detail, currentSourceAnchor(detail))
    return
  }
  if (actionId === 'batch') {
    try { await stageSourceForTool(detail, 'batch') }
    catch (error) { notice.value = error instanceof Error ? error.message : '无法把这份资料带入文件工具。' }
    return
  }
  try { store.prepareCodeImage(detail); router.push('/code-image') }
  catch (error) { notice.value = error instanceof Error ? error.message : '这份资料不能作为代码分享。' }
}
function closeSourceMenuOnOutsideClick() { closeSourceMenu() }
function closeLibraryContextMenus() { closeSourceMenu() }
onMounted(() => {
  window.addEventListener('click', closeSourceMenuOnOutsideClick)
  window.addEventListener('knitspace:close-context-menus', closeLibraryContextMenus)
  window.addEventListener('resize', syncSourceListViewport)
  void nextTick(() => {
    syncSourceListViewport()
    if ('ResizeObserver' in window && sourceListViewport.value) {
      sourceListResizeObserver = new ResizeObserver(syncSourceListViewport)
      sourceListResizeObserver.observe(sourceListViewport.value)
    }
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('click', closeSourceMenuOnOutsideClick)
  window.removeEventListener('knitspace:close-context-menus', closeLibraryContextMenus)
  window.removeEventListener('resize', syncSourceListViewport)
  window.clearTimeout(sourceSearchTimer)
  if (sourceListFrame) window.cancelAnimationFrame(sourceListFrame)
  sourceListResizeObserver?.disconnect()
})
</script>

<template>
  <div class="library page-enter mx-auto w-full max-w-320 px-8 py-6">
    <PageHeader
      title="收集与归档"
      subtitle="原件复制进库并留下指纹,之后移动或改名也能找回来源"
      :stats="[
        { label: '已索引', value: store.sources.length },
        { label: '图片', value: sourceStats.image },
        { label: 'PDF', value: sourceStats.pdf },
        { label: '代码', value: sourceStats.code },
        { label: '文本', value: sourceStats.text },
      ]"
    >
      <template #actions>
        <button class="btn-default" @click="paste"><AppIcon name="clipboard" :size="15" />读取剪贴板</button>
        <button class="btn-primary" @click="chooseImport"><AppIcon name="plus" :size="15" />{{ desktop ? '从磁盘导入' : '导入文件' }}</button>
      </template>
    </PageHeader>
    <input ref="fileInput" class="visually-hidden" type="file" multiple accept="image/*,.pdf,.md,.txt,.cpp,.c,.py,.java,.js,.ts,.rs,.go,.vue" @change="onFiles">
    <p v-if="notice" class="notice">{{ notice }}</p>
    <section class="library-workbench__inbox" aria-label="资料收件入口"><FileDropZone v-model="libraryFiles" accept="image/*,.pdf,.md,.txt,.cpp,.c,.py,.java,.js,.ts,.rs,.go,.vue" :disabled="libraryImporting" :desktop-path-only="desktop" :max-file-bytes="desktop ? undefined : BROWSER_LIBRARY_FILE_LIMIT" :max-total-bytes="desktop ? undefined : BROWSER_LIBRARY_TOTAL_LIMIT" title="拖入资料，立即建立本地索引" :hint="desktop ? '按路径直接复制到 Vault，不把整份文件塞进界面内存' : '图片 · PDF · 文本 · 源代码；单次最多 192 MB'" @desktop-paths="importDesktopPaths" @request-desktop-choose="chooseImport" @error="notice=$event"/></section>
    <section class="library-workbench__workflows" aria-labelledby="library-workflows-title">
      <header><div><p class="eyebrow">下一步</p><h3 id="library-workflows-title">资料收进来以后</h3></div><p>{{ selected ? `当前资料：${selected.name}` : '选择工作流，Knitspace 会帮你定位合适的资料。' }}</p></header>
      <div>
        <button v-for="workflow in libraryWorkflows" :key="workflow.id" :class="{ ready: workflowAcceptsSource(workflow, selected) }" @click="startLibraryWorkflow(workflow)">
          <b><AppIcon :name="workflow.icon" :size="16" /></b>
          <span><strong>{{ workflow.label }}</strong><small>{{ workflow.detail }}</small></span>
          <i>{{ workflowAcceptsSource(workflow, selected) ? '用当前资料' : workflow.kind === 'all' ? '选择资料' : `查看${workflow.kind === 'image' ? '图片' : workflow.kind === 'pdf' ? 'PDF' : '代码'}` }}</i>
        </button>
      </div>
    </section>
    <div class="library-layout">
      <section class="source-list panel">
        <div class="filter-row" aria-label="资料类型筛选"><button v-for="item in [['all','全部'],['image','图片'],['pdf','PDF'],['code','代码'],['text','文本']] as const" :key="item[0]" :class="{ active: filter === item[0] }" @click="filter = item[0]">{{ item[1] }}</button></div>
        <label class="source-search"><span class="visually-hidden">搜索资料库</span><AppIcon name="search" :size="14" /><input v-model="query" placeholder="名称、类型或标签…" /></label>
        <div class="source-list__summary" aria-live="polite"><span>{{ filtered.length }} 份资料{{ searchPending ? ' · 正在筛选' : '' }}</span><button v-if="query.trim()" class="quiet-button" @click="clearSearch">清除</button></div>
        <div ref="sourceListViewport" class="source-list__rows" :aria-busy="searchPending" aria-label="资料列表" @scroll.passive="handleSourceListScroll">
          <div v-if="filtered.length" class="source-list__spacer" :style="{ height: `${sourceWindow.before}px` }" aria-hidden="true"></div>
          <button v-for="source in visibleSources" :key="source.id" v-memo="[source.id, source.name, source.kind, source.size, source.importedAt, selected?.id === source.id, store.isContentFavorite('source', source.id)]" class="source-row" :class="{ selected: selected?.id === source.id }" aria-haspopup="menu" :aria-expanded="sourceMenu?.source.id === source.id" :aria-label="`${source.name}；右键或 Shift 加 F10 打开操作`" @click="selectSource(source)" @contextmenu.prevent.stop="openSourceMenu($event, source)" @keydown="handleSourceKeydown($event, source)"><span class="source-icon"><AppIcon :name="source.kind === 'image' ? 'file-image' : source.kind === 'pdf' ? 'file-pdf' : source.kind === 'code' ? 'file-code' : 'file-text'" :size="18" /></span><div><h4>{{ source.name }}</h4><p>{{ Math.max(1, Math.round(source.size / 1024)) }} KB · {{ new Date(source.importedAt).toLocaleDateString('zh-CN') }}</p></div><AppIcon v-if="store.isContentFavorite('source', source.id)" class="source-favorite-marker" name="star" :size="12" /></button>
          <div v-if="filtered.length" class="source-list__spacer" :style="{ height: `${sourceWindow.after}px` }" aria-hidden="true"></div>
          <div v-if="!filtered.length" class="library-list-empty"><AppIcon :name="query.trim() || filter !== 'all' ? 'search' : 'inbox'" :size="20" /><b>{{ query.trim() || filter !== 'all' ? '没有匹配的资料' : '还没有资料' }}</b><span>{{ query.trim() || filter !== 'all' ? '试试更换关键词或资料类型。' : '拖入文件或从剪贴板读取。' }}</span><button v-if="query.trim() || filter !== 'all'" class="quiet-button" @click="clearSearch(); filter = 'all'">清除筛选</button></div>
        </div>
      </section>
      <section class="source-detail panel">
        <template v-if="selected"><div class="detail-title"><div><p class="eyebrow">{{ selected.kind.toUpperCase() }}</p><h3>{{ selected.name }}</h3></div><span class="hash" :title="selected.sha256">#{{ selected.sha256?.slice(0, 8) }}</span></div>
          <div v-if="selectedLoading" class="source-preview source-preview__loading" role="status" aria-live="polite">
            <AppIcon name="inbox" :size="19" /><span>正在读取本地资料…</span>
          </div>
          <div v-else class="source-preview">
            <Suspense>
              <template #default>
                <SourceCanvas :source="selected" :initial-page="sourcePage" @select="captureSelection" @clear="clearCapturedSelection" @page="handleSourcePage" />
              </template>
              <template #fallback>
                <div class="source-preview__loading" role="status" aria-live="polite">
                  <AppIcon name="inbox" :size="19" />
                  <span>正在准备本地预览…</span>
                </div>
              </template>
            </Suspense>
          </div>
          <div class="action-grid"><button v-for="item in toolActions.filter((tool) => tool.accepts.includes(selected!.kind))" :key="item.id" :disabled="selectedLoading || handoffBusy" @click="action(selected!, item.id)"><b><AppIcon :name="actionIcon(item.id)" :size="17" /></b><span>{{ item.title }}<small>{{ item.description }}</small></span></button></div>
          <div class="source-meta">
            <div class="source-tags" aria-label="资料标签">
              <span class="source-tags__label">标签</span>
              <button v-for="tag in selected.tags" :key="tag" type="button" class="source-tag" :disabled="sourceTagSaving" :aria-label="`移除标签 ${tag}`" :title="`移除标签 ${tag}`" @click="removeSelectedSourceTag(tag)"><span>{{ tag }}</span><i aria-hidden="true">×</i></button>
              <form v-if="selected.tags.length < SOURCE_TAG_LIMIT" class="source-tag-input" @submit.prevent="addSelectedSourceTags"><label class="visually-hidden" for="source-tag-input">添加资料标签</label><input id="source-tag-input" v-model="newSourceTag" maxlength="120" :disabled="selectedLoading || sourceTagSaving" placeholder="添加标签" @keydown.enter.prevent="addSelectedSourceTags" /><button type="submit" :disabled="selectedLoading || sourceTagSaving || !newSourceTag.trim()" aria-label="保存资料标签" title="保存标签"><AppIcon name="plus" :size="13" /></button></form>
              <small v-else class="source-tags__limit">已达 {{ SOURCE_TAG_LIMIT }} 个标签上限</small>
            </div>
            <span>来源定位：第 {{ selectedPage + 1 }} 页{{ selectedBbox ? ' · 已记录选区' : ' · 全页区域' }}</span>
          </div>
        </template><div v-else class="detail-empty"><div><b><AppIcon name="file-text" :size="22" /></b><strong>选择资料后继续处理</strong><span>预览、选区、建错题和代码分享都会集中在这里。</span><button class="primary-button" @click="chooseImport">导入第一份资料</button></div></div>
      </section>
    </div>
    <menu v-if="sourceMenu" ref="sourceMenuElement" class="source-context-menu" role="menu" :aria-label="`${sourceMenu.source.name} 操作`" :style="{ left: `${sourceMenu.x}px`, top: `${sourceMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleSourceMenuKeydown">
      <p>{{ sourceMenu.source.name }}</p>
      <button role="menuitem" @click="runSourceMenu('open')"><AppIcon name="file-text" :size="14" />打开并预览</button>
      <button role="menuitem" @click="runSourceMenu('favorite')"><AppIcon name="star" :size="14" />{{ store.isContentFavorite('source', sourceMenu.source.id) ? '取消收藏' : '加入收藏' }}</button>
      <button v-if="store.isContentRecent('source', sourceMenu.source.id)" role="menuitem" @click="runSourceMenu('remove-recent')"><AppIcon name="clock" :size="14" />从最近使用移除</button>
      <button v-if="sourceDesktopPath(sourceMenu.source)" role="menuitem" @click="runSourceMenu('reveal')"><AppIcon name="inbox" :size="14" />在文件夹中显示</button>
      <button v-if="sourceDesktopPath(sourceMenu.source)" role="menuitem" @click="runSourceMenu('copy-path')"><AppIcon name="link" :size="14" />复制 Vault 路径</button>
      <button role="menuitem" @click="runSourceMenu('note')"><AppIcon name="file-text" :size="14" />整理为来源笔记</button>
      <button role="menuitem" @click="runSourceMenu('question')"><AppIcon name="book" :size="14" />从资料创建错题</button>
      <button v-if="sourceMenu.source.kind === 'image'" role="menuitem" :disabled="handoffBusy" @click="runSourceMenu('image-edit')"><AppIcon name="palette" :size="14" />在图片工作室编辑</button>
      <button v-if="sourceMenu.source.kind === 'image'" role="menuitem" :disabled="handoffBusy || !sourceDesktopPath(sourceMenu.source)" @click="runSourceMenu('ocr')"><AppIcon name="file-text" :size="14" />离线识别图片文字</button>
      <button v-if="sourceMenu.source.kind === 'image' || sourceMenu.source.kind === 'pdf'" role="menuitem" @click="runSourceMenu('formula')"><AppIcon name="math" :size="14" />整理为 LaTeX 公式草稿</button>
      <button v-if="sourceMenu.source.kind === 'code' || sourceMenu.source.kind === 'text'" role="menuitem" @click="runSourceMenu('code-image')"><AppIcon name="terminal" :size="14" />转为代码分享</button>
      <button v-if="sourceMenu.source.kind === 'image' || sourceMenu.source.kind === 'pdf'" role="menuitem" :disabled="handoffBusy" @click="runSourceMenu('batch')"><AppIcon name="toolbox" :size="14" />{{ sourceMenu.source.kind === 'image' ? '带入图片转 PDF' : '带入 PDF 工具' }}</button>
      <button role="menuitem" @click="runSourceMenu('copy-name')"><AppIcon name="duplicate" :size="14" />复制资料名称</button>
    </menu>
  </div>
</template>

<style scoped>
.library-workbench__hero{display:grid;grid-template-columns:minmax(0,1fr) 236px;border-radius:18px;}
.library-workbench__hero:before{display:none}
.library-workbench__intro{position:relative;z-index:1;display:grid;align-content:center;justify-items:start;padding:24px 30px}.library-workbench__intro .eyebrow{color:var(--accent)}.library-workbench__intro h2{max-width:740px;margin:7px 0 8px;color:var(--fg);font:720 clamp(24px,2.7vw,35px)/1.13 var(--font-display);letter-spacing:-.04em}.library-workbench__intro h2 em{color:var(--accent);font-style:normal}.library-workbench__intro>p:not(.eyebrow){max-width:720px;margin:0;color:var(--fg);font-size:11px;line-height:1.65}.library-workbench__hero-actions{gap:7px;margin-top:14px}.library-workbench__hero-actions button{min-height:34px;font-size:10px}.library-workbench__hero-actions .primary-button{}.library-workbench__hero-actions .quiet-button{color:var(--fg);}.library-workbench__hero-actions .quiet-button:hover{}
.library-workbench__hero>aside{position:relative;z-index:1;display:grid;align-content:center;gap:13px;padding:19px 20px;border-left:1px solid var(--surface-2);}.library-workbench__hero>aside header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:2px 10px;padding-bottom:11px;border-bottom:1px solid var(--surface-2)}.library-workbench__hero>aside header>span{font:700 9px var(--font-mono);letter-spacing:.08em}.library-workbench__hero>aside header>strong{grid-row:1/3;grid-column:2;font:760 34px/1 var(--font-mono);letter-spacing:-.065em}.library-workbench__hero>aside header>small{font-size:9px}.library-workbench__hero>aside>div{display:grid;grid-template-columns:1fr 1fr;gap:6px}.library-workbench__hero>aside>div span{display:grid;grid-template-columns:17px auto 1fr;align-items:center;gap:4px;}.library-workbench__hero>aside>div b{font:700 11px var(--font-mono)}.library-workbench__hero>aside>div small{font-size:9px}
.library-workbench__inbox{margin-top:11px;padding:8px;border:1px solid var(--accent-soft);border-radius:13px;background:var(--surface-2)}.library-workbench__inbox :deep(.unified-drop){width:100%;min-height:58px;margin:0;padding:9px 11px;border-radius:9px;background:var(--accent-soft)}.library-workbench__inbox :deep(.drop-intro){grid-template-columns:32px minmax(0,1fr) auto}.library-workbench__inbox :deep(.drop-intro>b){width:31px;height:31px}.library-workbench__inbox :deep(.drop-intro strong){font-size:10px}.library-workbench__inbox :deep(.drop-intro small){font-size:9px}.library-workbench__inbox :deep(.select-files){min-height:31px;margin:0;font-size:9px}.library-workbench__inbox :deep(.drop-file-list){max-height:118px}
.library-workbench__workflows{margin:11px 0;overflow:hidden;border:1px solid var(--accent-soft);border-radius:14px;background:var(--surface-2);box-shadow:0 8px 24px var(--accent-soft)}.library-workbench__workflows>header{display:flex;min-height:52px;align-items:center;justify-content:space-between;gap:18px;padding:9px 12px;border-bottom:1px solid var(--line-weak)}.library-workbench__workflows h3{margin:2px 0 0;font:700 14px var(--font-display)}.library-workbench__workflows>header>p{overflow:hidden;margin:0;color:var(--muted);font-size:9px;text-overflow:ellipsis;white-space:nowrap}.library-workbench__workflows>div{display:grid;grid-template-columns:repeat(5,minmax(0,1fr))}.library-workbench__workflows>div>button{display:grid;min-width:0;min-height:66px;grid-template-columns:29px minmax(0,1fr);align-items:center;gap:7px;padding:8px 10px;border:0;border-right:1px solid var(--line-weak);color:var(--text-secondary);background:transparent;text-align:left}.library-workbench__workflows>div>button:last-child{border-right:0}.library-workbench__workflows>div>button:hover,.library-workbench__workflows>div>button:focus-visible,.library-workbench__workflows>div>button.ready{color:var(--green-strong);background:linear-gradient(135deg,var(--green-bg),var(--surface-2))}.library-workbench__workflows>div>button:focus-visible{position:relative;z-index:1;outline:2px solid color-mix(in srgb,var(--green) 45%,transparent);outline-offset:-2px}.library-workbench__workflows button>b{display:grid;width:29px;height:29px;place-items:center;border-radius:8px;color:var(--green-strong);background:var(--accent-soft)}.library-workbench__workflows button>span{display:grid;min-width:0;gap:2px}.library-workbench__workflows button strong,.library-workbench__workflows button small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.library-workbench__workflows button strong{font:680 10px var(--font-ui)}.library-workbench__workflows button small{color:var(--muted);font-size:9px}.library-workbench__workflows button>i{grid-column:2;color:var(--green-strong);font:700 8.5px var(--font-mono);font-style:normal}
.library-workbench__workflows button>i{font-size:9px}
.library-workbench__workflows>div{grid-template-columns:repeat(6,minmax(0,1fr))}
.library-layout{min-height:430px}.source-detail{min-width:0}.source-detail .action-grid button small{font-size:9px}
@media(max-width:1050px){.library-workbench__hero{}.library-workbench__intro{padding:21px 23px}.library-workbench__intro h2{font-size:26px}.library-workbench__hero>aside{padding:16px}.library-workbench__workflows>div>button{padding-inline:7px}.library-workbench__workflows button>i{display:none}}
@media(max-width:820px){.library-workbench__hero{}.library-workbench__hero>aside{display:none}.library-workbench__workflows>div{grid-template-columns:repeat(3,minmax(0,1fr))}.library-workbench__workflows>div>button{border-bottom:1px solid var(--line-weak)}.library-workbench__workflows>div>button:nth-child(3){border-right:0}.library-workbench__workflows>div>button:nth-last-child(-n+2){border-bottom:0}.library-workbench__workflows>header>p{display:none}}
@media(max-width:820px){.library-workbench__workflows>div>button:nth-last-child(-n+3){border-bottom:0}}
@media(prefers-reduced-motion:reduce){.library-workbench__hero,.library-workbench__workflows{scroll-behavior:auto}}
</style>
