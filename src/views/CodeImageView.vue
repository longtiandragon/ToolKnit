<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PDFDocument } from 'pdf-lib'
import { toBlob } from 'html-to-image'
import { splitCodeForExport } from '@/lib/code-image'
import { codeLanguages, detectCodeLanguage, highlightCode, type CodeLanguage } from '@/lib/code-highlight'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import { chooseOutputDirectory, exportOutput } from '@/lib/output'
import { copyPngFilesToClipboard, copyPngToClipboard, isDesktop, revealDesktopFile } from '@/lib/native'
import type { FileReference } from '@/types'
import FileDropZone from '@/components/FileDropZone.vue'
import CodeSnapCard from '@/components/CodeSnapCard.vue'
import AppIcon from '@/components/AppIcon.vue'

const store = useWorkbenchStore()
const ui = useUiStore()
const codeFiles = ref<File[]>([])
const captureHost = ref<HTMLElement>()
const exporting = ref(false)
const copying = ref(false)
const lastOutputs = ref<FileReference[]>([])
const activePage = ref(0)
const selectedPages = ref(new Set([0]))
const previewStage = ref<HTMLElement>()
const contextMenu = ref({ open: false, x: 0, y: 0, page: 0 })

const defaultCode = `#include <bits/stdc++.h>
using namespace std;

bool isPrime(int x) {
  if (x <= 1) return false;
  for (int i = 2; i <= x / i; i++) {
    if (x % i == 0) return false;
  }
  return true;
}`

const code = ref(store.codeDraft?.content ?? defaultCode)
const sourceName = ref(store.codeDraft?.name ?? 'is-prime.cpp')
const languageOverride = ref<'auto' | CodeLanguage>('auto')
const theme = ref<'midnight' | 'forest' | 'paper'>('midnight')
const showLineNumbers = ref(true)
const author = ref('author')
const detectedLanguage = computed(() => detectCodeLanguage(sourceName.value, code.value))
const language = computed<CodeLanguage>(() => languageOverride.value === 'auto' ? detectedLanguage.value : languageOverride.value)
const longestLine = computed(() => Math.max(1, ...code.value.split('\n').map((line) => [...line].length)))
const fontSize = computed(() => Math.max(14, Math.min(20, Math.floor(700 / (longestLine.value * .58)))))
const linesPerPage = computed(() => Math.max(20, Math.min(38, Math.round(38 - Math.max(0, longestLine.value - 76) / 10))))
const byline = computed(() => `BY ${author.value.trim() || 'author'}`)
const pages = computed(() => splitCodeForExport(code.value, linesPerPage.value))
const highlightedPages = computed(() => pages.value.map((page) => highlightCode(page, language.value)))
const pageLineCounts = computed(() => pages.value.map((page) => page.split('\n').length))
const languageLabel = computed(() => `${languageOverride.value === 'auto' ? 'AUTO · ' : ''}${codeLanguages.find((item) => item.id === language.value)?.label ?? language.value}`)
const selectedPageIndexes = computed(() => [...selectedPages.value].filter((index) => index < pages.value.length).sort((a, b) => a - b))
const copyLabel = computed(() => selectedPageIndexes.value.length > 1 ? `复制为 ${selectedPageIndexes.value.length} 张` : '复制图片')

watch(() => store.codeDraft, (draft) => {
  if (!draft || draft.content === code.value) return
  code.value = draft.content
  sourceName.value = draft.name
  languageOverride.value = 'auto'
})

watch(codeFiles, async (files) => {
  if (!files[0]) return
  code.value = await files[0].text()
  sourceName.value = files[0].name
  languageOverride.value = 'auto'
  activePage.value = 0
})

watch(() => pages.value.length, (length) => {
  if (activePage.value >= length) activePage.value = Math.max(0, length - 1)
  selectedPages.value = new Set([...selectedPages.value].filter((index) => index < length))
  if (!selectedPages.value.size) selectedPages.value.add(activePage.value)
})

const stem = () => sourceName.value.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]+/g, '-') || 'code'
const inputReferences = () => codeFiles.value.map((file) => ({ name: file.name, size: file.size, mime: file.type, path: (file as File & { path?: string }).path }))

async function ensureDirectory() {
  if (isDesktop() && !store.settings.outputDirectory) {
    const directory = await chooseOutputDirectory()
    if (!directory) return false
    store.updateSettings({ outputDirectory: directory })
  }
  return true
}

async function capturePage(index: number) {
  await nextTick()
  await document.fonts.ready
  const node = captureHost.value?.querySelectorAll<HTMLElement>('[data-export-frame]')[index]
  if (!node) throw new Error('实时预览尚未准备好。')
  const blob = await toBlob(node, { pixelRatio: 2, cacheBust: true })
  if (!blob) throw new Error('无法生成代码图片。')
  return blob
}

function toggleSelectedPage(index: number) {
  const next = new Set(selectedPages.value)
  if (next.has(index) && next.size > 1) next.delete(index)
  else next.add(index)
  selectedPages.value = next
  activePage.value = index
}

function selectAllPages() {
  selectedPages.value = selectedPages.value.size === pages.value.length
    ? new Set([activePage.value])
    : new Set(pages.value.map((_, index) => index))
}

function openPreviewMenu(event: MouseEvent, page = activePage.value) {
  activePage.value = page
  const card = previewStage.value?.querySelector<HTMLElement>('.codesnap-card')
  const bounds = card?.getBoundingClientRect()
  const menuWidth = 216
  const menuHeight = selectedPageIndexes.value.length > 1 ? 238 : 168
  const minX = bounds ? bounds.left + 8 : 8
  const minY = bounds ? bounds.top + 8 : 8
  const maxX = bounds ? Math.max(minX, bounds.right - menuWidth - 8) : window.innerWidth - menuWidth - 8
  const maxY = bounds ? Math.max(minY, bounds.bottom - menuHeight - 8) : window.innerHeight - menuHeight - 8
  contextMenu.value = {
    open: true,
    page,
    x: Math.max(minX, Math.min(event.clientX, maxX)),
    y: Math.max(minY, Math.min(event.clientY, maxY))
  }
}

function closePreviewMenu() { contextMenu.value.open = false }
onMounted(() => {
  window.addEventListener('click', closePreviewMenu)
  window.addEventListener('blur', closePreviewMenu)
  window.addEventListener('resize', closePreviewMenu)
})
onBeforeUnmount(() => {
  window.removeEventListener('click', closePreviewMenu)
  window.removeEventListener('blur', closePreviewMenu)
  window.removeEventListener('resize', closePreviewMenu)
})

async function combineImages(blobs: Blob[]) {
  if (blobs.length === 1) return blobs[0]
  const images = await Promise.all(blobs.map((blob) => createImageBitmap(blob)))
  const gap = 0
  const width = Math.max(...images.map((image) => image.width))
  const height = images.reduce((total, image) => total + image.height, 0) + gap * (images.length - 1)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法合并所选代码图片。')
  let y = 0
  for (const image of images) {
    context.drawImage(image, Math.round((width - image.width) / 2), y)
    y += image.height + gap
    image.close()
  }
  const result = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!result) throw new Error('无法生成多页代码长图。')
  return result
}

function addExportJob(label: string, outputs: FileReference[], detail: string) {
  const job = store.addJob('code', label, [sourceName.value], {
    toolId: 'code-image', route: '/code-image', retryable: true,
    parameters: { language: language.value, languageMode: languageOverride.value, theme: theme.value, fontSize: fontSize.value, linesPerPage: linesPerPage.value, showLineNumbers: showLineNumbers.value, author: author.value },
    inputs: inputReferences()
  })
  store.updateJob(job.id, { status: 'succeeded', progress: 100, outputNames: outputs.map((output) => output.name), outputs, detail })
}

async function openLocation(path?: string) {
  if (!path) return
  try { await revealDesktopFile(path) }
  catch (error) { ui.toast('无法打开文件位置', error instanceof Error ? error.message : '文件可能已移动。', 'error') }
}

async function copyCurrentImage(index = activePage.value) {
  copying.value = true
  try {
    await copyPngToClipboard(await capturePage(index))
    store.addActivity('output', '复制代码图片', `${sourceName.value} · 第 ${index + 1} 张`, '/code-image')
    ui.toast('图片已复制', '可以直接粘贴到微信、QQ、邮件或文档。', 'success')
  } catch (error) {
    ui.toast('复制图片失败', error instanceof Error ? error.message : '系统剪贴板不可用。', 'error')
  } finally { copying.value = false }
}

async function copySelectedImages() {
  const indexes = selectedPageIndexes.value.length ? selectedPageIndexes.value : [activePage.value]
  if (indexes.length === 1) return copyCurrentImage(indexes[0])
  copying.value = true
  try {
    const blobs = await Promise.all(indexes.map(capturePage))
    await copyPngFilesToClipboard(blobs.map((blob, index) => ({
      name: `${stem()}-${String(indexes[index] + 1).padStart(2, '0')}.png`,
      blob
    })))
    store.addActivity('output', '复制多张代码图片', `${sourceName.value} · ${indexes.map((index) => index + 1).join('、')} 页`, '/code-image')
    ui.toast(`${indexes.length} 张独立图片已复制`, '可粘贴到资源管理器，或拖放/粘贴到支持多附件的软件。', 'success')
  } catch (error) {
    ui.toast('复制多张图片失败', error instanceof Error ? error.message : 'Windows 文件剪贴板不可用。', 'error')
  } finally { copying.value = false }
}

async function copySelectedAsLongImage() {
  copying.value = true
  try {
    const indexes = selectedPageIndexes.value.length ? selectedPageIndexes.value : [activePage.value]
    await copyPngToClipboard(await combineImages(await Promise.all(indexes.map(capturePage))))
    store.addActivity('output', '复制多页代码长图', `${sourceName.value} · ${indexes.map((index) => index + 1).join('、')} 页`, '/code-image')
    ui.toast(indexes.length > 1 ? `${indexes.length} 张已合并为长图` : '图片已复制', '剪贴板中是一张 PNG 图片。', 'success')
  } catch (error) {
    ui.toast('复制长图失败', error instanceof Error ? error.message : '系统剪贴板不可用。', 'error')
  } finally { copying.value = false }
}

async function exportCurrentPage() {
  if (!await ensureDirectory()) return
  exporting.value = true
  try {
    const name = `${stem()}-${String(activePage.value + 1).padStart(2, '0')}.png`
    const output = await exportOutput(store.settings.outputDirectory, name, await capturePage(activePage.value), 'image/png')
    lastOutputs.value = [output]
    addExportJob('代码分享图导出', [output], '已导出当前 CodeSnap 图片。')
    ui.toast('代码图片已导出', output.path || name, 'success', output.path ? '打开位置' : undefined, output.path ? () => openLocation(output.path) : undefined)
  } catch (error) {
    ui.toast('导出失败', error instanceof Error ? error.message : '无法生成 PNG。', 'error')
  } finally { exporting.value = false }
}

async function exportAll() {
  if (!await ensureDirectory()) return
  exporting.value = true
  try {
    const outputs: FileReference[] = []
    for (let index = 0; index < pages.value.length; index++) {
      const name = `${stem()}-${String(index + 1).padStart(2, '0')}.png`
      outputs.push(await exportOutput(store.settings.outputDirectory, name, await capturePage(index), 'image/png'))
    }
    lastOutputs.value = outputs
    addExportJob('代码分享图批量导出', outputs, `已导出 ${outputs.length} 张高亮 PNG。`)
    const firstPath = outputs.find((output) => output.path)?.path
    ui.toast('代码图片已导出', `${outputs.length} 张高亮 PNG`, 'success', firstPath ? '打开位置' : undefined, firstPath ? () => openLocation(firstPath) : undefined)
  } catch (error) {
    ui.toast('批量导出失败', error instanceof Error ? error.message : '无法生成 PNG。', 'error')
  } finally { exporting.value = false }
}

async function exportPdf() {
  if (!await ensureDirectory()) return
  exporting.value = true
  try {
    const pdf = await PDFDocument.create()
    for (let index = 0; index < pages.value.length; index++) {
      const blob = await capturePage(index)
      const image = await pdf.embedPng(await blob.arrayBuffer())
      const page = pdf.addPage([image.width, image.height])
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
    }
    const name = `${stem()}-codesnap.pdf`
    const output = await exportOutput(store.settings.outputDirectory, name, await pdf.save(), 'application/pdf')
    lastOutputs.value = [output]
    addExportJob('代码分享图 PDF 导出', [output], '已导出高亮代码 PDF。')
    ui.toast('代码 PDF 已导出', output.path || name, 'success', output.path ? '打开位置' : undefined, output.path ? () => openLocation(output.path) : undefined)
  } catch (error) {
    ui.toast('PDF 导出失败', error instanceof Error ? error.message : '无法生成 PDF。', 'error')
  } finally { exporting.value = false }
}
</script>

<template>
  <div class="code-image page-enter">
    <section class="section-heading code-studio-heading">
      <div><p class="eyebrow">CODE SNAP STUDIO</p><h2>代码值得被清楚地<em>分享。</em></h2><p>实时语法高亮、macOS 窗口风格，复制后即可发送；导出结果始终可以定位。</p></div>
      <div class="code-export-actions">
        <button class="secondary-action" :disabled="exporting || copying" @click="exportCurrentPage"><AppIcon name="image" :size="15"/>导出 PNG</button>
        <button class="secondary-action" :disabled="exporting || copying" @click="exportPdf">导出 PDF</button>
        <button v-if="selectedPageIndexes.length > 1" class="secondary-action" :disabled="exporting || copying" @click="copySelectedAsLongImage">合并长图</button>
        <button class="primary-button code-copy-primary" :disabled="exporting || copying" @click="copySelectedImages"><AppIcon name="duplicate" :size="15"/>{{ copying ? '正在复制…' : copyLabel }}</button>
      </div>
    </section>

    <section class="codesnap-workspace">
      <div class="code-control-bar panel">
        <details class="code-control-menu code-import-menu">
          <summary><AppIcon name="file-code" :size="14"/><span>导入代码</span><small>{{ codeFiles[0]?.name || '拖入或选择文件' }}</small></summary>
          <div class="code-control-popover">
            <FileDropZone v-model="codeFiles" accept=".txt,.md,.js,.ts,.tsx,.jsx,.py,.java,.cpp,.c,.cs,.go,.rs,.vue,.html,.css,.sql,text/*" :multiple="false" title="拖入代码文件" hint="自动识别语言并实时预览"/>
          </div>
        </details>

        <span class="code-auto-badge"><AppIcon name="sparkle" :size="13"/><b>{{ languageLabel }}</b><small>{{ fontSize }}px · 自动 {{ linesPerPage }} 行/张</small></span>

        <div class="code-inline-theme" role="group" aria-label="窗口主题">
          <span>主题</span>
          <div class="segmented theme-segmented"><button :class="{ active: theme === 'midnight' }" @click="theme = 'midnight'">午夜</button><button :class="{ active: theme === 'forest' }" @click="theme = 'forest'">深林</button><button :class="{ active: theme === 'paper' }" @click="theme = 'paper'">纸页</button></div>
        </div>

        <details class="code-control-menu code-advanced-menu">
          <summary><AppIcon name="settings" :size="14"/><span>偏好设置</span><small>{{ byline }}</small></summary>
          <div class="code-control-popover code-advanced-popover">
            <header><div><p class="eyebrow">SMART SETTINGS</p><strong>自动排版偏好</strong></div><small>字号与分页由内容自动计算</small></header>
            <label>语言识别<select v-model="languageOverride" aria-label="代码语言"><option value="auto">自动识别（{{ codeLanguages.find(item => item.id === detectedLanguage)?.label }}）</option><option v-for="item in codeLanguages" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
            <div class="code-advanced-row"><label class="checkline"><input v-model="showLineNumbers" type="checkbox" /> 显示行号</label><label class="watermark-field"><span>作者署名</span><input v-model="author" placeholder="author" /></label></div>
          </div>
        </details>
      </div>

      <div class="codesnap-main">
        <section class="code-editor panel">
          <header><span class="mac-controls" aria-hidden="true"><i></i><i></i><i></i></span><input v-model="sourceName" aria-label="代码图片标题"/><small>{{ code.split('\n').length }} 行</small></header>
          <textarea v-model="code" spellcheck="false" aria-label="代码编辑器"></textarea>
        </section>

        <section class="live-code-preview panel">
          <header><div><p class="eyebrow">LIVE PREVIEW</p><strong>实时图片预览</strong></div><span>右键复制 · 2× 高清</span></header>
          <div ref="previewStage" class="codesnap-stage" title="右键可复制当前图片">
            <CodeSnapCard
              :code-html="highlightedPages[activePage]"
              :line-count="pageLineCounts[activePage]"
              :start-line="activePage * linesPerPage + 1"
              :title="sourceName"
              :language-label="languageLabel"
              :page-number="activePage + 1"
              :total-pages="pages.length"
              :font-size="fontSize"
              :show-line-numbers="showLineNumbers"
              :watermark="byline"
              :theme="theme"
              @contextmenu.prevent.stop="openPreviewMenu($event)"
            />
          </div>
          <div v-if="pages.length > 1" class="page-selection-strip">
            <span>选择图片</span>
            <button v-for="(_, index) in pages" :key="index" :class="{ selected: selectedPages.has(index), current: activePage === index }" @click="toggleSelectedPage(index)" @contextmenu.prevent.stop="openPreviewMenu($event, index)"><i>{{ selectedPages.has(index) ? '✓' : '' }}</i>第 {{ index + 1 }} 张</button>
            <button class="select-all-pages" @click="selectAllPages">{{ selectedPages.size === pages.length ? '仅保留当前' : '全选' }}</button>
          </div>
          <footer class="preview-toolbar">
            <div class="page-switcher"><button :disabled="activePage === 0" @click="activePage--">←</button><span>第 {{ activePage + 1 }} / {{ pages.length }} 张</span><button :disabled="activePage === pages.length - 1" @click="activePage++">→</button></div>
            <div><button class="quiet-button" :disabled="pages.length === 1 || exporting" @click="exportAll">导出全部 {{ pages.length }} 张</button><button v-if="selectedPageIndexes.length > 1" class="quiet-button" :disabled="copying" @click="copySelectedAsLongImage">合并长图</button><button class="primary-button" :disabled="copying" @click="copySelectedImages">{{ copying ? '正在复制…' : copyLabel }}</button></div>
          </footer>
        </section>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="contextMenu.open" class="codesnap-context-menu" role="menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" @click.stop>
        <header><span>第 {{ contextMenu.page + 1 }} 张</span><small>代码图片</small></header>
        <button role="menuitem" :disabled="copying" @click="copyCurrentImage(contextMenu.page); closePreviewMenu()"><AppIcon name="duplicate" :size="14"/>复制当前图片</button>
        <button role="menuitem" @click="toggleSelectedPage(contextMenu.page); closePreviewMenu()"><AppIcon name="plus" :size="14"/>{{ selectedPages.has(contextMenu.page) && selectedPages.size > 1 ? '从多选中移除' : '加入多选' }}</button>
        <button v-if="selectedPageIndexes.length > 1" role="menuitem" :disabled="copying" @click="copySelectedImages(); closePreviewMenu()"><AppIcon name="image" :size="14"/>复制所选 {{ selectedPageIndexes.length }} 张</button>
        <button v-if="selectedPageIndexes.length > 1" role="menuitem" :disabled="copying" @click="copySelectedAsLongImage(); closePreviewMenu()"><AppIcon name="merge" :size="14"/>合并所选为长图</button>
        <hr />
        <button role="menuitem" :disabled="exporting" @click="exportCurrentPage(); closePreviewMenu()"><AppIcon name="file-image" :size="14"/>导出当前 PNG</button>
      </div>
    </Teleport>

    <section v-if="lastOutputs.length" class="code-output-result panel">
      <header><div><p class="eyebrow">EXPORT COMPLETE</p><h3>刚刚生成的文件</h3></div><button v-if="lastOutputs[0]?.path" class="primary-button" @click="openLocation(lastOutputs[0].path)">打开输出位置</button></header>
      <div><article v-for="output in lastOutputs" :key="output.name"><AppIcon :name="output.mime === 'application/pdf' ? 'file-pdf' : 'image'" :size="16"/><span><strong>{{ output.name }}</strong><small>{{ output.path || '已通过浏览器下载' }}</small></span><button v-if="output.path" class="quiet-button" @click="openLocation(output.path)">定位文件</button></article></div>
    </section>

    <div ref="captureHost" class="codesnap-capture-host" aria-hidden="true">
      <div v-for="(page, index) in pages" :key="index" class="codesnap-export-frame" data-export-frame><CodeSnapCard :code-html="highlightedPages[index]" :line-count="pageLineCounts[index]" :start-line="index * linesPerPage + 1" :title="sourceName" :language-label="languageLabel" :page-number="index + 1" :total-pages="pages.length" :font-size="fontSize" :show-line-numbers="showLineNumbers" :watermark="byline" :theme="theme"/></div>
    </div>
  </div>
</template>
