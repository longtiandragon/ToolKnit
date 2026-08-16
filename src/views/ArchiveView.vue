<script setup lang="ts">
import { computed, ref } from 'vue'
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { isDesktop } from '@/lib/native'
import { createDesktopZipArchive, extractDesktopZipArchive, listDesktopZipArchive, type DesktopArchiveListing, type DesktopArchiveOperationSummary } from '@/lib/archive-native'
import { useUiStore } from '@/stores/ui'
import AppIcon from '@/components/AppIcon.vue'
import FileDropZone from '@/components/FileDropZone.vue'
import PageHeader from '@/components/PageHeader.vue'
import ToolLayout from '@/components/ToolLayout.vue'

type ArchiveMode = 'create' | 'inspect' | 'extract'
const desktop = isDesktop()
const ui = useUiStore()
const mode = ref<ArchiveMode>('create')
const browserFiles = ref<File[]>([])
const inputPaths = ref<string[]>([])
const archivePath = ref('')
const extractDirectory = ref('')
const listing = ref<DesktopArchiveListing>()
const summary = ref<DesktopArchiveOperationSummary>()
const busy = ref(false)
const message = ref(desktop ? '选择文件或文件夹后，创建一个新的 ZIP；原件不会被修改。' : 'ZIP 工具需要桌面端文件路径权限，浏览器版暂不读取本机路径。')

const tabs: { id: ArchiveMode; label: string; icon: string; description: string }[] = [
  { id: 'create', label: '创建 ZIP', icon: 'archive', description: '把文件和文件夹打包成一个新归档' },
  { id: 'inspect', label: '查看内容', icon: 'search', description: '不解压，先查看条目与展开大小' },
  { id: 'extract', label: '安全解压', icon: 'folder-open', description: '拒绝路径穿越，也不覆盖已有文件' },
]

const entryPreview = computed(() => listing.value?.entries.slice(0, 200) ?? [])
const selectedCount = computed(() => inputPaths.value.length || browserFiles.value.length)

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function addInputPaths(paths: string[]) {
  inputPaths.value = [...new Set([...inputPaths.value, ...paths])]
  summary.value = undefined
  message.value = `已选择 ${inputPaths.value.length} 个输入路径。归档只会读取文件内容。`
}

function removeInputPath(path: string) {
  inputPaths.value = inputPaths.value.filter((item) => item !== path)
}

async function chooseInputFiles() {
  if (!desktop || busy.value) return
  const selected = await open({ title: '选择要打包的文件', multiple: true, directory: false })
  const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
  if (paths.length) addInputPaths(paths)
}

async function chooseInputFolder() {
  if (!desktop || busy.value) return
  const selected = await open({ title: '选择要打包的文件夹', multiple: false, directory: true })
  if (typeof selected === 'string') addInputPaths([selected])
}

async function chooseArchive() {
  if (!desktop || busy.value) return
  const selected = await open({ title: '选择 ZIP 归档', multiple: false, filters: [{ name: 'ZIP 归档', extensions: ['zip'] }] })
  if (typeof selected !== 'string') return
  archivePath.value = selected
  listing.value = undefined
  summary.value = undefined
  message.value = `已选择归档“${basename(selected)}”，可以先查看内容或安全解压。`
}

async function chooseExtractDirectory() {
  if (!desktop || busy.value) return
  const selected = await open({ title: '选择解压目标文件夹', multiple: false, directory: true })
  if (typeof selected === 'string') extractDirectory.value = selected
}

function selectMode(next: ArchiveMode) {
  if (busy.value) return
  mode.value = next
  listing.value = undefined
  summary.value = undefined
  message.value = tabs.find((tab) => tab.id === next)?.description ?? message.value
}

async function createArchive() {
  if (!desktop || !inputPaths.value.length || busy.value) return
  const output = await saveDialog({ title: '保存 ZIP 归档', defaultPath: 'knitspace-archive.zip', filters: [{ name: 'ZIP 归档', extensions: ['zip'] }] })
  if (!output) return
  busy.value = true
  message.value = '正在读取输入并写入 ZIP；大文件会流式处理。'
  try {
    summary.value = await createDesktopZipArchive(inputPaths.value, output)
    message.value = `已创建 ${summary.value.archiveName}，原件保持不变。`
    ui.toast('ZIP 归档已创建', summary.value.archiveName, 'success')
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'ZIP 创建失败。'
    ui.toast('ZIP 创建失败', message.value, 'error')
  } finally {
    busy.value = false
  }
}

async function inspectArchive() {
  if (!desktop || !archivePath.value || busy.value) return
  busy.value = true
  message.value = '正在读取 ZIP 目录，不会解压文件。'
  try {
    listing.value = await listDesktopZipArchive(archivePath.value)
    message.value = `已检查 ${listing.value.archiveName}，归档内容没有写入磁盘。`
  } catch (error) {
    listing.value = undefined
    message.value = error instanceof Error ? error.message : 'ZIP 检查失败。'
    ui.toast('ZIP 检查失败', message.value, 'error')
  } finally {
    busy.value = false
  }
}

async function extractArchive() {
  if (!desktop || !archivePath.value || !extractDirectory.value || busy.value) return
  busy.value = true
  message.value = '正在安全解压；路径穿越和覆盖已有文件会被拒绝。'
  try {
    summary.value = await extractDesktopZipArchive(archivePath.value, extractDirectory.value)
    message.value = `已解压 ${summary.value.fileCount} 个文件，原归档保持不变。`
    ui.toast('ZIP 解压已完成', summary.value.outputPath, 'success')
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'ZIP 解压失败。'
    ui.toast('ZIP 解压失败', message.value, 'error')
  } finally {
    busy.value = false
  }
}

const canRun = computed(() => desktop && !busy.value && (mode.value === 'create' ? inputPaths.value.length > 0 : mode.value === 'inspect' ? Boolean(archivePath.value) : Boolean(archivePath.value && extractDirectory.value)))
</script>

<template>
  <div class="page-enter mx-auto w-full max-w-320 px-8 py-6">
    <PageHeader
      title="压缩与归档"
      subtitle="先预览、再执行；所有归档操作都在本机完成，不覆盖原始文件。"
      :stats="[
        { label: '当前模式', value: tabs.find((tab) => tab.id === mode)?.label ?? 'ZIP', tone: 'accent' },
        { label: '已选输入', value: selectedCount },
        { label: '归档条目', value: listing?.entries.length ?? 0 },
      ]"
    >
      <template #actions>
        <span class="row gap-1.5 h-9 px-3 rounded-sm text-[12px]" :class="desktop ? 'bg-accent-soft text-accent' : 'bg-warn-soft text-warn'">
          <AppIcon :name="desktop ? 'archive' : 'warning'" :size="14" />{{ desktop ? '桌面本地引擎' : '桌面端可用' }}
        </span>
      </template>
      <template #lead>
        <div class="row gap-1.5 flex-wrap" role="tablist" aria-label="归档操作">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="row gap-1.5 h-8 px-3 rounded-full text-[12px] transition-colors"
            :class="mode === tab.id ? 'bg-accent-solid text-accent-fg font-medium' : 'text-fg-2 hover:bg-surface-2'"
            :aria-selected="mode === tab.id"
            role="tab"
            :disabled="busy"
            @click="selectMode(tab.id)"
          >
            <AppIcon :name="tab.icon" :size="14" />{{ tab.label }}
          </button>
        </div>
      </template>
    </PageHeader>

    <ToolLayout aside-width="narrow">
      <section v-if="mode === 'create'" class="stack gap-4">
        <FileDropZone
          v-model="browserFiles"
          :desktop-path-only="desktop"
          :max-files="1000"
          title="拖入要归档的文件"
          :hint="desktop ? '支持文件路径；也可单独选择文件夹，原件保持只读' : '浏览器版暂不生成 ZIP，请使用桌面端'
          "
          :disabled="busy || !desktop"
          @desktop-paths="addInputPaths"
          @request-desktop-choose="chooseInputFiles"
          @error="ui.toast($event, '', 'error')"
        />
        <div class="row gap-2">
          <button class="btn-default btn-sm" :disabled="busy || !desktop" @click="chooseInputFiles"><AppIcon name="file-text" :size="14" />选择文件</button>
          <button class="btn-default btn-sm" :disabled="busy || !desktop" @click="chooseInputFolder"><AppIcon name="folder" :size="14" />选择文件夹</button>
        </div>
        <section v-if="inputPaths.length" class="panel overflow-hidden">
          <header class="row-between gap-2 px-3 h-10 border-b border-line"><p class="text-[12px] font-medium text-fg-2">待归档路径</p><span class="text-[11px] text-fg-3">{{ inputPaths.length }} 项</span></header>
          <ul class="stack gap-0.5 p-1.5 max-h-72 overflow-y-auto">
            <li v-for="path in inputPaths" :key="path" class="group row gap-2 px-2 py-1.5 rounded-sm hover:bg-surface-2">
              <AppIcon :name="path.endsWith('.zip') ? 'archive' : 'folder'" :size="15" class="text-fg-3 shrink-0" />
              <span class="min-w-0 flex-1 truncate text-[12px] text-fg-2" :title="path">{{ path }}</span>
              <button class="text-[11px] text-fg-3 opacity-0 group-hover:opacity-100 hover:text-danger" @click="removeInputPath(path)">移除</button>
            </li>
          </ul>
        </section>
      </section>

      <section v-else class="stack gap-4">
        <section class="panel p-4 stack gap-3">
          <div class="row-between gap-2"><p class="eyebrow">ZIP 归档</p><button class="btn-default btn-sm" :disabled="busy || !desktop" @click="chooseArchive"><AppIcon name="folder-open" :size="14" />选择归档</button></div>
          <p class="field min-h-9 row items-center text-[12px] text-fg-2 truncate" :title="archivePath">{{ archivePath || '尚未选择 ZIP 文件' }}</p>
          <p class="text-[11px] text-fg-3">查看内容只读取目录；解压前会拒绝绝对路径、`..` 路径和已有目标文件。</p>
        </section>

        <section v-if="mode === 'extract'" class="panel p-4 stack gap-3">
          <div class="row-between gap-2"><p class="eyebrow">解压到</p><button class="btn-default btn-sm" :disabled="busy || !desktop" @click="chooseExtractDirectory"><AppIcon name="folder" :size="14" />选择文件夹</button></div>
          <p class="field min-h-9 row items-center text-[12px] text-fg-2 truncate" :title="extractDirectory">{{ extractDirectory || '尚未选择目标文件夹' }}</p>
        </section>

        <section v-if="listing" class="panel overflow-hidden">
          <header class="row-between gap-3 px-3 h-11 border-b border-line"><div class="row gap-2 min-w-0"><AppIcon name="archive" :size="16" class="text-accent" /><strong class="text-[13px] font-medium truncate">{{ listing.archiveName }}</strong></div><span class="text-[11px] text-fg-3 tabular-nums">{{ formatBytes(listing.uncompressedSize) }} 展开</span></header>
          <ul class="stack gap-0.5 p-1.5 max-h-96 overflow-y-auto">
            <li v-for="entry in entryPreview" :key="entry.name" class="row gap-2 px-2 py-1 rounded-sm hover:bg-surface-2 text-[12px]">
              <AppIcon :name="entry.isDirectory ? 'folder' : 'file-text'" :size="14" class="text-fg-3 shrink-0" />
              <span class="min-w-0 flex-1 truncate font-mono text-fg-2" :title="entry.name">{{ entry.name }}</span>
              <span class="text-[11px] text-fg-3 tabular-nums shrink-0">{{ formatBytes(entry.uncompressedSize) }}</span>
            </li>
          </ul>
          <p v-if="listing.entries.length > entryPreview.length" class="px-3 py-2 border-t border-line text-[11px] text-fg-3">另外 {{ listing.entries.length - entryPreview.length }} 个条目未在此处展开。</p>
        </section>
      </section>

      <section v-if="summary" class="panel p-4 stack gap-2" aria-live="polite">
        <p class="row gap-1.5 text-[12px] font-medium text-success"><AppIcon name="check" :size="14" />操作完成</p>
        <p class="text-[12px] text-fg-2">{{ summary.fileCount }} 个文件 · {{ formatBytes(summary.uncompressedSize) }} 展开大小</p>
        <p class="text-[11px] text-fg-3 truncate" :title="summary.outputPath">{{ summary.outputPath }}</p>
      </section>

      <template #aside>
        <section class="panel p-4 stack gap-3">
          <p class="eyebrow">执行</p>
          <button class="btn-primary btn-lg w-full" :disabled="!canRun" @click="mode === 'create' ? createArchive() : mode === 'inspect' ? inspectArchive() : extractArchive()">
            {{ busy ? '正在处理…' : mode === 'create' ? '创建 ZIP' : mode === 'inspect' ? '查看归档内容' : '安全解压' }}
          </button>
          <p class="text-[12px] text-fg-3 text-center leading-snug" aria-live="polite">{{ message }}</p>
        </section>
        <section class="panel p-4 stack gap-2">
          <p class="eyebrow">安全边界</p>
          <p class="text-[11px] text-fg-3 leading-relaxed">单个归档最多 10,000 个条目，展开大小最多 2 GB。解压不覆盖已有文件，归档中的绝对路径和路径穿越会直接拒绝。</p>
        </section>
      </template>
    </ToolLayout>
  </div>
</template>
