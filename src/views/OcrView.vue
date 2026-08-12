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
  <div class="ocr-workbench page-enter mx-auto w-full max-w-320 px-8 py-6" @click="closeMenu()">
    <PageHeader
      title="离线文字识别"
      :subtitle="capability?.detail || '用 Windows 已装的语言包识别截图与扫描件,结果可直接编辑'"
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

    <div v-if="error" class="ocr-error" role="alert"><AppIcon name="warning" :size="16" /><span>{{ error }}</span><button aria-label="关闭错误提示" @click="error = ''">×</button></div>

    <section v-if="!desktop" class="ocr-desktop-required panel">
      <span><AppIcon name="image" :size="26" /></span><p class="eyebrow">系统原生能力</p><h3>请在 Knitspace Windows 桌面开发版中使用</h3><p>浏览器预览不会读取本机文件，也不会把图片发送到远程 OCR 服务。</p>
    </section>

    <template v-else>
      <section class="ocr-toolbar" aria-label="OCR 输入与识别操作">
        <div>
          <button class="primary-button" :disabled="sourceLoading || recognizing" @click="chooseImage"><AppIcon name="folder" :size="15" />选择图片</button>
          <button class="quiet-button" :disabled="sourceLoading || recognizing" @click="pasteImage"><AppIcon name="clipboard" :size="15" />粘贴图片</button>
        </div>
        <label><span>识别语言</span><select v-model="languageTag" :disabled="recognizing || !capability?.languages.length"><option v-for="language in capability?.languages || []" :key="language.tag" :value="language.tag">{{ language.displayName }} · {{ language.tag }}</option></select></label>
        <button class="ocr-run" :disabled="!sourcePath || recognizing || !capability?.available" @click="recognize"><AppIcon :name="recognizing ? 'refresh' : 'search'" :size="16" />{{ recognizing ? '正在本机识别…' : '开始离线识别' }}<kbd>Ctrl Enter</kbd></button>
      </section>

      <main class="ocr-stage">
        <section class="ocr-source panel" aria-label="待识别图片">
          <header><div><p class="eyebrow">源图片</p><h3>原始图片</h3></div><button v-if="sourcePath" title="清除图片" aria-label="清除当前图片" @click="clearSource"><AppIcon name="trash" :size="14" /></button></header>
          <div
            class="ocr-source__surface"
            :class="{ empty: !sourceUrl, loading: sourceLoading }"
            tabindex="0"
            aria-haspopup="menu"
            :aria-busy="sourceLoading"
            :aria-label="sourcePath ? `${sourceName}；右键或 Shift 加 F10 打开图片菜单` : '尚未选择图片；点击或拖入图片'"
            @click.stop="sourcePath ? undefined : chooseImage()"
            @contextmenu="openMenu($event, 'source')"
            @keydown="openMenuFromKeyboard($event, 'source')"
          >
            <img v-if="sourceUrl" :src="sourceUrl" :alt="`待识别图片：${sourceName}`" decoding="async" />
            <div v-else><span><AppIcon name="image" :size="28" /></span><b>{{ sourceLoading ? '正在读取图片…' : '拖入或选择一张图片' }}</b><p>支持 PNG、JPG、BMP、GIF、TIFF、WebP</p><small>右键还可以直接读取剪贴板图片</small></div>
          </div>
          <footer><span><b>{{ sourceName }}</b><small>{{ sourceFile ? `${Math.max(1, Math.round(sourceFile.size / 1024)).toLocaleString('zh-CN')} KB` : '原图只在当前会话中预览' }}</small></span><button v-if="sourcePath" class="quiet-button" @click="revealDesktopFile(sourcePath)">资源管理器</button></footer>
        </section>

        <section class="ocr-result panel" aria-label="OCR 识别结果">
          <header><div><p class="eyebrow">识别结果 · 可编辑</p><h3>可确认的文字</h3></div><span :class="{ ready: recognition }"><i></i>{{ recognizing ? '识别中' : recognition ? '已完成' : '等待识别' }}</span></header>
          <div class="ocr-result__meta"><span>{{ resultSummary }}</span><small>不会自动覆盖任何笔记</small></div>
          <textarea
            v-model="extractedText"
            :disabled="recognizing"
            spellcheck="false"
            placeholder="识别后的文字会出现在这里，你可以先校对再保存。"
            aria-label="可编辑的 OCR 识别文字；右键或 Shift 加 F10 打开结果菜单"
            aria-haspopup="menu"
            @click.stop
            @contextmenu="openMenu($event, 'result')"
            @keydown="openMenuFromKeyboard($event, 'result')"
          />
          <footer><span>{{ hasText ? `${trimmedText.length.toLocaleString('zh-CN')} 字符` : '暂无文字' }}</span><div><button class="quiet-button" :disabled="!hasText" @click="copyText"><AppIcon name="duplicate" :size="14" />复制</button><button class="quiet-button" :disabled="!hasText" @click="createQuestion"><AppIcon name="review" :size="14" />转成题目</button><button class="primary-button" :disabled="!hasText" @click="saveAsNote"><AppIcon name="book" :size="14" />存为笔记</button></div></footer>
        </section>
      </main>

      <section class="ocr-privacy-strip"><span><AppIcon name="shield" :size="16" /></span><div><b>本机处理边界</b><p>图片只交给 Windows OCR；Knitspace 不上传、不自动归档原图。大图会按系统上限等比缩小后识别，原文件保持不变。</p></div><i>仅本机</i></section>
    </template>

    <Teleport to="body">
      <div v-if="menu" ref="menuElement" class="ocr-context-menu" role="menu" :aria-label="menu.kind === 'source' ? 'OCR 图片操作' : 'OCR 结果操作'" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleMenuKeydown">
        <header><span>{{ menu.kind === 'source' ? 'SOURCE IMAGE' : 'OCR RESULT' }}</span><b>{{ menu.kind === 'source' ? sourceName : '可编辑识别文字' }}</b></header>
        <template v-if="menu.kind === 'source'">
          <button role="menuitem" :disabled="!sourcePath || recognizing || !capability?.available" @click="recognize"><AppIcon name="search" :size="14" />开始离线识别<kbd>Ctrl+Enter</kbd></button>
          <button role="menuitem" :disabled="sourceLoading || recognizing" @click="chooseImage"><AppIcon name="folder" :size="14" />选择另一张图片</button>
          <button role="menuitem" :disabled="sourceLoading || recognizing" @click="pasteImage"><AppIcon name="clipboard" :size="14" />读取剪贴板图片</button>
          <button role="menuitem" :disabled="!sourcePath" @click="revealDesktopFile(sourcePath); closeMenu()"><AppIcon name="arrow-right" :size="14" />在资源管理器中查看</button>
          <button class="danger" role="menuitem" :disabled="!sourcePath" @click="clearSource"><AppIcon name="trash" :size="14" />移除当前图片</button>
        </template>
        <template v-else>
          <button role="menuitem" :disabled="!hasText" @click="copyText"><AppIcon name="duplicate" :size="14" />复制识别文字</button>
          <button role="menuitem" :disabled="!hasText" @click="saveAsNote"><AppIcon name="book" :size="14" />存为 Markdown 笔记</button>
          <button role="menuitem" :disabled="!hasText" @click="createQuestion"><AppIcon name="review" :size="14" />转成待整理题目</button>
          <button role="menuitem" :disabled="!hasText" @click="extractedText = ''; recognition = undefined; closeMenu()"><AppIcon name="trash" :size="14" />清空结果</button>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ocr-workbench{width:100%;max-width:1480px;min-width:0;margin:0 auto;padding:24px 28px 54px;color:var(--text)}
.ocr-hero{overflow:hidden;box-shadow:0 18px 48px var(--accent-soft)}
.ocr-hero>div{position:relative;display:flex;align-items:flex-start;flex-direction:column;justify-content:center;padding:30px 38px;background-size:24px 24px}.ocr-hero>div:after{display:none}.ocr-hero .eyebrow{}.ocr-hero h2{position:relative;z-index:1;margin:8px 0 10px;font:720 clamp(28px,3vw,41px)/1.09 var(--font-display);letter-spacing:-.045em}.ocr-hero h2 em{font-style:normal}.ocr-hero>div>p:last-child{position:relative;z-index:1;max-width:760px;font-size:11px;line-height:1.72}
.ocr-hero>aside{display:grid;grid-template-rows:auto 1fr auto auto;gap:10px;padding:21px;border-left:1px solid var(--surface-2)}.ocr-hero>aside>span{display:flex;align-items:center;gap:7px;font-size:11px}.ocr-hero>aside>span i{width:7px;height:7px;box-shadow:0 0 0 4px var(--warn-soft)}.ocr-hero>aside.ready>span i{box-shadow:0 0 0 4px var(--accent-soft)}.ocr-hero>aside>b{align-self:end;font:760 31px/1 var(--font-mono);letter-spacing:-.04em}.ocr-hero>aside>small{font-size:11px;line-height:1.5}.ocr-hero>aside .quiet-button{justify-content:center;color:var(--fg);}
.ocr-error{display:flex;align-items:center;gap:9px;margin-top:12px;padding:10px 12px;border:1px solid var(--danger-soft);border-radius:10px;color:var(--danger);background:var(--surface);font-size:11px}.ocr-error span{flex:1}.ocr-error button{border:0;color:inherit;background:transparent;font-size:17px}.ocr-desktop-required{display:grid;max-width:700px;min-height:320px;place-items:center;align-content:center;gap:8px;margin:18px auto;text-align:center}.ocr-desktop-required>span{display:grid;width:58px;height:58px;place-items:center;border-radius:16px;color:var(--green-strong);background:var(--green-bg)}.ocr-desktop-required h3{font:700 20px var(--font-display)}.ocr-desktop-required>p:last-child{max-width:500px;color:var(--muted);font-size:11px;line-height:1.65}
.ocr-toolbar{display:grid;grid-template-columns:auto minmax(240px,1fr) auto;align-items:end;gap:12px;margin:14px 0;padding:12px 14px;border:1px solid var(--line);border-radius:13px;background:var(--surface);box-shadow:0 7px 22px var(--accent-soft)}.ocr-toolbar>div{display:flex;gap:7px}.ocr-toolbar button{display:inline-flex;min-height:37px;align-items:center;gap:7px}.ocr-toolbar label{display:grid;gap:5px}.ocr-toolbar label>span{color:var(--muted);font:700 11px var(--font-mono);letter-spacing:.08em}.ocr-toolbar select{min-height:37px;padding:0 34px 0 11px;border:1px solid var(--line-strong);border-radius:8px;outline:0;color:var(--text-secondary);background:var(--surface);font:600 11px var(--font-ui)}.ocr-toolbar select:focus-visible{border-color:var(--green);box-shadow:0 0 0 3px var(--accent-soft)}.ocr-run{justify-content:center;padding:0 14px;border:1px solid var(--green-strong);border-radius:8px;color:var(--fg);background:var(--green-strong);font:700 11px var(--font-ui)}.ocr-run kbd{margin-left:4px;color:var(--fg);background:transparent;font:11px var(--font-mono)}.ocr-run:disabled{border-color:var(--line-strong);color:var(--muted);background:var(--surface-2)}
.ocr-stage{display:grid;grid-template-columns:minmax(320px,.9fr) minmax(420px,1.1fr);gap:13px;min-height:520px}.ocr-source,.ocr-result{display:grid;min-width:0;overflow:hidden;padding:0}.ocr-source{grid-template-rows:auto minmax(0,1fr) auto}.ocr-result{grid-template-rows:auto auto minmax(0,1fr) auto}.ocr-source>header,.ocr-result>header{display:flex;min-height:63px;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid var(--line-weak)}.ocr-source h3,.ocr-result h3{margin-top:3px;font:700 16px var(--font-display)}.ocr-source>header>button{display:grid;width:30px;height:30px;place-items:center;border:1px solid var(--line);border-radius:8px;color:var(--muted);background:transparent}.ocr-result>header>span{display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:999px;color:var(--muted);background:var(--surface-2);font:700 11px var(--font-ui)}.ocr-result>header>span i{width:6px;height:6px;border-radius:50%;background:var(--fg-3)}.ocr-result>header>span.ready{color:var(--accent);background:var(--accent-soft)}.ocr-result>header>span.ready i{background:var(--accent)}
.ocr-source__surface{display:grid;min-height:0;place-items:center;overflow:hidden;margin:13px;border:1px solid var(--accent-soft);border-radius:11px;outline:0;background:linear-gradient(145deg,var(--surface-2),var(--surface-2));cursor:context-menu}.ocr-source__surface:focus-visible{border-color:var(--green);box-shadow:0 0 0 3px var(--accent-soft)}.ocr-source__surface img{display:block;width:100%;height:100%;min-height:380px;object-fit:contain;background: var(--surface-2);background-position:0 0,0 7px,7px -7px,-7px 0;background-size:14px 14px}.ocr-source__surface.empty{cursor:pointer}.ocr-source__surface>div{display:grid;place-items:center;gap:7px;padding:28px;text-align:center}.ocr-source__surface>div>span{display:grid;width:52px;height:52px;place-items:center;border-radius:15px;color:var(--green-strong);background:var(--accent-soft)}.ocr-source__surface>div>b{margin-top:4px;font:700 14px var(--font-display)}.ocr-source__surface>div>p,.ocr-source__surface>div>small{color:var(--muted);font-size:11px}.ocr-source>footer,.ocr-result>footer{display:flex;min-height:61px;align-items:center;justify-content:space-between;gap:12px;padding:10px 15px;border-top:1px solid var(--line-weak)}.ocr-source>footer>span{display:grid;min-width:0;gap:3px}.ocr-source>footer b{overflow:hidden;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.ocr-source>footer small{color:var(--muted);font-size:11px}
.ocr-result__meta{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:9px 15px;border-bottom:1px solid var(--line-weak);color:var(--text-secondary);background:var(--surface-2);font-size:11px}.ocr-result__meta small{color:var(--muted)}.ocr-result textarea{box-sizing:border-box;width:calc(100% - 26px);min-height:376px;resize:none;margin:13px;padding:15px;border:1px solid var(--accent-soft);border-radius:10px;outline:0;color:var(--fg);background:var(--surface);font:11px/1.75 var(--font-mono);caret-color:var(--green-strong)}.ocr-result textarea:focus{border-color:var(--green);box-shadow:0 0 0 3px var(--accent-soft)}.ocr-result textarea::placeholder{color:var(--fg-3)}.ocr-result>footer>span{color:var(--muted);font:700 11px var(--font-mono)}.ocr-result>footer>div{display:flex;gap:6px}.ocr-result>footer button{display:inline-flex;align-items:center;gap:6px}
.ocr-privacy-strip{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:11px;margin-top:13px;padding:12px 15px;border:1px solid var(--accent-soft);border-radius:11px;background:var(--accent-soft)}.ocr-privacy-strip>span{display:grid;width:31px;height:31px;place-items:center;border-radius:9px;color:var(--green-strong);background:var(--surface)}.ocr-privacy-strip b{font-size:11px}.ocr-privacy-strip p{margin-top:3px;color:var(--muted);font-size:11px;line-height:1.5}.ocr-privacy-strip>i{color:var(--green-strong);font:700 11px var(--font-mono);font-style:normal;letter-spacing:.09em}
.ocr-toolbar label>span,.ocr-run kbd,.ocr-result>header>span,.ocr-source>footer small,.ocr-result__meta,.ocr-result>footer>span,.ocr-privacy-strip p,.ocr-privacy-strip>i{font-size:11px}
.ocr-result__meta small{font-size:11px}
@media(max-width:1050px){.ocr-stage{grid-template-columns:1fr}.ocr-source__surface{min-height:430px}.ocr-result textarea{min-height:330px}}@media(max-width:800px){.ocr-workbench{padding:20px 16px 44px}.ocr-hero{}.ocr-hero>aside{display:none}.ocr-toolbar{grid-template-columns:1fr}.ocr-toolbar>div,.ocr-toolbar>div button,.ocr-run{width:100%}.ocr-toolbar>div button{justify-content:center}.ocr-privacy-strip{grid-template-columns:auto 1fr}.ocr-privacy-strip>i{display:none}}
@media(prefers-reduced-motion:reduce){.ocr-workbench *{scroll-behavior:auto!important}}
</style>

<style>
.ocr-context-menu{position:fixed;z-index:145;width:270px;overflow:hidden;border:1px solid var(--accent-soft);border-radius:12px;background:var(--surface);box-shadow:0 18px 52px var(--accent-soft);animation:ocr-menu-in .14s ease-out both}.ocr-context-menu>header{display:grid;gap:3px;padding:10px 12px 8px;border-bottom:1px solid var(--line-weak);background:linear-gradient(125deg,var(--green-bg),var(--surface-2))}.ocr-context-menu>header span{color:var(--green-strong);font:700 11px var(--font-mono);letter-spacing:.1em}.ocr-context-menu>header b{overflow:hidden;font:700 11px var(--font-ui);text-overflow:ellipsis;white-space:nowrap}.ocr-context-menu>button{display:flex;width:100%;min-height:38px;align-items:center;gap:9px;padding:0 12px;border:0;border-bottom:1px solid var(--line-weak);color:var(--text-secondary);background:transparent;font:640 11px var(--font-ui);text-align:left}.ocr-context-menu>button:last-child{border-bottom:0}.ocr-context-menu>button kbd{margin-left:auto;color:var(--muted);font:11px var(--font-mono)}.ocr-context-menu>button:hover,.ocr-context-menu>button:focus-visible{outline:0;color:var(--green-strong);background:var(--green-bg)}.ocr-context-menu>button:disabled{color:var(--line-strong);background:transparent}.ocr-context-menu>button.danger{color:var(--danger)}@keyframes ocr-menu-in{from{opacity:0;transform:translateY(-4px) scale(.985)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.ocr-context-menu{animation:none}}
.ocr-context-menu>header span,.ocr-context-menu>button kbd{font-size:11px}
</style>
