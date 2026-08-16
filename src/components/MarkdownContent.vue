<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { renderMarkdownCached } from '@/lib/markdown'
import { decodeMermaidSource, renderMermaidSource } from '@/lib/mermaid-renderer'
import { copyPngToClipboard, readDesktopVaultMarkdownImage, readExternalMarkdownImage } from '@/lib/native'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { createAsyncRenderQueue } from '@/lib/async-render-queue'
import { createDeferredTaskBatch } from '@/lib/deferred-task-batch'
import { scrollOffset, scrollProgress } from '@/lib/scroll-sync'
import { markdownPreviewImageFilename, markdownPreviewImageMarkup } from '@/lib/markdown-image-import'
import { markdownLinkMarkup } from '@/lib/markdown-link'
import { reconcileRootHtml } from '@/lib/dom-html-reconcile'
import { nextMarkdownPreviewBatchRange, planMarkdownPreviewReconciliation } from '@/lib/progressive-markdown-preview'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{ source: string; compact?: boolean; defer?: boolean; worker?: boolean; largeReader?: boolean; externalMarkdownPath?: string; documentId?: string; suppressLeadingTitle?: string }>(), { compact: false, defer: false, worker: false, largeReader: false, externalMarkdownPath: '', documentId: '', suppressLeadingTitle: '' })
const emit = defineEmits<{
  wikiOpen: [title: string, heading?: string]
  wikiContext: [title: string, heading: string | undefined, x: number, y: number, trigger?: HTMLElement]
  headingContext: [heading: string, x: number, y: number, trigger: HTMLElement]
  outline: [items: Array<{ label: string; level: number; index: number }>]
  renderStart: []
  renderProgress: [completed: number, total: number]
  rendered: [elapsedMs?: number]
  'scroll-progress': [progress: number]
  'image-edit': [file: File]
  'link-open': [href: string, label: string]
}>()
const root = ref<HTMLElement>()
const html = ref('')
let renderedChildSignatures: string[] = []
const pending = ref(false)
const diagramContextMenu = ref<{ target: HTMLElement; state: string; sourceVisible: boolean; hasSvg: boolean; x: number; y: number } | null>(null)
const diagramMenuElement = ref<HTMLElement>()
const diagramStatus = ref('')
const imageContextMenu = shallowRef<{ target: HTMLImageElement; source: string; alt: string; ready: boolean; x: number; y: number }>()
const imageMenuElement = ref<HTMLElement>()
const imageViewer = shallowRef<{ src: string; source: string; alt: string; width: number; height: number }>()
const imageViewerActualSize = ref(false)
const imageViewerElement = ref<HTMLElement>()
const imageViewerCloseButton = ref<HTMLButtonElement>()
const imageStatus = ref('')
const linkContextMenu = shallowRef<{ target: HTMLAnchorElement; href: string; label: string; x: number; y: number }>()
const linkMenuElement = ref<HTMLElement>()
const linkStatus = ref('')
let diagramMenuTrigger: HTMLElement | undefined
let imageMenuTrigger: HTMLImageElement | undefined
let linkMenuTrigger: HTMLAnchorElement | undefined
let renderTimer: number | undefined
let previewWorker: Worker | undefined
let renderRequestId = 0
let latestRequestId = 0
let renderStartedAt = 0
let elapsedForNextHtml = undefined as number | undefined
let progressiveRenderFrame: number | undefined
let progressiveRenderRevision = 0
let progressiveOwnsDom = false
let progressiveRenderInFlight = false
// Keep only compact Worker source keys after a render. Retaining the previous
// multi-megabyte HTML array would duplicate content that already lives in DOM.
let progressiveRenderedBlockKeys: string[] = []
type ProgressiveBlockRange = { start: Comment; end: Comment }
let progressiveBlockRanges: ProgressiveBlockRange[] = []
let scrollFrame: number | undefined
let suppressScrollEvent = false
let codeHighlightRequestId = 0
let codeObserver: IntersectionObserver | undefined
let codeRevision = 0
const codeHighlightRequests = new Map<number, { target: HTMLElement; revision: number }>()
let mathRequestId = 0
let mathObserver: IntersectionObserver | undefined
let mathRevision = 0
const mathRequests = new Map<number, { target: HTMLElement; revision: number }>()
let mermaidObserver: IntersectionObserver | undefined
let diagramRevision = 0
// Mermaid performs layout and SVG creation on the main thread. A long note can
// reveal several figures at once, so keep that work calm and discard figures
// belonging to a preview revision the user has already left behind.
const diagramQueue = createAsyncRenderQueue()
const domHydrationBatch = createDeferredTaskBatch()
let imageObserver: IntersectionObserver | undefined
let imageRevision = 0
const externalImagePlaceholder = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

function isRelativeLocalImage(source: string) {
  const value = source.trim()
  return Boolean(value) && !value.startsWith('/') && !value.startsWith('\\') && !value.startsWith('//') && !/^[a-z][a-z\d+.-]*:/i.test(value)
}

function deferExternalMarkdownImages(rendered: string) {
  if (!props.externalMarkdownPath && !props.documentId) return rendered
  // Markdown-it emits double-quoted image attributes and escapes their values.
  // Replacing only its known <img> output avoids a burst of failed local URL
  // requests before IntersectionObserver decides an image is actually nearby.
  return rendered.replace(/<img\b([^>]*?)\bsrc="([^"]*)"([^>]*)>/g, (full, before: string, source: string, after: string) => (
    isRelativeLocalImage(source)
      ? `<img${before}src="${externalImagePlaceholder}" data-external-image-src="${source}"${after}>`
      : full
  ))
}

function handleRootScroll() {
  if (suppressScrollEvent || scrollFrame !== undefined || !root.value) return
  scrollFrame = window.requestAnimationFrame(() => {
    scrollFrame = undefined
    const reader = root.value
    if (!reader) return
    emit('scroll-progress', scrollProgress(reader.scrollTop, reader.scrollHeight, reader.clientHeight))
  })
}

function setScrollProgress(progress: number) {
  const reader = root.value
  if (!reader) return
  const next = scrollOffset(progress, reader.scrollHeight, reader.clientHeight)
  if (Math.abs(reader.scrollTop - next) < 1) return
  suppressScrollEvent = true
  reader.scrollTop = next
  window.requestAnimationFrame(() => { suppressScrollEvent = false })
}

defineExpose({ setScrollProgress })

function finishRender(rendered: string) {
  const elapsedMs = Math.max(0, Math.round(performance.now() - renderStartedAt))
  const nextHtml = deferExternalMarkdownImages(rendered)
  if (html.value === nextHtml) {
    if (progressiveOwnsDom && root.value) {
      const result = reconcileRootHtml(root.value, nextHtml, [])
      renderedChildSignatures = result.signatures
      root.value.dataset.previewReusedNodes = String(result.reused)
      root.value.dataset.previewReplacedNodes = String(result.replaced)
      delete root.value.dataset.previewProgressive
      clearProgressiveState()
    }
    // Vue does not notify a ref watcher when the next value is identical. A
    // cache hit or Frontmatter-only edit still completed real Worker work, so
    // explicitly settle the parent's loading state instead of leaving
    // “正在更新预览” visible forever.
    settleRenderedDom(elapsedMs)
    return
  }
  clearProgressiveState()
  elapsedForNextHtml = elapsedMs
  html.value = nextHtml
}

function progressiveRangesValid(reader: HTMLElement) {
  return progressiveRenderedBlockKeys.length === progressiveBlockRanges.length
    && progressiveBlockRanges.every(({ start, end }) => start.parentNode === reader && end.parentNode === reader)
}

function clearProgressiveState() {
  progressiveRenderedBlockKeys = []
  progressiveBlockRanges = []
  progressiveRenderInFlight = false
  progressiveOwnsDom = false
}

function removeProgressiveRange(range: ProgressiveBlockRange) {
  let node: ChildNode | null = range.start
  while (node) {
    const next: ChildNode | null = node.nextSibling
    node.remove()
    if (node === range.end) break
    node = next
  }
}

function insertProgressiveBlock(reader: HTMLElement, rendered: string, anchor: ChildNode | null) {
  const start = document.createComment('markdown-block-start')
  const end = document.createComment('markdown-block-end')
  const template = document.createElement('template')
  template.innerHTML = deferExternalMarkdownImages(rendered)
  const fragment = document.createDocumentFragment()
  fragment.append(start, template.content, end)
  reader.insertBefore(fragment, anchor)
  return { start, end } satisfies ProgressiveBlockRange
}

function cancelProgressiveRender() {
  progressiveRenderRevision += 1
  if (progressiveRenderFrame !== undefined) window.cancelAnimationFrame(progressiveRenderFrame)
  progressiveRenderFrame = undefined
  if (progressiveRenderInFlight) clearProgressiveState()
}

function finishProgressiveRender(blocks: readonly string[], blockKeys: readonly string[], workerElapsedMs: number) {
  cancelProgressiveRender()
  const reader = root.value
  if (!reader || !blocks.length) {
    pending.value = false
    finishRender(blocks.join(''))
    return
  }

  const revision = progressiveRenderRevision
  const rangesValid = blockKeys.length === blocks.length && progressiveRangesValid(reader)
  const plan = planMarkdownPreviewReconciliation(progressiveRenderedBlockKeys, blockKeys, rangesValid)
  progressiveOwnsDom = true
  progressiveRenderInFlight = true
  renderedChildSignatures = []
  if (plan.fullReplace) reader.replaceChildren()
  else {
    for (let oldIndex = plan.replaceStart; oldIndex < plan.previousReplaceEnd; oldIndex += 1) {
      const range = progressiveBlockRanges[oldIndex]
      if (range) removeProgressiveRange(range)
    }
  }
  const nextRanges = new Array<ProgressiveBlockRange>(blocks.length)
  for (let index = 0; index < plan.prefix; index += 1) nextRanges[index] = progressiveBlockRanges[index]!
  for (let offset = 0; offset < plan.suffix; offset += 1) {
    nextRanges[blocks.length - plan.suffix + offset] = progressiveBlockRanges[progressiveRenderedBlockKeys.length - plan.suffix + offset]!
  }
  const anchor = plan.suffix ? nextRanges[blocks.length - plan.suffix]?.start ?? null : null
  reader.dataset.previewProgressive = 'true'
  reader.dataset.previewReusedNodes = String(plan.prefix + plan.suffix)
  reader.dataset.previewReplacedNodes = String(plan.nextReplaceEnd - plan.replaceStart)
  emit('renderProgress', plan.prefix, blocks.length)
  let index = plan.replaceStart

  const complete = () => {
    progressiveRenderInFlight = false
    progressiveRenderedBlockKeys = [...blockKeys]
    progressiveBlockRanges = nextRanges
    pending.value = false
    emit('renderProgress', blocks.length, blocks.length)
    settleRenderedDom(workerElapsedMs)
  }

  const appendNextBatch = () => {
    progressiveRenderFrame = undefined
    if (revision !== progressiveRenderRevision || !root.value) return
    if (index >= plan.nextReplaceEnd) { complete(); return }
    const batch = nextMarkdownPreviewBatchRange(blocks, index, undefined, undefined, plan.nextReplaceEnd)
    if (!batch) {
      complete()
      return
    }
    for (let blockIndex = batch.start; blockIndex < batch.end; blockIndex += 1) {
      nextRanges[blockIndex] = insertProgressiveBlock(reader, blocks[blockIndex] ?? '', anchor)
    }
    index = batch.end
    emit('renderProgress', index, blocks.length)
    if (index >= plan.nextReplaceEnd) { complete(); return }
    progressiveRenderFrame = window.requestAnimationFrame(appendNextBatch)
  }

  // Let the loading chrome paint before the first bounded HTML parse/mount.
  progressiveRenderFrame = window.requestAnimationFrame(appendNextBatch)
}

function decodedWikiValue(value: string | undefined) {
  if (!value) return ''
  try { return decodeURIComponent(value) } catch { return value }
}

function wikiAnchorFromEvent(event: MouseEvent | KeyboardEvent) {
  if (!(event.target instanceof Element)) return undefined
  const anchor = event.target.closest<HTMLAnchorElement>('a[data-wiki-target]')
  return anchor && root.value?.contains(anchor) ? anchor : undefined
}

function mermaidDiagramFromEvent(event: MouseEvent | KeyboardEvent) {
  if (!(event.target instanceof Element)) return undefined
  const diagram = event.target.closest<HTMLElement>('.markdown-mermaid[data-mermaid-source]')
  return diagram && root.value?.contains(diagram) ? diagram : undefined
}

function markdownImageFromEvent(event: MouseEvent | KeyboardEvent) {
  if (!(event.target instanceof Element)) return undefined
  const image = event.target.closest<HTMLImageElement>('img')
  return image && root.value?.contains(image) ? image : undefined
}

function standardMarkdownLinkFromEvent(event: MouseEvent | KeyboardEvent) {
  if (!(event.target instanceof Element)) return undefined
  const anchor = event.target.closest<HTMLAnchorElement>('a.markdown-standard-link[href]:not([data-wiki-target])')
  return anchor && root.value?.contains(anchor) ? anchor : undefined
}

function markdownLinkLabel(anchor: HTMLAnchorElement) {
  return (anchor.textContent ?? '').replace(/\s+/g, ' ').trim() || anchor.getAttribute('href') || 'Markdown 链接'
}

function markdownImageSource(image: HTMLImageElement) {
  return image.getAttribute('data-external-image-src') || image.getAttribute('src') || ''
}

function markdownImageReady(image: HTMLImageElement) {
  return image.complete
    && image.naturalWidth > 0
    && image.naturalHeight > 0
    && image.dataset.externalImageState !== 'loading'
    && image.dataset.externalImageState !== 'error'
}

function decorateMarkdownImages() {
  for (const image of root.value?.querySelectorAll<HTMLImageElement>('img') ?? []) {
    if (image.closest('a')) continue
    image.tabIndex = 0
    image.setAttribute('role', 'button')
    image.setAttribute('aria-haspopup', 'menu')
    image.setAttribute('aria-label', `${image.alt || 'Markdown 图片'}；回车查看大图，菜单键打开图片操作`)
  }
  for (const anchor of root.value?.querySelectorAll<HTMLAnchorElement>('a.markdown-standard-link[href]:not([data-wiki-target])') ?? []) {
    anchor.setAttribute('aria-haspopup', 'menu')
    anchor.setAttribute('aria-label', `${markdownLinkLabel(anchor)}；回车打开，菜单键查看链接操作`)
  }
}

function closeImageContextMenu(restoreFocus = false) {
  imageContextMenu.value = undefined
  if (restoreFocus) void nextTick(() => imageMenuTrigger?.isConnected && imageMenuTrigger.focus({ preventScroll: true }))
}

function closeMarkdownMediaMenus() {
  closeDiagramContextMenu()
  closeImageContextMenu()
  closeLinkContextMenu()
}

function closeLinkContextMenu(restoreFocus = false) {
  linkContextMenu.value = undefined
  if (restoreFocus) void nextTick(() => linkMenuTrigger?.isConnected && linkMenuTrigger.focus({ preventScroll: true }))
}

function openLinkContextMenu(target: HTMLAnchorElement, x: number, y: number) {
  linkMenuTrigger = target
  linkContextMenu.value = {
    target,
    href: target.getAttribute('href') ?? '',
    label: markdownLinkLabel(target),
    ...clampMenuPosition(x, y, { menuWidth: 270, menuHeight: 170, margin: 12 }),
  }
  void nextTick(() => linkMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true }))
}

function handleLinkMenuKeydown(event: KeyboardEvent) {
  const items = [...(linkMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (!items.length) return
  if (event.key === 'Escape') { event.preventDefault(); closeLinkContextMenu(true); return }
  const nextIndex = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  items[nextIndex]?.focus()
}

function openStandardMarkdownLink(target = linkContextMenu.value?.target) {
  if (!target) return
  const href = target.getAttribute('href') ?? ''
  const label = markdownLinkLabel(target)
  closeLinkContextMenu()
  emit('link-open', href, label)
}

async function copyStandardMarkdownLink(format: 'address' | 'markdown') {
  const context = linkContextMenu.value
  if (!context) return
  closeLinkContextMenu(true)
  try {
    await navigator.clipboard.writeText(format === 'markdown' ? markdownLinkMarkup(context.label, context.href) : context.href)
    linkStatus.value = format === 'markdown' ? 'Markdown 链接引用已复制。' : '链接地址已复制。'
  } catch {
    linkStatus.value = '无法访问系统剪贴板，未复制链接。'
  }
}

function openImageContextMenu(target: HTMLImageElement, x: number, y: number) {
  imageMenuTrigger = target
  imageContextMenu.value = {
    target,
    source: markdownImageSource(target),
    alt: target.alt || '图片',
    ready: markdownImageReady(target),
    ...clampMenuPosition(x, y, { menuWidth: 252, menuHeight: 190, margin: 12 }),
  }
  void nextTick(() => imageMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}

function handleImageMenuKeydown(event: KeyboardEvent) {
  const items = [...(imageMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (!items.length) return
  if (event.key === 'Escape') { event.preventDefault(); closeImageContextMenu(true); return }
  const nextIndex = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  items[nextIndex]?.focus()
}

function openImageViewer(target = imageContextMenu.value?.target) {
  if (!target || !markdownImageReady(target)) {
    imageStatus.value = '图片尚未载入完成，暂时无法查看大图。'
    closeImageContextMenu(true)
    return
  }
  imageViewer.value = {
    src: target.currentSrc || target.src,
    source: markdownImageSource(target),
    alt: target.alt || 'Markdown 图片',
    width: target.naturalWidth,
    height: target.naturalHeight,
  }
  imageViewerActualSize.value = false
  closeImageContextMenu()
  void nextTick(() => imageViewerCloseButton.value?.focus({ preventScroll: true }))
}

function closeImageViewer(restoreFocus = true) {
  if (!imageViewer.value) return
  imageViewer.value = undefined
  imageViewerActualSize.value = false
  if (restoreFocus) void nextTick(() => imageMenuTrigger?.isConnected && imageMenuTrigger.focus({ preventScroll: true }))
}

function handleImageViewerKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeImageViewer(); return }
  if (event.key === '0') { event.preventDefault(); imageViewerActualSize.value = !imageViewerActualSize.value }
  if (event.key !== 'Tab') return
  const controls = [...(imageViewerElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
  if (!controls.length) return
  const current = controls.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.shiftKey
    ? (current <= 0 ? controls.length - 1 : current - 1)
    : (current < 0 || current === controls.length - 1 ? 0 : current + 1)
  event.preventDefault()
  controls[next]?.focus()
}

function imageAsPngBlob(image: HTMLImageElement) {
  return new Promise<Blob>((resolve, reject) => {
    const pixels = image.naturalWidth * image.naturalHeight
    if (!image.naturalWidth || !image.naturalHeight || pixels > 24_000_000) {
      reject(new Error('图片为空或超过 2400 万像素；请先在图片工作室缩小。'))
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) { reject(new Error('当前设备无法创建图片画布。')); return }
    context.drawImage(image, 0, 0)
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法生成可复制的 PNG。')), 'image/png')
  })
}

async function copyPreviewImage() {
  const context = imageContextMenu.value
  if (!context?.ready) return
  closeImageContextMenu()
  try {
    await copyPngToClipboard(await imageAsPngBlob(context.target))
    imageStatus.value = '图片当前画面已复制到系统剪贴板。'
  } catch (error) {
    imageStatus.value = error instanceof Error ? error.message : '无法复制这张图片。'
  }
}

async function copyPreviewImageMarkdown() {
  const context = imageContextMenu.value
  if (!context) return
  closeImageContextMenu()
  try {
    await navigator.clipboard.writeText(markdownPreviewImageMarkup(context.source, context.alt))
    imageStatus.value = '图片的 Markdown 引用已复制。'
  } catch {
    imageStatus.value = '无法访问系统剪贴板，未复制图片引用。'
  }
}

async function editPreviewImage() {
  const context = imageContextMenu.value
  if (!context?.ready) return
  closeImageContextMenu()
  try {
    const response = await fetch(context.target.currentSrc || context.target.src)
    if (!response.ok) throw new Error('无法读取当前图片。')
    const blob = await response.blob()
    if (!blob.type.startsWith('image/')) throw new Error('当前资源不是可编辑图片。')
    if (!blob.size || blob.size > 32 * 1024 * 1024) throw new Error('图片为空或超过 32 MB，未送入图片工作室。')
    emit('image-edit', new File([blob], markdownPreviewImageFilename(context.source, context.alt, blob.type), { type: blob.type }))
  } catch (error) {
    imageStatus.value = error instanceof Error ? error.message : '无法把图片送入图片工作室。'
  }
}

function markdownHeadingFromEvent(event: MouseEvent) {
  if (!(event.target instanceof Element)) return undefined
  const heading = event.target.closest<HTMLElement>('h1, h2, h3, h4, h5, h6')
  if (!heading || !root.value?.contains(heading) || heading.hasAttribute('data-duplicate-document-title')) return undefined
  const label = (heading.textContent ?? '').replace(/\s+/g, ' ').trim()
  return label ? { heading, label } : undefined
}

function handleRootClick(event: MouseEvent) {
  closeDiagramContextMenu()
  closeImageContextMenu()
  closeLinkContextMenu()
  const image = markdownImageFromEvent(event)
  if (image && !image.closest('a')) {
    event.preventDefault()
    openImageViewer(image)
    return
  }
  const anchor = wikiAnchorFromEvent(event)
  if (anchor) {
    event.preventDefault()
    emit('wikiOpen', decodedWikiValue(anchor.dataset.wikiTarget), decodedWikiValue(anchor.dataset.wikiHeading) || undefined)
    return
  }
  const link = standardMarkdownLinkFromEvent(event)
  if (!link) return
  event.preventDefault()
  openStandardMarkdownLink(link)
}

function rootContainsTextSelection() {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1 || !root.value) return false
  return root.value.contains(selection.getRangeAt(0).commonAncestorContainer)
}

function handleRootContextMenu(event: MouseEvent) {
  // Let the owning reader provide its Typora-like selection menu. Dedicated
  // link, heading and diagram menus remain the priority when nothing is
  // selected.
  if (rootContainsTextSelection()) {
    closeMarkdownMediaMenus()
    return
  }
  const image = markdownImageFromEvent(event)
  if (image) {
    event.preventDefault()
    event.stopPropagation()
    closeMarkdownMediaMenus()
    openImageContextMenu(image, event.clientX, event.clientY)
    return
  }
  const diagram = mermaidDiagramFromEvent(event)
  if (diagram) {
    event.preventDefault()
    closeMarkdownMediaMenus()
    openDiagramContextMenu(diagram, event.clientX, event.clientY)
    return
  }
  const anchor = wikiAnchorFromEvent(event)
  if (anchor) {
    event.preventDefault()
    closeMarkdownMediaMenus()
    emit('wikiContext', decodedWikiValue(anchor.dataset.wikiTarget), decodedWikiValue(anchor.dataset.wikiHeading) || undefined, event.clientX, event.clientY, anchor)
    return
  }
  const link = standardMarkdownLinkFromEvent(event)
  if (link) {
    event.preventDefault()
    event.stopPropagation()
    closeMarkdownMediaMenus()
    openLinkContextMenu(link, event.clientX, event.clientY)
    return
  }
  const context = markdownHeadingFromEvent(event)
  if (!context) return
  event.preventDefault()
  emit('headingContext', context.label, event.clientX, event.clientY, context.heading)
}

function handleRootKeydown(event: KeyboardEvent) {
  const image = markdownImageFromEvent(event)
  if (image && !image.closest('a')) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openImageViewer(image)
      return
    }
    if (isContextMenuShortcut(event)) {
      event.preventDefault()
      event.stopPropagation()
      const bounds = image.getBoundingClientRect()
      openImageContextMenu(image, bounds.left + 28, bounds.top + 28)
      return
    }
  }
  const standardLink = standardMarkdownLinkFromEvent(event)
  if (standardLink && event.key === 'Enter') {
    event.preventDefault()
    openStandardMarkdownLink(standardLink)
    return
  }
  if (!isContextMenuShortcut(event)) return
  const diagram = mermaidDiagramFromEvent(event)
  if (diagram) {
    event.preventDefault()
    const bounds = diagram.getBoundingClientRect()
    openDiagramContextMenu(diagram, bounds.left + 28, bounds.top + 28)
    return
  }
  const anchor = wikiAnchorFromEvent(event)
  if (anchor) {
    event.preventDefault()
    const bounds = anchor.getBoundingClientRect()
    emit('wikiContext', decodedWikiValue(anchor.dataset.wikiTarget), decodedWikiValue(anchor.dataset.wikiHeading) || undefined, bounds.right + 8, bounds.top + 8, anchor)
    return
  }
  if (!standardLink) return
  event.preventDefault()
  event.stopPropagation()
  const bounds = standardLink.getBoundingClientRect()
  openLinkContextMenu(standardLink, bounds.right + 8, bounds.top + 8)
}

function closeDiagramContextMenu(restoreFocus = false) {
  diagramContextMenu.value = null
  if (restoreFocus) void nextTick(() => diagramMenuTrigger?.focus())
}

function openDiagramContextMenu(target: HTMLElement, x: number, y: number) {
  diagramMenuTrigger = target
  diagramContextMenu.value = {
    target,
    state: target.dataset.mermaidState ?? 'idle',
    sourceVisible: target.dataset.mermaidSourceVisible === 'true',
    hasSvg: Boolean(target.querySelector('.markdown-mermaid__canvas svg')),
    ...clampMenuPosition(x, y, { menuWidth: 236, menuHeight: 174, margin: 12 })
  }
  void nextTick(() => diagramMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}

function handleDiagramMenuKeydown(event: KeyboardEvent) {
  const items = [...(diagramMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (!items.length) return
  if (event.key === 'Escape') { event.preventDefault(); closeDiagramContextMenu(true); return }
  const nextIndex = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  items[nextIndex]?.focus()
}

async function copyDiagramSource() {
  const context = diagramContextMenu.value
  if (!context) return
  const source = decodeMermaidSource(context.target.dataset.mermaidSource)
  try {
    await navigator.clipboard.writeText(source)
    diagramStatus.value = 'Mermaid 源码已复制。'
  } catch {
    diagramStatus.value = '无法访问系统剪贴板，未复制 Mermaid 源码。'
  } finally {
    closeDiagramContextMenu()
  }
}

async function copyDiagramSvg() {
  const context = diagramContextMenu.value
  const svg = context?.target.querySelector<SVGElement>('.markdown-mermaid__canvas svg')
  if (!svg) return
  try {
    await navigator.clipboard.writeText(svg.outerHTML)
    diagramStatus.value = '已复制当前图表的 SVG。'
  } catch {
    diagramStatus.value = '无法访问系统剪贴板，未复制 SVG。'
  } finally {
    closeDiagramContextMenu()
  }
}

function toggleDiagramSource() {
  const context = diagramContextMenu.value
  if (!context) return
  const visible = !context.sourceVisible
  context.target.dataset.mermaidSourceVisible = String(visible)
  diagramStatus.value = visible ? '已显示 Mermaid 源码。' : '已收起 Mermaid 源码。'
  closeDiagramContextMenu()
}

function renderDiagramFromMenu() {
  const context = diagramContextMenu.value
  if (!context || ['queued', 'loading'].includes(context.state)) return
  const canvas = context.target.querySelector<HTMLElement>('.markdown-mermaid__canvas')
  canvas?.replaceChildren()
  context.target.dataset.mermaidState = 'idle'
  context.target.setAttribute('aria-busy', 'false')
  renderDiagram(context.target, diagramRevision, 'user')
  diagramStatus.value = '图表已加入优先渲染队列。'
  closeDiagramContextMenu()
}

function showDiagramError(target: HTMLElement, error: unknown) {
  const canvas = target.querySelector<HTMLElement>('.markdown-mermaid__canvas')
  if (!canvas) return
  const message = document.createElement('p')
  message.className = 'markdown-mermaid__error'
  message.textContent = `图表语法无法渲染：${error instanceof Error ? error.message : '请检查 Mermaid 代码块。'}`
  canvas.replaceChildren(message)
}

function renderDiagram(target: HTMLElement, revision: number, priority: 'normal' | 'user' = 'normal') {
  if (target.dataset.mermaidState === 'queued' || target.dataset.mermaidState === 'loading' || target.dataset.mermaidState === 'ready') return
  const source = decodeMermaidSource(target.dataset.mermaidSource)
  if (!source) return
  target.dataset.mermaidState = 'queued'
  target.setAttribute('aria-busy', 'true')
  target.setAttribute('aria-label', 'Mermaid 图表等待渲染')
  diagramQueue.enqueue(async () => {
    if (revision !== diagramRevision || !target.isConnected) return
    target.dataset.mermaidState = 'loading'
    target.setAttribute('aria-label', '正在渲染 Mermaid 图表')
    try {
      const svg = await renderMermaidSource(source)
      if (revision !== diagramRevision || !target.isConnected) return
      const canvas = target.querySelector<HTMLElement>('.markdown-mermaid__canvas')
      if (!canvas) return
      canvas.innerHTML = svg
      target.dataset.mermaidState = 'ready'
      target.setAttribute('aria-busy', 'false')
      target.setAttribute('aria-label', 'Mermaid 图表已渲染')
    } catch (error) {
      if (revision !== diagramRevision || !target.isConnected) return
      target.dataset.mermaidState = 'error'
      target.setAttribute('aria-busy', 'false')
      target.setAttribute('aria-label', 'Mermaid 图表语法无法渲染')
      showDiagramError(target, error)
    }
  }, priority)
}

function hydrateMermaidDiagrams() {
  mermaidObserver?.disconnect()
  mermaidObserver = undefined
  diagramQueue.clear()
  const revision = ++diagramRevision
  const diagrams = [...(root.value?.querySelectorAll<HTMLElement>('.markdown-mermaid[data-mermaid-source]') ?? [])]
  // A second hydration can happen during the same Vue paint. Return entries
  // that were queued by the superseded pass to idle before observing again.
  diagrams.forEach((diagram) => {
    if (diagram.dataset.mermaidState !== 'queued') return
    diagram.dataset.mermaidState = 'idle'
    diagram.setAttribute('aria-busy', 'false')
    diagram.setAttribute('aria-label', 'Mermaid 图表，滚动到此处加载')
  })
  if (!diagrams.length) return
  if (typeof IntersectionObserver === 'undefined') {
    diagrams.forEach((diagram) => renderDiagram(diagram, revision))
    return
  }
  mermaidObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting)
      .sort((a, b) => Math.abs(a.boundingClientRect.top - window.innerHeight / 2) - Math.abs(b.boundingClientRect.top - window.innerHeight / 2))
    for (const entry of visible) {
      mermaidObserver?.unobserve(entry.target)
      renderDiagram(entry.target as HTMLElement, revision)
    }
  }, { rootMargin: '240px 0px' })
  diagrams.forEach((diagram) => mermaidObserver?.observe(diagram))
}

function loadExternalImage(image: HTMLImageElement, source: string, revision: number) {
  if (image.dataset.externalImageState === 'loading' || image.dataset.externalImageState === 'ready') return
  const markdownPath = props.externalMarkdownPath
  const documentId = props.documentId
  if (!markdownPath && !documentId) return
  image.dataset.externalImageState = 'loading'
  image.setAttribute('aria-busy', 'true')
  const request = markdownPath
    ? readExternalMarkdownImage(markdownPath, source)
    : readDesktopVaultMarkdownImage(documentId, source)
  void request
    .then((dataUrl) => {
      if (revision !== imageRevision || !image.isConnected) return
      image.src = dataUrl
      image.dataset.externalImageState = 'ready'
      image.setAttribute('aria-busy', 'false')
    })
    .catch((error) => {
      if (revision !== imageRevision || !image.isConnected) return
      image.dataset.externalImageState = 'error'
      image.setAttribute('aria-busy', 'false')
      image.title = error instanceof Error ? error.message : '无法载入相对图片。'
    })
}

function hydrateExternalMarkdownImages() {
  imageObserver?.disconnect()
  imageObserver = undefined
  const revision = ++imageRevision
  if (!props.externalMarkdownPath && !props.documentId) return
  const images = [...(root.value?.querySelectorAll<HTMLImageElement>('img[data-external-image-src]') ?? [])]
    .map((image) => ({ image, source: image.getAttribute('data-external-image-src') ?? '' }))
    .filter(({ source }) => isRelativeLocalImage(source))
  if (!images.length) return
  if (typeof IntersectionObserver === 'undefined') {
    images.forEach(({ image, source }) => loadExternalImage(image, source, revision))
    return
  }
  imageObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      imageObserver?.unobserve(entry.target)
      const image = entry.target as HTMLImageElement
      loadExternalImage(image, image.getAttribute('data-external-image-src') ?? '', revision)
    }
  }, { root: root.value, rootMargin: '320px 0px' })
  images.forEach(({ image }) => imageObserver?.observe(image))
}

function highlightVisibleCode(target: HTMLElement, revision: number) {
  if (target.dataset.codeHighlightState === 'loading' || target.dataset.codeHighlightState === 'ready') return
  const code = target.querySelector<HTMLElement>('code[data-deferred-code-language]')
  if (!code || !previewWorker) return
  target.dataset.codeHighlightState = 'loading'
  target.setAttribute('aria-busy', 'true')
  const id = ++codeHighlightRequestId
  codeHighlightRequests.set(id, { target, revision })
  previewWorker.postMessage({ type: 'highlight', id, source: code.textContent ?? '', language: code.dataset.deferredCodeLanguage ?? '' })
}

function hydrateDeferredCodeHighlights() {
  codeObserver?.disconnect()
  codeObserver = undefined
  const revision = ++codeRevision
  const frames = [...(root.value?.querySelectorAll<HTMLElement>('.code-frame[data-code-highlight-state]') ?? [])]
  if (!frames.length || !previewWorker) return
  if (typeof IntersectionObserver === 'undefined') {
    frames.forEach((frame) => highlightVisibleCode(frame, revision))
    return
  }
  codeObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      codeObserver?.unobserve(entry.target)
      highlightVisibleCode(entry.target as HTMLElement, revision)
    }
  }, { rootMargin: '320px 0px' })
  frames.forEach((frame) => codeObserver?.observe(frame))
}

function decodeDeferredMath(value: string | undefined) {
  if (!value) return ''
  try { return decodeURIComponent(value) } catch { return value }
}

function renderVisibleMath(target: HTMLElement, revision: number) {
  if (target.dataset.mathState === 'loading' || target.dataset.mathState === 'ready') return
  if (!previewWorker) return
  target.dataset.mathState = 'loading'
  target.setAttribute('aria-busy', 'true')
  const id = ++mathRequestId
  mathRequests.set(id, { target, revision })
  previewWorker.postMessage({ type: 'math', id, source: decodeDeferredMath(target.dataset.deferredMath), displayMode: target.dataset.mathDisplay === 'true' })
}

function hydrateDeferredMath() {
  mathObserver?.disconnect()
  mathObserver = undefined
  const revision = ++mathRevision
  const formulas = [...(root.value?.querySelectorAll<HTMLElement>('[data-deferred-math]') ?? [])]
  if (!formulas.length || !previewWorker) return
  if (typeof IntersectionObserver === 'undefined') {
    formulas.forEach((formula) => renderVisibleMath(formula, revision))
    return
  }
  mathObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      mathObserver?.unobserve(entry.target)
      renderVisibleMath(entry.target as HTMLElement, revision)
    }
  }, { rootMargin: '260px 0px' })
  formulas.forEach((formula) => mathObserver?.observe(formula))
}

function emitOutline() {
  // This reads only the headings already present in the preview DOM. It avoids
  // a second Markdown pass (or a main-thread source scan) just to populate the
  // optional inspector outline, which matters for long technical notes.
  const headings = [...(root.value?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? [])]
    .filter((heading) => !heading.hasAttribute('data-duplicate-document-title'))
    .slice(0, 160)
    .map((heading, index) => ({
      label: (heading.textContent ?? '').replace(/\s+/g, ' ').trim(),
      level: Number(heading.tagName.slice(1)),
      index,
    }))
    .filter((heading) => heading.label)
  emit('outline', headings)
}

function normalizedHeading(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('zh-CN')
}

function syncLeadingTitle() {
  const firstHeading = root.value?.querySelector<HTMLElement>(':scope > h1')
  if (!firstHeading) return
  const title = normalizedHeading(props.suppressLeadingTitle)
  const duplicate = Boolean(title) && normalizedHeading(firstHeading.textContent ?? '') === title
  firstHeading.toggleAttribute('data-duplicate-document-title', duplicate)
}

function render(source: string) {
  domHydrationBatch.clear()
  // The immediate watcher runs before onMounted. Do not let a long initial
  // document fall back to the UI thread in that tiny gap while its Worker is
  // being created.
  if (props.worker && typeof Worker !== 'undefined' && !previewWorker) {
    if (!pending.value) emit('renderStart')
    pending.value = true
    return
  }
  if (previewWorker) {
    const id = ++renderRequestId
    latestRequestId = id
    if (!pending.value) emit('renderStart')
    pending.value = true
    renderStartedAt = performance.now()
    previewWorker.postMessage({ type: 'render', id, source, progressive: props.largeReader })
    return
  }
  renderStartedAt = performance.now()
  pending.value = false
  finishRender(renderMarkdownCached(source))
}

watch(() => props.source, (source) => {
  if (renderTimer !== undefined) window.clearTimeout(renderTimer)
  cancelProgressiveRender()
  // A small coalescing window makes split view responsive without redoing full
  // Markdown + KaTeX + highlight work for every keystroke.
  const shouldDefer = props.defer || source.length > 48_000
  if (!shouldDefer) { render(source); return }
  pending.value = true
  renderTimer = window.setTimeout(() => render(source), source.length > 240_000 ? 420 : 180)
}, { immediate: true })

function settleRenderedDom(workerElapsedMs?: number) {
  // The menu stores a concrete DOM target. A new preview revision replaces
  // that tree, so close it before it can point at stale diagram markup.
  closeDiagramContextMenu()
  closeImageContextMenu()
  closeLinkContextMenu()
  void nextTick(() => {
    syncLeadingTitle()
    // Include the incremental DOM reconciliation in the visible timing.
    // Reporting only the Worker parse made a multi-megabyte preview look ready
    // before its DOM was actually usable.
    const visibleElapsedMs = renderStartedAt
      ? Math.max(workerElapsedMs ?? 0, Math.round(performance.now() - renderStartedAt))
      : workerElapsedMs
    emit('rendered', visibleElapsedMs)
    // The HTML is readable at this point. Enhancement scans are intentionally
    // spread over idle turns so a large note does not block selection,
    // scrolling or a desktop context menu immediately after preview mount.
    domHydrationBatch.run([
      hydrateDeferredCodeHighlights,
      hydrateDeferredMath,
      hydrateMermaidDiagrams,
      hydrateExternalMarkdownImages,
      decorateMarkdownImages,
      emitOutline,
    ])
  })
}

watch(html, (nextHtml) => {
  const elapsedMs = elapsedForNextHtml
  elapsedForNextHtml = undefined
  if (root.value) {
    const result = reconcileRootHtml(root.value, nextHtml, renderedChildSignatures)
    renderedChildSignatures = result.signatures
    // Small, inspectable counters make desktop performance QA possible without
    // retaining DOM nodes or adding a development-only observer to production.
    root.value.dataset.previewReusedNodes = String(result.reused)
    root.value.dataset.previewReplacedNodes = String(result.replaced)
    delete root.value.dataset.previewProgressive
  }
  settleRenderedDom(elapsedMs)
})

watch([() => props.externalMarkdownPath, () => props.documentId], () => {
  if (!props.externalMarkdownPath && !props.documentId) return
  const deferred = deferExternalMarkdownImages(html.value)
  if (deferred !== html.value) {
    html.value = deferred
    return
  }
  // Switching between linked files can keep the rendered Markdown string
  // identical. Reset only the visible-image state, without reparsing text.
  for (const image of root.value?.querySelectorAll<HTMLImageElement>('img[data-external-image-src]') ?? []) {
    delete image.dataset.externalImageState
    image.removeAttribute('title')
    image.src = externalImagePlaceholder
  }
  void nextTick(hydrateExternalMarkdownImages)
})

watch(() => props.suppressLeadingTitle, () => {
  void nextTick(() => {
    syncLeadingTitle()
    emitOutline()
  })
})

onMounted(() => {
  if (html.value && root.value && root.value.childNodes.length === 0) {
    const result = reconcileRootHtml(root.value, html.value, renderedChildSignatures)
    renderedChildSignatures = result.signatures
    root.value.dataset.previewReusedNodes = String(result.reused)
    root.value.dataset.previewReplacedNodes = String(result.replaced)
  }
  hydrateMermaidDiagrams()
  hydrateExternalMarkdownImages()
  decorateMarkdownImages()
  window.addEventListener('knitspace:close-context-menus', closeMarkdownMediaMenus)
  if (!props.worker || typeof Worker === 'undefined') return
  previewWorker = new Worker(new URL('../workers/markdown-preview.worker.ts', import.meta.url), { type: 'module' })
  previewWorker.onmessage = ({ data }: MessageEvent<{ type: 'render' | 'highlight' | 'math'; id: number; html?: string; htmlBlocks?: string[]; blockKeys?: string[]; error?: string }>) => {
    if (data.type === 'highlight') {
      const request = codeHighlightRequests.get(data.id)
      codeHighlightRequests.delete(data.id)
      if (!request || request.revision !== codeRevision || !request.target.isConnected) return
      const code = request.target.querySelector<HTMLElement>('code[data-deferred-code-language]')
      if (data.html !== undefined && code) {
        code.innerHTML = data.html
        delete code.dataset.deferredCodeLanguage
        request.target.dataset.codeHighlightState = 'ready'
      } else {
        request.target.dataset.codeHighlightState = 'error'
      }
      request.target.setAttribute('aria-busy', 'false')
      return
    }
    if (data.type === 'math') {
      const request = mathRequests.get(data.id)
      mathRequests.delete(data.id)
      if (!request || request.revision !== mathRevision || !request.target.isConnected) return
      if (data.html !== undefined) {
        request.target.innerHTML = data.html
        delete request.target.dataset.deferredMath
        request.target.dataset.mathState = 'ready'
      } else {
        request.target.dataset.mathState = 'error'
      }
      request.target.setAttribute('aria-busy', 'false')
      return
    }
    if (data.id !== latestRequestId) return
    if (data.htmlBlocks !== undefined) {
      finishProgressiveRender(data.htmlBlocks, data.blockKeys ?? [], Math.max(0, Math.round(performance.now() - renderStartedAt)))
      return
    }
    if (data.html !== undefined) finishRender(data.html)
    else if (data.error) {
      // A worker failure is rare (for example an extension blocking a module),
      // but a readable preview is still better than an empty panel.
      previewWorker?.terminate()
      previewWorker = undefined
      finishRender(renderMarkdownCached(props.source))
    }
    pending.value = false
  }
  previewWorker.onerror = () => {
    previewWorker?.terminate()
    previewWorker = undefined
    pending.value = false
    finishRender(renderMarkdownCached(props.source))
  }
  render(props.source)
})

onBeforeUnmount(() => {
  if (renderTimer !== undefined) window.clearTimeout(renderTimer)
  if (scrollFrame !== undefined) window.cancelAnimationFrame(scrollFrame)
  cancelProgressiveRender()
  mermaidObserver?.disconnect()
  closeDiagramContextMenu()
  closeImageContextMenu()
  closeLinkContextMenu()
  closeImageViewer(false)
  window.removeEventListener('knitspace:close-context-menus', closeMarkdownMediaMenus)
  domHydrationBatch.clear()
  diagramQueue.clear()
  diagramRevision += 1
  codeObserver?.disconnect()
  codeRevision += 1
  codeHighlightRequests.clear()
  mathObserver?.disconnect()
  mathRevision += 1
  mathRequests.clear()
  imageObserver?.disconnect()
  imageRevision += 1
  previewWorker?.terminate()
})
</script>

<template>
  <article ref="root" v-bind="$attrs" class="markdown-content" :class="{ 'markdown-content--compact': compact, 'markdown-content--pending': pending, 'markdown-content--large-reader': largeReader }" :aria-busy="pending" @scroll.passive="handleRootScroll" @click="handleRootClick" @contextmenu="handleRootContextMenu" @keydown="handleRootKeydown"></article>
  <p class="visually-hidden" aria-live="polite">{{ diagramStatus }}</p>
  <p class="visually-hidden" aria-live="polite">{{ imageStatus }}</p>
  <p class="visually-hidden" aria-live="polite">{{ linkStatus }}</p>
  <Teleport to="body">
    <!-- Three menus that used to carry their own panel, row and hover styling —
         a fourth design of the same object. They speak the shared menu
         vocabulary now, which is also what put them back on the ordinary menu
         layer: the link and image menus had been sitting on the global-modal
         layer, above dialogs that are supposed to eclipse them. -->
    <section v-if="diagramContextMenu" ref="diagramMenuElement" class="menu-panel w-[236px]" role="menu" aria-label="Mermaid 图表操作" :style="{ left: `${diagramContextMenu.x}px`, top: `${diagramContextMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleDiagramMenuKeydown">
      <p class="menu-title">MERMAID · 图表</p>
      <button class="menu-item" role="menuitem" @click="copyDiagramSource">复制 Mermaid 源码</button>
      <button class="menu-item" role="menuitem" :disabled="!diagramContextMenu.hasSvg" @click="copyDiagramSvg">复制当前 SVG</button>
      <button class="menu-item" role="menuitem" @click="toggleDiagramSource">{{ diagramContextMenu.sourceVisible ? '收起 Mermaid 源码' : '显示 Mermaid 源码' }}</button>
      <i class="menu-sep" aria-hidden="true"></i>
      <button class="menu-item" role="menuitem" :disabled="['queued', 'loading'].includes(diagramContextMenu.state)" @click="renderDiagramFromMenu">{{ diagramContextMenu.state === 'idle' ? '立即绘制图表' : '重新绘制图表' }}</button>
    </section>
    <section v-if="imageContextMenu" ref="imageMenuElement" class="menu-panel w-[252px]" role="menu" aria-label="Markdown 图片操作" :style="{ left: `${imageContextMenu.x}px`, top: `${imageContextMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleImageMenuKeydown">
      <p class="menu-title"><span>图片</span><small class="font-medium">{{ imageContextMenu.target.naturalWidth || '—' }} × {{ imageContextMenu.target.naturalHeight || '—' }} px</small></p>
      <button class="menu-item" role="menuitem" :disabled="!imageContextMenu.ready" @click="openImageViewer()"><span class="row gap-2 min-w-0"><AppIcon name="image" :size="14" />查看大图</span><kbd class="kbd">Enter</kbd></button>
      <button class="menu-item" role="menuitem" :disabled="!imageContextMenu.ready" @click="copyPreviewImage"><span class="row gap-2 min-w-0"><AppIcon name="duplicate" :size="14" />复制当前画面</span><kbd class="kbd">PNG</kbd></button>
      <button class="menu-item" role="menuitem" @click="copyPreviewImageMarkdown"><span class="row gap-2 min-w-0"><AppIcon name="code" :size="14" />复制 Markdown 引用</span></button>
      <i class="menu-sep" aria-hidden="true"></i>
      <button class="menu-item" role="menuitem" :disabled="!imageContextMenu.ready" @click="editPreviewImage"><span class="row gap-2 min-w-0"><AppIcon name="palette" :size="14" />在图片工作室打开</span><kbd class="kbd">本地</kbd></button>
    </section>
    <section v-if="linkContextMenu" ref="linkMenuElement" class="menu-panel w-[min(270px,calc(100vw-24px))]" role="menu" :aria-label="`${linkContextMenu.label}链接操作`" :style="{ left: `${linkContextMenu.x}px`, top: `${linkContextMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleLinkMenuKeydown">
      <p class="stack gap-0.5 min-w-0 px-3 pt-1 pb-1.5"><span class="text-[11px] font-semibold text-fg-3">{{ linkContextMenu.label }}</span><small class="truncate text-[11px] text-fg-3">{{ linkContextMenu.href }}</small></p>
      <button class="menu-item" role="menuitem" @click="openStandardMarkdownLink()"><span class="row gap-2 min-w-0"><AppIcon name="arrow-right" :size="14" />打开链接</span><kbd class="kbd">Enter</kbd></button>
      <button class="menu-item" role="menuitem" @click="copyStandardMarkdownLink('address')"><span class="row gap-2 min-w-0"><AppIcon name="duplicate" :size="14" />复制链接地址</span></button>
      <button class="menu-item" role="menuitem" @click="copyStandardMarkdownLink('markdown')"><span class="row gap-2 min-w-0"><AppIcon name="code" :size="14" />复制 Markdown 引用</span></button>
    </section>
    <section v-if="imageViewer" ref="imageViewerElement" class="markdown-image-viewer" role="dialog" aria-modal="true" :aria-label="`${imageViewer.alt}大图预览`" tabindex="-1" @click.self="closeImageViewer()" @keydown.stop="handleImageViewerKeydown">
      <header>
        <div><span>Markdown 图片</span><b>{{ imageViewer.alt }}</b><small>{{ imageViewer.width }} × {{ imageViewer.height }} px</small></div>
        <nav aria-label="大图查看控制"><button type="button" :class="{ active: !imageViewerActualSize }" :aria-pressed="!imageViewerActualSize" @click="imageViewerActualSize = false">适应窗口</button><button type="button" :class="{ active: imageViewerActualSize }" :aria-pressed="imageViewerActualSize" @click="imageViewerActualSize = true">100%</button><button ref="imageViewerCloseButton" type="button" aria-label="关闭大图查看" title="关闭 · Escape" @click="closeImageViewer()"><AppIcon name="close" :size="16" /></button></nav>
      </header>
      <div class="markdown-image-viewer__canvas" :class="{ 'is-actual': imageViewerActualSize }"><img :src="imageViewer.src" :alt="imageViewer.alt" draggable="false" /></div>
      <footer><span>{{ imageViewerActualSize ? '原始像素 · 可滚动查看' : '完整适应窗口' }}</span><kbd>0</kbd><span>切换比例</span><kbd>Esc</kbd><span>关闭</span></footer>
    </section>
  </Teleport>
</template>
