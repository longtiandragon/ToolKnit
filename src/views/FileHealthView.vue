<script setup lang="ts">
import { computed, ref } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import ToolLayout from '@/components/ToolLayout.vue'
import FieldRow from '@/components/FieldRow.vue'
import { isDesktop } from '@/lib/native'
import { exportOutput } from '@/lib/output'
import { recycleDesktopFileHealthPaths, scanDesktopFileHealth, type FileHealthDuplicateGroup, type FileHealthFinding, type FileHealthPath, type FileHealthReport } from '@/lib/file-health-native'
import { useUiStore } from '@/stores/ui'
import { useWorkbenchStore } from '@/stores/workbench'

type Filter = 'all' | 'duplicate' | 'large-file' | 'empty-file' | 'empty-directory' | 'extension-mismatch'
type DisplayItem = FileHealthPath & { id: string; kind: Filter; detail: string; suggestedKeep?: boolean }

const desktop = isDesktop()
const ui = useUiStore()
const store = useWorkbenchStore()
const root = ref('')
const report = ref<FileHealthReport>()
const busy = ref(false)
const message = ref(desktop ? '选择一个文件夹，先扫描再决定如何处理。' : '文件夹扫描需要桌面端权限。')
const threshold = ref(512 * 1024 * 1024)
const filter = ref<Filter>('all')
const selectedPaths = ref<string[]>([])

const filters: { id: Filter; label: string; count: (value: FileHealthReport) => number }[] = [
  { id: 'all', label: '全部问题', count: value => value.emptyFiles.length + value.emptyDirectories.length + value.largeFiles.length + value.extensionMismatches.length + value.duplicateGroups.reduce((sum, group) => sum + group.files.length, 0) },
  { id: 'duplicate', label: '重复文件', count: value => value.duplicateGroups.reduce((sum, group) => sum + group.files.length, 0) },
  { id: 'large-file', label: '大文件', count: value => value.largeFiles.length },
  { id: 'empty-file', label: '空文件', count: value => value.emptyFiles.length },
  { id: 'empty-directory', label: '空文件夹', count: value => value.emptyDirectories.length },
  { id: 'extension-mismatch', label: '扩展名异常', count: value => value.extensionMismatches.length },
]

const totalProblemCount = computed(() => report.value ? filters[0].count(report.value) : 0)
const selectedCount = computed(() => selectedPaths.value.length)
const duplicateBytes = computed(() => report.value?.duplicateGroups.reduce((sum, group) => sum + group.size * Math.max(0, group.files.length - 1), 0) ?? 0)

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function findingItem(finding: FileHealthFinding): DisplayItem {
  return { ...finding, kind: finding.kind as Filter }
}

function duplicateItems(group: FileHealthDuplicateGroup): DisplayItem[] {
  return group.files.map(file => ({
    ...file,
    id: `${group.id}:${file.path}`,
    kind: 'duplicate',
    detail: `与同组另外 ${group.files.length - 1} 个文件内容完全相同 · SHA-256 ${group.hash.slice(0, 12)}…`,
    suggestedKeep: file.path === group.suggestedKeep,
  }))
}

const items = computed<DisplayItem[]>(() => {
  if (!report.value) return []
  const all = [
    ...report.value.duplicateGroups.flatMap(duplicateItems),
    ...report.value.largeFiles.map(findingItem),
    ...report.value.emptyFiles.map(findingItem),
    ...report.value.emptyDirectories.map(findingItem),
    ...report.value.extensionMismatches.map(findingItem),
  ]
  return filter.value === 'all' ? all : all.filter(item => item.kind === filter.value)
})

const selectedItems = computed(() => items.value.filter(item => selectedPaths.value.includes(item.path)))
const scanWarnings = computed(() => report.value?.warnings ?? [])

async function chooseRoot() {
  if (!desktop || busy.value) return
  const selected = await open({ title: '选择要检查的文件夹', directory: true, multiple: false })
  if (typeof selected !== 'string') return
  root.value = selected
  report.value = undefined
  selectedPaths.value = []
  message.value = `已选择“${basename(selected)}”，点击扫描后才会读取目录内容。`
}

async function scan() {
  if (!desktop || !root.value || busy.value) return
  busy.value = true
  selectedPaths.value = []
  message.value = '正在扫描目录、比较重复内容并检查文件签名…'
  try {
    report.value = await scanDesktopFileHealth(root.value, threshold.value)
    message.value = report.value.truncated ? '扫描完成，但已触及安全上限；结果可作为当前目录的抽样。' : `扫描完成：发现 ${totalProblemCount.value} 个需要复核的项目。`
  } catch (error) {
    report.value = undefined
    message.value = error instanceof Error ? error.message : '文件夹扫描失败。'
    ui.toast('文件夹扫描失败', message.value, 'error')
  } finally {
    busy.value = false
  }
}

function toggleSelected(item: DisplayItem) {
  if (item.kind === 'empty-directory' || item.suggestedKeep) return
  selectedPaths.value = selectedPaths.value.includes(item.path)
    ? selectedPaths.value.filter(path => path !== item.path)
    : [...selectedPaths.value, item.path]
}

function selectVisible() {
  const next = new Set(selectedPaths.value)
  for (const item of items.value) {
    if (item.kind !== 'empty-directory' && !item.suggestedKeep) next.add(item.path)
  }
  selectedPaths.value = [...next]
}

function clearSelection() {
  selectedPaths.value = []
}

async function recycleSelected() {
  if (!report.value || !selectedPaths.value.length || busy.value) return
  const count = selectedPaths.value.length
  if (!window.confirm(`确定把选中的 ${count} 个文件移入 Windows 回收站吗？\n不会永久删除，也不会处理空文件夹。`)) return
  busy.value = true
  message.value = `正在把 ${count} 个文件移入回收站…`
  try {
    const moved = await recycleDesktopFileHealthPaths(report.value.root, selectedPaths.value)
    selectedPaths.value = []
    message.value = `已把 ${moved} 个文件移入回收站。建议重新扫描确认结果。`
    ui.toast('已移入回收站', `${moved} 个文件可从回收站恢复。`, 'success')
  } catch (error) {
    message.value = error instanceof Error ? error.message : '移入回收站失败。'
    ui.toast('回收站操作失败', message.value, 'error')
  } finally {
    busy.value = false
  }
}

async function exportReport() {
  if (!report.value || busy.value) return
  const name = `knitspace-file-health-${new Date().toISOString().slice(0, 10)}.json`
  try {
    const output = await exportOutput(store.settings.outputDirectory, name, JSON.stringify(report.value, null, 2), 'application/json;charset=utf-8')
    ui.toast('扫描报告已导出', output.path || output.name, 'success')
  } catch (error) {
    ui.toast('导出扫描报告失败', error instanceof Error ? error.message : '无法写出 JSON 报告。', 'error')
  }
}

function directoryLabel(path: string) {
  return path || '根目录'
}
</script>

<template>
  <div class="page-enter mx-auto w-full max-w-320 px-8 py-6">
    <PageHeader
      title="文件健康扫描"
      subtitle="参考 Czkawka 的高频检查：先扫描、分组和预览，再把选中的文件移入回收站。"
      :stats="[
        { label: '扫描文件', value: report?.scannedFiles ?? 0 },
        { label: '问题项目', value: totalProblemCount, tone: totalProblemCount ? 'warn' : 'accent' },
        { label: '重复可回收', value: formatBytes(duplicateBytes) },
      ]"
    >
      <template #actions>
        <span class="row gap-1.5 h-9 px-3 rounded-sm text-[12px]" :class="desktop ? 'bg-accent-soft text-accent' : 'bg-warn-soft text-warn'">
          <AppIcon :name="desktop ? 'search' : 'warning'" :size="14" />{{ desktop ? '本机扫描' : '桌面端可用' }}
        </span>
      </template>
      <template #lead>
        <div class="row gap-2 flex-wrap">
          <button class="btn-default btn-sm" :disabled="busy || !desktop" @click="chooseRoot"><AppIcon name="folder" :size="14" />选择文件夹</button>
          <span class="text-[11px] text-fg-3 truncate max-w-96" :title="root">{{ root ? `当前：${root}` : '尚未选择目录' }}</span>
        </div>
      </template>
    </PageHeader>

    <ToolLayout aside-width="narrow">
      <section v-if="!report" class="panel min-h-96 p-8 stack items-center justify-center gap-4 text-center">
        <span class="center w-14 h-14 rounded-xl bg-accent-soft text-accent"><AppIcon name="search" :size="28" /></span>
        <div class="stack gap-1.5 max-w-xl">
          <h2 class="text-[16px] font-semibold text-fg">扫描前不修改任何文件</h2>
          <p class="text-[12px] text-fg-3 leading-relaxed">Knitspace 只读取目录元信息，并对同大小文件计算 SHA-256。符号链接会跳过，文件数量和哈希总量都有上限；直到你明确选择并确认，任何文件都不会移动。</p>
        </div>
        <button class="btn-primary" :disabled="!desktop || !root || busy" @click="scan"><AppIcon name="search" :size="15" />{{ busy ? '正在扫描…' : '开始扫描' }}</button>
        <p class="text-[11px] text-fg-3" aria-live="polite">{{ message }}</p>
      </section>

      <template v-else>
        <section class="panel p-3 stack gap-3">
          <div class="row-between gap-3">
            <div class="stack gap-0.5 min-w-0"><p class="eyebrow">扫描结果</p><p class="text-[12px] text-fg-2 truncate" :title="report.root">{{ report.root }}</p></div>
            <div class="row gap-1.5 shrink-0"><button class="btn-default btn-sm" :disabled="busy" @click="exportReport"><AppIcon name="download" :size="14" />导出报告</button><button class="btn-default btn-sm" :disabled="busy" @click="scan"><AppIcon name="refresh" :size="14" />重新扫描</button></div>
          </div>
          <div class="row gap-1.5 flex-wrap" role="tablist" aria-label="问题类型">
            <button v-for="item in filters" :key="item.id" class="h-7 px-2.5 rounded-full text-[11px] transition-colors" :class="filter === item.id ? 'bg-accent-solid text-accent-fg font-medium' : 'text-fg-2 hover:bg-surface-2'" :aria-selected="filter === item.id" role="tab" @click="filter = item.id">{{ item.label }} <span class="tabular-nums opacity-70">{{ report ? item.count(report) : 0 }}</span></button>
          </div>
        </section>

        <section v-if="items.length" class="panel overflow-hidden">
          <header class="row-between gap-3 px-3 h-11 border-b border-line">
            <div class="row gap-2"><AppIcon name="warning" :size="15" class="text-warn" /><strong class="text-[13px] font-medium text-fg">{{ filters.find(item => item.id === filter)?.label }}</strong><span class="text-[11px] text-fg-3">{{ items.length }} 项</span></div>
            <div class="row gap-2"><button class="text-[11px] text-fg-3 hover:text-accent" @click="selectVisible">全选可处理</button><button class="text-[11px] text-fg-3 hover:text-accent" @click="clearSelection">清空选择</button></div>
          </header>
          <ul class="stack gap-0.5 p-1.5 max-h-128 overflow-y-auto">
            <li v-for="item in items" :key="item.id" class="row gap-2 px-2.5 py-2 rounded-sm hover:bg-surface-2" :class="item.suggestedKeep ? 'opacity-60' : ''">
              <input v-if="item.kind !== 'empty-directory'" type="checkbox" class="accent-accent shrink-0" :checked="selectedPaths.includes(item.path)" :disabled="item.suggestedKeep" :aria-label="`选择 ${item.name}`" @change="toggleSelected(item)" />
              <span v-else class="w-3.5 shrink-0" aria-hidden="true" />
              <AppIcon :name="item.kind === 'duplicate' ? 'duplicate' : item.kind === 'large-file' ? 'file-text' : item.kind === 'empty-directory' ? 'folder' : 'warning'" :size="15" class="text-fg-3 shrink-0" />
              <span class="stack gap-0.5 min-w-0 flex-1"><strong class="text-[12px] font-medium text-fg truncate" :title="item.path">{{ item.relativePath || item.name }}</strong><small class="text-[11px] text-fg-3 truncate">{{ item.detail }}<template v-if="item.suggestedKeep"> · 建议保留</template></small></span>
              <span class="text-[11px] text-fg-3 tabular-nums shrink-0">{{ item.size ? formatBytes(item.size) : '—' }}</span>
            </li>
          </ul>
        </section>
        <section v-else class="panel p-8 stack items-center gap-2 text-center"><AppIcon name="check" :size="22" class="text-success" /><p class="text-[13px] font-medium text-fg">当前筛选没有需要处理的项目</p><p class="text-[11px] text-fg-3">可以切换问题类型，或重新扫描确认目录状态。</p></section>

        <section v-if="report.largestDirectories.length" class="panel overflow-hidden">
          <header class="row-between gap-2 px-3 h-10 border-b border-line"><p class="text-[12px] font-medium text-fg-2">占用空间最多的文件夹</p><span class="text-[11px] text-fg-3">前 20 项</span></header>
          <ul class="stack gap-0.5 p-1.5 max-h-72 overflow-y-auto">
            <li v-for="directory in report.largestDirectories" :key="directory.path" class="row gap-2 px-2 py-1.5 rounded-sm hover:bg-surface-2"><AppIcon name="folder" :size="14" class="text-fg-3 shrink-0" /><span class="min-w-0 flex-1 truncate text-[12px] text-fg-2" :title="directory.path">{{ directoryLabel(directory.relativePath) }}</span><span class="text-[11px] text-fg-3 tabular-nums">{{ formatBytes(directory.size) }} · {{ directory.fileCount }} 文件</span></li>
          </ul>
        </section>
      </template>

      <template #aside>
        <section class="panel p-4 stack gap-4">
          <p class="eyebrow">扫描设置</p>
          <FieldRow label="大文件阈值" hint="只影响大文件分类，不会限制扫描">
            <select v-model.number="threshold" class="field w-full" :disabled="busy">
              <option :value="100 * 1024 * 1024">100 MB</option>
              <option :value="512 * 1024 * 1024">512 MB</option>
              <option :value="1024 * 1024 * 1024">1 GB</option>
              <option :value="2 * 1024 * 1024 * 1024">2 GB</option>
            </select>
          </FieldRow>
          <button class="btn-primary btn-lg w-full" :disabled="!desktop || !root || busy" @click="scan"><AppIcon name="search" :size="15" />{{ busy ? '正在扫描…' : report ? '重新扫描' : '开始扫描' }}</button>
          <p class="text-[11px] text-fg-3 leading-relaxed" aria-live="polite">{{ message }}</p>
        </section>
        <section class="panel p-4 stack gap-3">
          <div class="row-between gap-2"><p class="eyebrow">安全处理</p><span class="text-[11px] text-fg-3">已选 {{ selectedCount }}</span></div>
          <p class="text-[11px] text-fg-3 leading-relaxed">默认不删除文件。重复组的第一项仅作“建议保留”提示；你可以复核路径后，把其他选中项移入 Windows 回收站。</p>
          <button class="btn-danger btn-lg w-full" :disabled="!selectedCount || busy" @click="recycleSelected"><AppIcon name="trash" :size="15" />移入回收站</button>
          <p v-if="selectedItems.length" class="text-[11px] text-warn">回收站可恢复；空文件夹不会被处理。</p>
        </section>
        <section v-if="scanWarnings.length" class="panel p-4 stack gap-2"><p class="eyebrow text-warn">扫描提示</p><p v-for="warning in scanWarnings.slice(0, 5)" :key="warning" class="text-[11px] text-fg-3 leading-relaxed">{{ warning }}</p><p v-if="scanWarnings.length > 5" class="text-[11px] text-fg-3">另有 {{ scanWarnings.length - 5 }} 条提示已收起。</p></section>
      </template>
    </ToolLayout>
  </div>
</template>
