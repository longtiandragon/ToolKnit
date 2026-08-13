<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { consumeLocalFileHandoff } from '@/lib/local-file-handoff'
import {
  isDesktop,
  inspectDesktopInputFile,
  listenWindowFileDrops,
  probeDesktopOcr,
  readDesktopClipboard,
  readDesktopInputFile,
  recognizeDesktopImageText,
  revealDesktopFile,
  type DesktopOcrCapability,
  type DesktopOcrRecognition,
} from '@/lib/native'
import { useUiStore } from '@/stores/ui'
import { useWorkbenchStore } from '@/stores/workbench'

type OcrMenuKind = 'source' | 'result'
type OcrMenu = { kind: OcrMenuKind; x: number; y: number }

const route = useRoute()
const qaPreview = route.query.qa === 'preview' && window.location.hostname === '127.0.0.1' && ['1420', '1421'].includes(window.location.port)
const desktop = isDesktop() || qaPreview
const router = useRouter()
const store = useWorkbenchStore()
const ui = useUiStore()
const capability = shallowRef<DesktopOcrCapability>()
const capabilityPending = ref(false)
const sourcePath = ref('')
const sourceFile = shallowRef<File>()
const sourceUrl = ref('')
const languageTag = ref('')
const recognition = shallowRef<DesktopOcrRecognition>()
const extractedText = ref('')
const recognizing = ref(false)
const sourceLoading = ref(false)
const error = ref('')
const menu = ref<OcrMenu | null>(null)
const menuElement = ref<HTMLElement>()
let menuTrigger: HTMLElement | undefined
let unlistenDrop: () => void = () => undefined
let disposed = false

const sourceName = computed(() => sourceFile.value?.name || sourcePath.value.split(/[\\/]/).filter(Boolean).at(-1) || '尚未选择图片')
const trimmedText = computed(() => extractedText.value.trim())
const hasText = computed(() => Boolean(trimmedText.value))
const capabilityLabel = computed(() => {
  if (!desktop) return '需要 Windows 桌面版'
  if (capabilityPending.value) return '正在检查本机语言包'
  if (capability.value?.available) return `${capability.value.languages.length} 个本机语言包`
  return '本机 OCR 不可用'
})
const resultSummary = computed(() => {
  if (!recognition.value) return '识别结果不会自动写入资料库'
  const size = recognition.value.downscaled
    ? `${recognition.value.sourceWidth} × ${recognition.value.sourceHeight} → ${recognition.value.processedWidth} × ${recognition.value.processedHeight}`
    : `${recognition.value.sourceWidth} × ${recognition.value.sourceHeight}`
  return `${recognition.value.language.displayName} · ${recognition.value.lineCount} 行 · ${size}`
})

function isSupportedImagePath(path: string) {
  return /\.(png|jpe?g|bmp|gif|tiff?|webp)$/i.test(path)
}

function revokeSourceUrl() {
  if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value)
  sourceUrl.value = ''
}

async function setSource(path: string) {
  closeMenu()
  error.value = ''
  if (!isSupportedImagePath(path)) {
    error.value = '请选择 PNG、JPG、BMP、GIF、TIFF 或 WebP 图片。'
    return
  }
  sourceLoading.value = true
  try {
    const metadata = await inspectDesktopInputFile(path)
    if (metadata.size > 50 * 1024 * 1024) throw new Error('图片超过 50 MB 安全上限，请先在图片工作室缩小或压缩。')
    const file = await readDesktopInputFile(path)
    if (!file.type.startsWith('image/')) throw new Error('这个文件没有可识别的图片类型。')
    revokeSourceUrl()
    sourcePath.value = path
    sourceFile.value = file
    sourceUrl.value = URL.createObjectURL(file)
    recognition.value = undefined
    extractedText.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法读取这张图片。'
  } finally {
    sourceLoading.value = false
  }
}

async function chooseImage() {
  if (!desktop || sourceLoading.value || recognizing.value) return
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    title: '选择需要离线识别的图片',
    multiple: false,
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'tif', 'tiff', 'webp'] }],
  })
  if (typeof selected === 'string') await setSource(selected)
}

async function pasteImage() {
  if (!desktop || sourceLoading.value || recognizing.value) return
  closeMenu()
  error.value = ''
  try {
    const clipboard = await readDesktopClipboard()
    if (clipboard?.kind !== 'image' || !clipboard.assetPath) throw new Error('剪贴板中没有可读取的图片。')
    await setSource(clipboard.assetPath)
    ui.toast('已读取剪贴板图片', '图片仍只保存在本机缓存中。', 'success')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法读取剪贴板图片。'
  }
}

async function refreshCapability() {
  capabilityPending.value = true
  error.value = ''
  try {
    capability.value = await probeDesktopOcr()
    if (!languageTag.value) languageTag.value = capability.value.defaultLanguage || capability.value.languages[0]?.tag || ''
  } catch (cause) {
    capability.value = undefined
    error.value = cause instanceof Error ? cause.message : '无法检查 Windows OCR。'
  } finally {
    capabilityPending.value = false
  }
}

async function recognize() {
  closeMenu()
  if (!sourcePath.value || recognizing.value || !capability.value?.available) return
  recognizing.value = true
  error.value = ''
  recognition.value = undefined
  extractedText.value = ''
  try {
    const next = await recognizeDesktopImageText(sourcePath.value, languageTag.value || undefined)
    recognition.value = next
    extractedText.value = next.text
    if (next.text) ui.toast('离线识别完成', `${next.lineCount} 行文字已进入可编辑结果区。`, 'success')
    else ui.toast('没有识别到文字', '可以尝试裁剪图片、提高对比度或切换语言包。', 'warning')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Windows OCR 识别失败。'
  } finally {
    recognizing.value = false
  }
}

async function copyText() {
  closeMenu()
  if (!hasText.value) return
  try {
    await navigator.clipboard.writeText(extractedText.value)
    ui.toast('已复制识别文字', `${trimmedText.value.length} 个字符。`, 'success')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '系统剪贴板暂不可用。'
  }
}

function safeTitle(prefix: string) {
  const base = sourceName.value.replace(/\.[^.]+$/, '').trim() || '未命名图片'
  return `${prefix} · ${base}`.slice(0, 100)
}

async function saveAsNote() {
  closeMenu()
  if (!hasText.value) return
  const title = safeTitle('OCR')
  const note = store.createNote(title, 'OCR', `# ${title}\n\n> 来源：${sourceName.value}\n> 识别语言：${recognition.value?.language.displayName || languageTag.value}\n\n${trimmedText.value}\n`)
  store.saveDocument({ ...note, subject: '学习资料', tags: ['OCR', '待整理'] })
  await router.push({ path: '/documents', query: { kind: 'note', document: note.id, mode: 'split' } })
  ui.toast('已存为 Markdown 笔记', '原始图片没有被自动复制进 Vault。', 'success')
}

async function createQuestion() {
  closeMenu()
  if (!hasText.value) return
  const question = store.createQuestion()
  const title = safeTitle('图片题目')
  const stem = trimmedText.value
  store.saveDocument({
    ...question,
    title,
    subject: '待整理',
    tags: ['OCR', '图片题'],
    questionDetails: { ...question.questionDetails!, stem },
    content: `# ${title}\n\n## 题目\n\n${stem}\n\n## 我的答案\n\n\n\n## 正确答案\n\n\n\n## 解析\n\n`,
  })
  await router.push({ path: '/documents', query: { kind: 'question', document: question.id, mode: 'edit' } })
  ui.toast('已创建待整理题目', '请补充答案、解析和错误原因。', 'success')
}

function clearSource() {
  closeMenu()
  revokeSourceUrl()
  sourcePath.value = ''
  sourceFile.value = undefined
  recognition.value = undefined
  extractedText.value = ''
  error.value = ''
}

function closeMenu(restoreFocus = false) {
  menu.value = null
  if (restoreFocus) void nextTick(() => menuTrigger?.focus({ preventScroll: true }))
}

function openMenu(event: MouseEvent | KeyboardEvent, kind: OcrMenuKind) {
  event.preventDefault()
  event.stopPropagation()
  menuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = menuTrigger?.getBoundingClientRect()
  const rawX = 'clientX' in event && event.clientX ? event.clientX : (bounds?.left ?? 16) + 34
  const rawY = 'clientY' in event && event.clientY ? event.clientY : (bounds?.top ?? 16) + 34
  menu.value = { kind, ...clampMenuPosition(rawX, rawY, { menuWidth: 270, menuHeight: kind === 'source' ? 224 : 188, margin: 12 }) }
  void nextTick(() => menuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}

function openMenuFromKeyboard(event: KeyboardEvent, kind: OcrMenuKind) {
  if (isContextMenuShortcut(event)) openMenu(event, kind)
  else if (event.key === 'Enter' && event.ctrlKey && kind === 'source') { event.preventDefault(); void recognize() }
}

function handleMenuKeydown(event: KeyboardEvent) {
  const items = [...(menuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return }
  const index = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (index === undefined) return
  event.preventDefault()
  items[index]?.focus({ preventScroll: true })
}

onMounted(async () => {
  const incoming = consumeLocalFileHandoff('ocr')
  if (qaPreview) {
    capability.value = {
      available: true,
      languages: [{ tag: 'zh-Hans', displayName: '中文（简体）' }, { tag: 'en-US', displayName: 'English (United States)' }],
      defaultLanguage: 'zh-Hans',
      maxImageDimension: 2600,
      detail: 'Windows 本机 OCR 已就绪，共 2 个语言包；图片不会离开本机。',
    }
    languageTag.value = 'zh-Hans'
    sourcePath.value = 'C:\\Study\\dijkstra-note.png'
    sourceFile.value = new File(['qa'], 'dijkstra-note.png', { type: 'image/png' })
    sourceUrl.value = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600"><rect width="100%" height="100%" fill="#fffdf7"/><rect x="54" y="48" width="852" height="504" rx="18" fill="#ffffff" stroke="#d8d4c7"/><text x="92" y="112" font-family="Segoe UI,Microsoft YaHei" font-size="30" font-weight="700" fill="#17372c">Dijkstra 最短路径</text><text x="92" y="166" font-family="Segoe UI,Microsoft YaHei" font-size="19" fill="#394d44">适用于边权非负的单源最短路问题</text><line x1="92" y1="195" x2="866" y2="195" stroke="#d9ded8"/><text x="92" y="246" font-family="Consolas" font-size="18" fill="#285b47">1. dist[source] = 0</text><text x="92" y="288" font-family="Consolas" font-size="18" fill="#285b47">2. 从优先队列取出距离最小的节点</text><text x="92" y="330" font-family="Consolas" font-size="18" fill="#285b47">3. 松弛所有相邻边并更新队列</text><rect x="92" y="380" width="774" height="112" rx="10" fill="#f1f5f2"/><text x="116" y="425" font-family="Segoe UI,Microsoft YaHei" font-size="18" fill="#33473e">时间复杂度：O((V + E) log V)</text><text x="116" y="462" font-family="Segoe UI,Microsoft YaHei" font-size="18" fill="#33473e">注意：存在负权边时不能直接使用。</text></svg>')}`
    recognition.value = {
      text: '', language: capability.value.languages[0]!, sourceWidth: 1920, sourceHeight: 1200,
      processedWidth: 1920, processedHeight: 1200, lineCount: 7, downscaled: false,
    }
    extractedText.value = 'Dijkstra 最短路径\n适用于边权非负的单源最短路问题\n\n1. dist[source] = 0\n2. 从优先队列取出距离最小的节点\n3. 松弛所有相邻边并更新队列\n\n时间复杂度：O((V + E) log V)\n注意：存在负权边时不能直接使用。'
    return
  }
  await refreshCapability()
  if (incoming?.paths[0]) {
    await setSource(incoming.paths[0])
    if (sourcePath.value) ui.toast('图片已带入离线 OCR', `${incoming.sourceLabel || '上一工作区'} · 原图不会自动归档。`, 'success')
  }
  try {
    const stop = await listenWindowFileDrops(paths => {
      const imagePath = paths.find(isSupportedImagePath)
      if (imagePath) void setSource(imagePath)
      else error.value = '拖入内容中没有支持的图片。'
    })
    if (disposed) stop()
    else unlistenDrop = stop
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '桌面拖放暂不可用。'
  }
})

onBeforeUnmount(() => {
  disposed = true
  unlistenDrop()
  revokeSourceUrl()
})
</script>

<template>
  <!-- No `ocr-*` classes: two scoped blocks plus a global one, still carrying
       `--green` from before the tokens, and a stage pinned to 520px. -->
  <div class="page-enter h-full mx-auto w-full max-w-320 px-8 py-6" @click="closeMenu()">
    <PageHeader
      title="离线文字识别"
      :subtitle="capability?.detail || '用 Windows 已装的语言包识别截图与扫描件，结果可直接编辑'"
    >
      <template #actions>
        <span class="row gap-1.5 h-9 px-3 rounded-sm bg-surface-2 border border-line text-[12px] text-fg-2">
          <i class="w-1.5 h-1.5 rounded-full shrink-0" :class="capability?.available ? 'bg-success' : 'bg-warn'" aria-hidden="true" />
          {{ capabilityLabel }}
        </span>
        <button class="btn-default" :disabled="capabilityPending" @click.stop="refreshCapability">
          <AppIcon name="refresh" :size="15" />重新检查
        </button>
      </template>
    </PageHeader>

    <p v-if="error" class="row gap-2 shrink-0 mb-3 px-3 py-2 rounded-md bg-danger-soft text-[12px] text-danger" role="alert">
      <AppIcon name="warning" :size="15" class="shrink-0 mt-0.5" />
      <span class="min-w-0 flex-1 leading-relaxed">{{ error }}</span>
      <button class="center w-5 h-5 shrink-0 rounded-sm hover:bg-danger hover:text-white" aria-label="关闭错误提示" @click="error = ''"><AppIcon name="close" :size="12" /></button>
    </p>

    <section v-if="!desktop" class="flex-1 min-h-0 center panel">
      <div class="stack items-center gap-3 max-w-120 px-6 text-center">
        <span class="center w-12 h-12 rounded-lg bg-accent-soft text-accent"><AppIcon name="image" :size="24" /></span>
        <strong class="text-[15px] font-semibold text-fg">请在 Knitspace Windows 桌面开发版中使用</strong>
        <p class="text-[12px] leading-relaxed text-fg-3">这一页调用的是系统原生能力。浏览器预览不会读取本机文件，也不会把图片发送到远程 OCR 服务。</p>
      </div>
    </section>

    <section v-else class="flex-1 min-h-0 stack panel overflow-hidden">
      <!-- One toolbar, with the run button on the right where the result is. -->
      <div class="row flex-wrap gap-x-4 gap-y-2 shrink-0 px-3 py-2 border-b border-line">
        <span class="row gap-1.5 shrink-0">
          <button class="btn-tool" :disabled="sourceLoading || recognizing" @click="chooseImage"><AppIcon name="folder" :size="14" />选择图片</button>
          <button class="btn-tool" :disabled="sourceLoading || recognizing" @click="pasteImage"><AppIcon name="clipboard" :size="14" />粘贴图片</button>
        </span>
        <label class="row gap-2 shrink-0">
          <span class="text-[11px] font-semibold text-fg-3">识别语言</span>
          <select v-model="languageTag" class="field h-7 px-2 text-[12px]" :disabled="recognizing || !capability?.languages.length">
            <option v-for="language in capability?.languages || []" :key="language.tag" :value="language.tag">{{ language.displayName }} · {{ language.tag }}</option>
          </select>
        </label>
        <button class="btn-primary btn-sm ml-auto shrink-0" :disabled="!sourcePath || recognizing || !capability?.available" @click="recognize">
          <AppIcon :name="recognizing ? 'refresh' : 'search'" :size="15" />
          {{ recognizing ? '正在本机识别…' : '开始离线识别' }}
          <kbd class="kbd ml-1">Ctrl Enter</kbd>
        </button>
      </div>

      <div class="flex-1 min-h-0 grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section class="stack min-h-0 border-r border-line" aria-label="待识别图片">
          <header class="row-between gap-2 shrink-0 px-3 h-9 border-b border-line">
            <span class="text-[11px] font-semibold text-fg-3">源图片</span>
            <button v-if="sourcePath" class="center w-7 h-7 rounded-sm text-fg-3 hover:bg-surface-2 hover:text-danger" title="清除图片" aria-label="清除当前图片" @click="clearSource">
              <AppIcon name="trash" :size="14" />
            </button>
          </header>
          <div
            class="flex-1 min-h-0 center overflow-hidden bg-well"
            :class="sourceUrl ? 'cursor-context-menu' : 'cursor-pointer'"
            tabindex="0"
            aria-haspopup="menu"
            :aria-busy="sourceLoading"
            :aria-label="sourcePath ? `${sourceName}；右键或 Shift 加 F10 打开图片菜单` : '尚未选择图片；点击或拖入图片'"
            @click.stop="sourcePath ? undefined : chooseImage()"
            @contextmenu="openMenu($event, 'source')"
            @keydown="openMenuFromKeyboard($event, 'source')"
          >
            <img v-if="sourceUrl" :src="sourceUrl" :alt="`待识别图片：${sourceName}`" decoding="async" class="max-w-full max-h-full object-contain" />
            <div v-else class="stack items-center gap-2 p-6 text-center">
              <span class="center w-12 h-12 rounded-lg bg-accent-soft text-accent"><AppIcon name="image" :size="24" /></span>
              <b class="text-[13px] font-medium text-fg">{{ sourceLoading ? '正在读取图片…' : '拖入或选择一张图片' }}</b>
              <p class="text-[11px] text-fg-3">支持 PNG、JPG、BMP、GIF、TIFF、WebP</p>
              <small class="text-[11px] text-fg-3">右键还可以直接读取剪贴板图片</small>
            </div>
          </div>
          <footer class="row-between gap-3 shrink-0 px-3 h-11 border-t border-line">
            <span class="stack gap-0.5 min-w-0">
              <b class="text-[12px] font-medium truncate text-fg">{{ sourceName }}</b>
              <small class="text-[11px] truncate text-fg-3">{{ sourceFile ? `${Math.max(1, Math.round(sourceFile.size / 1024)).toLocaleString('zh-CN')} KB` : '原图只在当前会话中预览' }}</small>
            </span>
            <button v-if="sourcePath" class="btn-tool shrink-0" @click="revealDesktopFile(sourcePath)">资源管理器</button>
          </footer>
        </section>

        <section class="stack min-h-0" aria-label="OCR 识别结果">
          <header class="row-between gap-2 shrink-0 px-3 h-9 border-b border-line">
            <span class="text-[11px] font-semibold text-fg-3">识别结果 · 可编辑</span>
            <span class="chip h-5 px-2 text-[11px]" :class="recognition ? 'chip-accent' : ''">
              <i class="w-1.5 h-1.5 rounded-full" :class="recognizing ? 'bg-warn animate-pulse' : recognition ? 'bg-accent' : 'bg-fg-3'" aria-hidden="true" />
              {{ recognizing ? '识别中' : recognition ? '已完成' : '等待识别' }}
            </span>
          </header>
          <div class="row-between gap-3 shrink-0 px-3 py-1.5 border-b border-line bg-surface-2 text-[11px] text-fg-2">
            <span class="min-w-0 truncate">{{ resultSummary }}</span>
            <small class="shrink-0 text-fg-3">不会自动覆盖任何笔记</small>
          </div>
          <textarea
            v-model="extractedText"
            class="flex-1 min-h-0 px-3 py-2.5 bg-well border-0 font-mono text-[12px] leading-relaxed text-fg resize-none focus:outline-none disabled:opacity-60"
            :disabled="recognizing"
            spellcheck="false"
            placeholder="识别后的文字会出现在这里，你可以先校对再保存。"
            aria-label="可编辑的 OCR 识别文字；右键或 Shift 加 F10 打开结果菜单"
            aria-haspopup="menu"
            @click.stop
            @contextmenu="openMenu($event, 'result')"
            @keydown="openMenuFromKeyboard($event, 'result')"
          />
          <footer class="row-between gap-3 shrink-0 px-3 h-11 border-t border-line">
            <span class="shrink-0 font-mono text-[11px] tabular-nums text-fg-3">{{ hasText ? `${trimmedText.length.toLocaleString('zh-CN')} 字符` : '暂无文字' }}</span>
            <span class="row gap-1.5 shrink-0">
              <button class="btn-default btn-sm" :disabled="!hasText" @click="copyText"><AppIcon name="duplicate" :size="13" />复制</button>
              <button class="btn-default btn-sm" :disabled="!hasText" @click="createQuestion"><AppIcon name="review" :size="13" />转成题目</button>
              <button class="btn-primary btn-sm" :disabled="!hasText" @click="saveAsNote"><AppIcon name="book" :size="13" />存为笔记</button>
            </span>
          </footer>
        </section>
      </div>

      <p class="row gap-2 shrink-0 px-3 py-2.5 border-t border-line text-[11px] leading-relaxed text-fg-3">
        <AppIcon name="shield" :size="14" class="shrink-0 mt-0.5 text-success" />
        图片只交给 Windows OCR；Knitspace 不上传、不自动归档原图。大图会按系统上限等比缩小后识别，原文件保持不变。
      </p>
    </section>

    <Teleport to="body">
      <div
        v-if="menu"
        ref="menuElement"
        class="menu-panel w-68"
        role="menu"
        :aria-label="menu.kind === 'source' ? 'OCR 图片操作' : 'OCR 结果操作'"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleMenuKeydown"
      >
        <p class="menu-title">
          {{ menu.kind === 'source' ? '源图片' : '识别结果' }}
          <small class="min-w-0 truncate font-normal">{{ menu.kind === 'source' ? sourceName : '可编辑识别文字' }}</small>
        </p>
        <template v-if="menu.kind === 'source'">
          <button class="menu-item" role="menuitem" :disabled="!sourcePath || recognizing || !capability?.available" @click="recognize">
            <span class="row gap-2"><AppIcon name="search" :size="14" />开始离线识别</span><kbd class="kbd">Ctrl+Enter</kbd>
          </button>
          <button class="menu-item" role="menuitem" :disabled="sourceLoading || recognizing" @click="chooseImage"><span class="row gap-2"><AppIcon name="folder" :size="14" />选择另一张图片</span></button>
          <button class="menu-item" role="menuitem" :disabled="sourceLoading || recognizing" @click="pasteImage"><span class="row gap-2"><AppIcon name="clipboard" :size="14" />读取剪贴板图片</span></button>
          <button class="menu-item" role="menuitem" :disabled="!sourcePath" @click="revealDesktopFile(sourcePath); closeMenu()"><span class="row gap-2"><AppIcon name="arrow-right" :size="14" />在资源管理器中查看</span></button>
          <i class="menu-sep" aria-hidden="true" />
          <button class="menu-item menu-item-danger" role="menuitem" :disabled="!sourcePath" @click="clearSource"><span class="row gap-2"><AppIcon name="trash" :size="14" />移除当前图片</span></button>
        </template>
        <template v-else>
          <button class="menu-item" role="menuitem" :disabled="!hasText" @click="copyText"><span class="row gap-2"><AppIcon name="duplicate" :size="14" />复制识别文字</span></button>
          <button class="menu-item" role="menuitem" :disabled="!hasText" @click="saveAsNote"><span class="row gap-2"><AppIcon name="book" :size="14" />存为 Markdown 笔记</span></button>
          <button class="menu-item" role="menuitem" :disabled="!hasText" @click="createQuestion"><span class="row gap-2"><AppIcon name="review" :size="14" />转成待整理题目</span></button>
          <i class="menu-sep" aria-hidden="true" />
          <button class="menu-item menu-item-danger" role="menuitem" :disabled="!hasText" @click="extractedText = ''; recognition = undefined; closeMenu()"><span class="row gap-2"><AppIcon name="trash" :size="14" />清空结果</span></button>
        </template>
      </div>
    </Teleport>
  </div>
</template>
