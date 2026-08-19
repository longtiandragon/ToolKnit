<script setup lang="ts">
import { computed, ref } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import ToolLayout from '@/components/ToolLayout.vue'
import FieldRow from '@/components/FieldRow.vue'
import { isDesktop } from '@/lib/native'
import { exportOutput } from '@/lib/output'
import { buildDirectorySyncPreview, type DirectorySyncDirection, type DirectorySyncPlan, type DirectorySyncPlanAction } from '@/lib/directory-sync-plan'
import { compareDesktopDirectories, createDesktopFileManifest, recycleDesktopFileHealthPaths, scanDesktopFileHealth, verifyDesktopFileManifest, type DirectoryCompareReport, type DirectoryCompareStatus, type FileHealthDuplicateGroup, type FileHealthFinding, type FileHealthPath, type FileHealthReport, type FileHealthSimilarImageGroup, type FileManifestVerificationReport, type FileManifestVerificationStatus } from '@/lib/file-health-native'
import { useUiStore } from '@/stores/ui'
import { useWorkbenchStore } from '@/stores/workbench'

type Filter = 'all' | 'duplicate' | 'similar-image' | 'large-file' | 'empty-file' | 'empty-directory' | 'extension-mismatch'
type DisplayItem = FileHealthPath & { id: string; kind: Filter; detail: string; suggestedKeep?: boolean }
type ViewMode = 'health' | 'compare' | 'sync' | 'verify'
type CompareFilter = 'all' | DirectoryCompareStatus
type SyncFilter = 'all' | DirectorySyncPlanAction
type VerificationFilter = 'all' | FileManifestVerificationStatus

const desktop = isDesktop()
const ui = useUiStore()
const store = useWorkbenchStore()
const viewMode = ref<ViewMode>('health')
const root = ref('')
const report = ref<FileHealthReport>()
const compareRoot = ref('')
const compareReport = ref<DirectoryCompareReport>()
const manifestPath = ref('')
const verificationReport = ref<FileManifestVerificationReport>()
const busy = ref(false)
const message = ref(desktop ? '选择一个文件夹，先扫描再决定如何处理。' : '文件夹扫描需要桌面端权限。')
const threshold = ref(512 * 1024 * 1024)
const filter = ref<Filter>('all')
const compareFilter = ref<CompareFilter>('all')
const syncDirection = ref<DirectorySyncDirection>('left-to-right')
const syncFilter = ref<SyncFilter>('all')
const verificationFilter = ref<VerificationFilter>('all')
const selectedPaths = ref<string[]>([])

const filters: { id: Filter; label: string; count: (value: FileHealthReport) => number }[] = [
  { id: 'all', label: '全部问题', count: value => value.emptyFiles.length + value.emptyDirectories.length + value.largeFiles.length + value.extensionMismatches.length + value.duplicateGroups.reduce((sum, group) => sum + group.files.length, 0) + value.similarImageGroups.reduce((sum, group) => sum + group.files.length, 0) },
  { id: 'duplicate', label: '重复文件', count: value => value.duplicateGroups.reduce((sum, group) => sum + group.files.length, 0) },
  { id: 'similar-image', label: '相似图片', count: value => value.similarImageGroups.reduce((sum, group) => sum + group.files.length, 0) },
  { id: 'large-file', label: '大文件', count: value => value.largeFiles.length },
  { id: 'empty-file', label: '空文件', count: value => value.emptyFiles.length },
  { id: 'empty-directory', label: '空文件夹', count: value => value.emptyDirectories.length },
  { id: 'extension-mismatch', label: '扩展名异常', count: value => value.extensionMismatches.length },
]

const totalProblemCount = computed(() => report.value ? filters[0].count(report.value) : 0)
const selectedCount = computed(() => selectedPaths.value.length)
const duplicateBytes = computed(() => report.value?.duplicateGroups.reduce((sum, group) => sum + group.size * Math.max(0, group.files.length - 1), 0) ?? 0)
const compareFilters: { id: CompareFilter; label: string; count: (value: DirectoryCompareReport) => number }[] = [
  { id: 'all', label: '全部', count: value => value.sameCount + value.addedCount + value.removedCount + value.changedCount + value.unverifiedCount },
  { id: 'changed', label: '已修改', count: value => value.changedCount },
  { id: 'added', label: '右侧新增', count: value => value.addedCount },
  { id: 'removed', label: '右侧缺少', count: value => value.removedCount },
  { id: 'same', label: '相同', count: value => value.sameCount },
  { id: 'unverified', label: '未校验', count: value => value.unverifiedCount },
]
const compareItems = computed(() => {
  if (!compareReport.value) return []
  return compareFilter.value === 'all'
    ? compareReport.value.items
    : compareReport.value.items.filter(item => item.status === compareFilter.value)
})
const compareDifferenceCount = computed(() => (compareReport.value?.addedCount ?? 0) + (compareReport.value?.removedCount ?? 0) + (compareReport.value?.changedCount ?? 0) + (compareReport.value?.unverifiedCount ?? 0))
const compareWarnings = computed(() => compareReport.value?.warnings ?? [])
const syncPlan = computed(() => compareReport.value ? buildDirectorySyncPreview(compareReport.value, syncDirection.value) : undefined)
const syncActionFilters: { id: SyncFilter; label: string; count: (value: DirectorySyncPlan) => number }[] = [
  { id: 'all', label: '全部', count: value => value.items.length },
  { id: 'copy-missing', label: '待补齐', count: value => value.copyCount },
  { id: 'conflict', label: '内容冲突', count: value => value.conflictCount },
  { id: 'review', label: '人工复核', count: value => value.reviewCount },
  { id: 'keep-target', label: '目标保留', count: value => value.keepTargetCount },
  { id: 'same', label: '已一致', count: value => value.sameCount },
]
const syncItems = computed(() => {
  if (!syncPlan.value) return []
  return syncFilter.value === 'all'
    ? syncPlan.value.items
    : syncPlan.value.items.filter(item => item.action === syncFilter.value)
})
const syncNeedsReviewCount = computed(() => (syncPlan.value?.conflictCount ?? 0) + (syncPlan.value?.reviewCount ?? 0))
const verificationFilters: { id: VerificationFilter; label: string; count: (value: FileManifestVerificationReport) => number }[] = [
  { id: 'all', label: '全部', count: value => value.items.length },
  { id: 'match', label: '一致', count: value => value.matchCount },
  { id: 'missing', label: '缺失', count: value => value.missingCount },
  { id: 'size-mismatch', label: '大小变化', count: value => value.sizeMismatchCount },
  { id: 'hash-mismatch', label: '哈希变化', count: value => value.hashMismatchCount },
  { id: 'unverified', label: '未验证', count: value => value.unverifiedCount },
  { id: 'unreadable', label: '无法读取', count: value => value.unreadableCount },
  { id: 'extra', label: '额外文件', count: value => value.extraCount },
]
const verificationItems = computed(() => {
  if (!verificationReport.value) return []
  return verificationFilter.value === 'all'
    ? verificationReport.value.items
    : verificationReport.value.items.filter(item => item.status === verificationFilter.value)
})
const verificationIssueCount = computed(() => (verificationReport.value?.missingCount ?? 0) + (verificationReport.value?.sizeMismatchCount ?? 0) + (verificationReport.value?.hashMismatchCount ?? 0) + (verificationReport.value?.unverifiedCount ?? 0) + (verificationReport.value?.unreadableCount ?? 0) + (verificationReport.value?.extraCount ?? 0))
const verificationWarnings = computed(() => verificationReport.value?.warnings ?? [])

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

function similarImageItems(group: FileHealthSimilarImageGroup): DisplayItem[] {
  return group.files.map(file => ({
    ...file,
    id: `${group.id}:${file.path}`,
    kind: 'similar-image',
    detail: `与同组另外 ${group.files.length - 1} 张图片相似 · 感知差异 ${file.difference}${file.width && file.height ? ` · ${file.width} × ${file.height}` : ''}`,
    suggestedKeep: file.path === group.suggestedKeep,
  }))
}

const items = computed<DisplayItem[]>(() => {
  if (!report.value) return []
  const all = [
    ...report.value.duplicateGroups.flatMap(duplicateItems),
    ...report.value.similarImageGroups.flatMap(similarImageItems),
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
  compareReport.value = undefined
  verificationReport.value = undefined
  selectedPaths.value = []
  message.value = `已选择“${basename(selected)}”，点击扫描后才会读取目录内容。`
}

async function chooseCompareRoot(side: 'left' | 'right') {
  if (!desktop || busy.value) return
  const selected = await open({ title: side === 'left' ? '选择左侧文件夹' : '选择右侧文件夹', directory: true, multiple: false })
  if (typeof selected !== 'string') return
  if (side === 'left') {
    root.value = selected
    compareReport.value = undefined
    verificationReport.value = undefined
  } else {
    compareRoot.value = selected
    compareReport.value = undefined
  }
  message.value = `已选择“${basename(selected)}”，点击对比后才会读取目录内容。`
}

async function chooseVerificationRoot() {
  if (!desktop || busy.value) return
  const selected = await open({ title: '选择要验证的文件夹', directory: true, multiple: false })
  if (typeof selected !== 'string') return
  root.value = selected
  verificationReport.value = undefined
  message.value = `已选择“${basename(selected)}”，再选择 JSON 校验清单后才会读取文件。`
}

async function chooseManifest() {
  if (!desktop || busy.value) return
  const selected = await open({ title: '选择 Knitspace 校验清单', multiple: false, filters: [{ name: 'JSON 校验清单', extensions: ['json'] }] })
  if (typeof selected !== 'string') return
  manifestPath.value = selected
  verificationReport.value = undefined
  message.value = `已选择“${basename(selected)}”，点击验证后才会读取清单和目录。`
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

async function compare() {
  if (!desktop || !root.value || !compareRoot.value || busy.value) return
  busy.value = true
  message.value = '正在读取两侧目录并校验相同大小文件…'
  try {
    compareReport.value = await compareDesktopDirectories(root.value, compareRoot.value)
    message.value = compareReport.value.truncated
      ? '对比完成，但已触及安全上限；未校验项目请人工复核。'
      : `对比完成：发现 ${compareDifferenceCount.value} 个差异项目。`
  } catch (error) {
    compareReport.value = undefined
    message.value = error instanceof Error ? error.message : '目录对比失败。'
    ui.toast('目录对比失败', message.value, 'error')
  } finally {
    busy.value = false
  }
}

async function createSyncPreview() {
  if (!desktop || !root.value || !compareRoot.value || busy.value) return
  busy.value = true
  message.value = '正在读取两侧目录，生成不写入文件的同步预览…'
  try {
    compareReport.value = await compareDesktopDirectories(root.value, compareRoot.value)
    const plan = buildDirectorySyncPreview(compareReport.value, syncDirection.value)
    message.value = plan.partial
      ? '同步预览已生成，但原始对比触及安全上限；请把它作为局部计划复核。'
      : `同步预览已生成：${plan.copyCount} 个目标缺少文件可供后续补齐，${plan.conflictCount + plan.reviewCount} 项需要人工复核。`
  } catch (error) {
    compareReport.value = undefined
    message.value = error instanceof Error ? error.message : '无法生成同步预览。'
    ui.toast('同步预览失败', message.value, 'error')
  } finally {
    busy.value = false
  }
}

async function verifyManifest() {
  if (!desktop || !root.value || !manifestPath.value || busy.value) return
  busy.value = true
  message.value = '正在只读检查校验清单、文件大小与 SHA-256…'
  try {
    verificationReport.value = await verifyDesktopFileManifest(root.value, manifestPath.value)
    message.value = verificationReport.value.truncated
      ? '验证完成，但清单或扫描触及安全上限；未验证项目请人工复核。'
      : verificationIssueCount.value
        ? `验证完成：发现 ${verificationIssueCount.value} 个需要复核的项目。`
        : `验证完成：${verificationReport.value.matchCount} 个带 SHA-256 的文件均一致。`
  } catch (error) {
    verificationReport.value = undefined
    message.value = error instanceof Error ? error.message : '校验清单验证失败。'
    ui.toast('校验清单验证失败', message.value, 'error')
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

async function exportManifest() {
  if (!root.value || busy.value) return
  busy.value = true
  message.value = '正在生成文件清单并计算 SHA-256…'
  try {
    const manifest = await createDesktopFileManifest(root.value, true)
    const name = `knitspace-file-manifest-${new Date().toISOString().slice(0, 10)}.json`
    const output = await exportOutput(store.settings.outputDirectory, name, JSON.stringify(manifest, null, 2), 'application/json;charset=utf-8')
    message.value = manifest.truncated ? '校验清单已导出，但部分文件因安全上限未计算哈希。' : `校验清单已导出：${manifest.scannedFiles} 个文件。`
    ui.toast('校验清单已导出', output.path || output.name, manifest.truncated ? 'warning' : 'success')
  } catch (error) {
    message.value = error instanceof Error ? error.message : '无法生成文件清单。'
    ui.toast('生成校验清单失败', message.value, 'error')
  } finally {
    busy.value = false
  }
}

async function exportCompareReport() {
  if (!compareReport.value || busy.value) return
  const name = `knitspace-directory-compare-${new Date().toISOString().slice(0, 10)}.json`
  try {
    const output = await exportOutput(store.settings.outputDirectory, name, JSON.stringify(compareReport.value, null, 2), 'application/json;charset=utf-8')
    ui.toast('目录对比报告已导出', output.path || output.name, 'success')
  } catch (error) {
    ui.toast('导出对比报告失败', error instanceof Error ? error.message : '无法写出 JSON 报告。', 'error')
  }
}

async function exportSyncPreview() {
  const plan = syncPlan.value
  if (!plan || busy.value) return
  const name = `knitspace-directory-sync-preview-${new Date().toISOString().slice(0, 10)}.json`
  try {
    const output = await exportOutput(store.settings.outputDirectory, name, JSON.stringify(plan, null, 2), 'application/json;charset=utf-8')
    ui.toast('同步预览已导出', output.path || output.name, 'success')
  } catch (error) {
    ui.toast('导出同步预览失败', error instanceof Error ? error.message : '无法写出 JSON 预览。', 'error')
  }
}

async function exportVerificationReport() {
  if (!verificationReport.value || busy.value) return
  const name = `knitspace-manifest-verification-${new Date().toISOString().slice(0, 10)}.json`
  try {
    const output = await exportOutput(store.settings.outputDirectory, name, JSON.stringify(verificationReport.value, null, 2), 'application/json;charset=utf-8')
    ui.toast('验证报告已导出', output.path || output.name, 'success')
  } catch (error) {
    ui.toast('导出验证报告失败', error instanceof Error ? error.message : '无法写出 JSON 报告。', 'error')
  }
}

function directoryLabel(path: string) {
  return path || '根目录'
}

function syncActionLabel(action: DirectorySyncPlanAction) {
  return ({
    'copy-missing': '待补齐',
    'keep-target': '目标保留',
    conflict: '内容冲突',
    review: '人工复核',
    same: '已一致',
  } as const)[action]
}

function syncActionIcon(action: DirectorySyncPlanAction) {
  return action === 'copy-missing' ? 'arrow-right' : action === 'conflict' ? 'refresh' : action === 'review' ? 'warning' : 'check'
}

function syncActionTone(action: DirectorySyncPlanAction) {
  return action === 'copy-missing' ? 'text-accent' : action === 'conflict' || action === 'review' ? 'text-warn' : 'text-success'
}

function verificationStatusLabel(status: FileManifestVerificationStatus) {
  return ({
    match: '一致',
    missing: '缺失',
    'size-mismatch': '大小变化',
    'hash-mismatch': '哈希变化',
    unverified: '未验证',
    unreadable: '无法读取',
    extra: '额外文件',
  } as const)[status]
}

function verificationStatusIcon(status: FileManifestVerificationStatus) {
  return status === 'match' ? 'check' : status === 'missing' || status === 'extra' ? 'file-text' : status === 'size-mismatch' || status === 'hash-mismatch' ? 'refresh' : 'warning'
}

function verificationStatusTone(status: FileManifestVerificationStatus) {
  return status === 'match' ? 'text-success' : status === 'unverified' || status === 'unreadable' ? 'text-warn' : 'text-accent'
}
</script>

<template>
  <div class="page-enter page-shell px-8 py-6">
    <PageHeader
      :title="viewMode === 'health' ? '文件健康扫描' : viewMode === 'compare' ? '目录对比' : viewMode === 'sync' ? '同步预览' : '清单验证'"
      :subtitle="viewMode === 'health' ? '参考 Czkawka 的高频检查：先扫描、分组和预览，再把选中的文件移入回收站；安装 Czkawka CLI 后还会显示相似图片。' : viewMode === 'compare' ? '只读比较两个文件夹的文件内容，不同步、不覆盖，也不会修改原文件。' : viewMode === 'sync' ? '根据目录对比生成单向补齐计划：只列出目标缺少的文件，不复制、不覆盖、不删除。' : '读取 Knitspace 导出的 JSON 校验清单，检查文件缺失、大小、SHA-256 与额外文件；不会修改任何原文件。'"
      :stats="viewMode === 'health' ? [
        { label: '扫描文件', value: report?.scannedFiles ?? 0 },
        { label: '问题项目', value: totalProblemCount, tone: totalProblemCount ? 'warn' : 'accent' },
        { label: '重复可回收', value: formatBytes(duplicateBytes) },
      ] : viewMode === 'compare' ? [
        { label: '对比文件', value: compareReport ? compareReport.items.length : 0 },
        { label: '差异项目', value: compareDifferenceCount, tone: compareDifferenceCount ? 'warn' : 'accent' },
        { label: '相同文件', value: compareReport?.sameCount ?? 0 },
      ] : viewMode === 'sync' ? [
        { label: '候选补齐', value: syncPlan?.copyCount ?? 0, tone: syncPlan?.copyCount ? 'accent' : undefined },
        { label: '预计新增', value: formatBytes(syncPlan?.copyBytes ?? 0) },
        { label: '需复核', value: syncNeedsReviewCount, tone: syncNeedsReviewCount ? 'warn' : 'accent' },
      ] : [
        { label: '已校验', value: verificationReport?.matchCount ?? 0, tone: verificationReport?.matchCount ? 'accent' : undefined },
        { label: '需复核', value: verificationIssueCount, tone: verificationIssueCount ? 'warn' : 'accent' },
        { label: '哈希内容', value: formatBytes(verificationReport?.hashedBytes ?? 0) },
      ]"
    >
      <template #actions>
        <span class="row gap-1.5 h-9 px-3 rounded-sm text-[12px]" :class="desktop ? 'bg-accent-soft text-accent' : 'bg-warn-soft text-warn'">
          <AppIcon :name="desktop ? 'search' : 'warning'" :size="14" />{{ desktop ? '本机扫描' : '桌面端可用' }}
        </span>
      </template>
      <template #lead>
        <div class="row gap-2 flex-wrap">
          <div class="row gap-1 p-0.5 rounded-sm bg-surface-2" role="tablist" aria-label="文件工具模式">
            <button class="h-7 px-2.5 rounded-sm text-[11px]" :class="viewMode === 'health' ? 'bg-surface text-fg shadow-sm' : 'text-fg-3 hover:text-fg-2'" role="tab" :aria-selected="viewMode === 'health'" @click="viewMode = 'health'">健康扫描</button>
            <button class="h-7 px-2.5 rounded-sm text-[11px]" :class="viewMode === 'compare' ? 'bg-surface text-fg shadow-sm' : 'text-fg-3 hover:text-fg-2'" role="tab" :aria-selected="viewMode === 'compare'" @click="viewMode = 'compare'">目录对比</button>
            <button class="h-7 px-2.5 rounded-sm text-[11px]" :class="viewMode === 'sync' ? 'bg-surface text-fg shadow-sm' : 'text-fg-3 hover:text-fg-2'" role="tab" :aria-selected="viewMode === 'sync'" @click="viewMode = 'sync'">同步预览</button>
            <button class="h-7 px-2.5 rounded-sm text-[11px]" :class="viewMode === 'verify' ? 'bg-surface text-fg shadow-sm' : 'text-fg-3 hover:text-fg-2'" role="tab" :aria-selected="viewMode === 'verify'" @click="viewMode = 'verify'">清单验证</button>
          </div>
          <template v-if="viewMode === 'health'">
            <button class="btn-default btn-sm" :disabled="busy || !desktop" @click="chooseRoot"><AppIcon name="folder" :size="14" />选择文件夹</button>
            <span class="text-[11px] text-fg-3 truncate max-w-96" :title="root">{{ root ? `当前：${root}` : '尚未选择目录' }}</span>
          </template>
          <template v-else-if="viewMode === 'verify'">
            <button class="btn-default btn-sm" :disabled="busy || !desktop" @click="chooseVerificationRoot"><AppIcon name="folder" :size="14" />验证文件夹</button>
            <span class="text-[11px] text-fg-3 truncate max-w-48" :title="root">{{ root ? basename(root) : '未选择目录' }}</span>
            <button class="btn-default btn-sm" :disabled="busy || !desktop" @click="chooseManifest"><AppIcon name="hash" :size="14" />JSON 清单</button>
            <span class="text-[11px] text-fg-3 truncate max-w-48" :title="manifestPath">{{ manifestPath ? basename(manifestPath) : '未选择清单' }}</span>
          </template>
          <template v-else>
            <button class="btn-default btn-sm" :disabled="busy || !desktop" @click="chooseCompareRoot('left')"><AppIcon name="folder" :size="14" />左侧文件夹</button>
            <span class="text-[11px] text-fg-3 truncate max-w-48" :title="root">{{ root ? basename(root) : '未选择' }}</span>
            <span class="text-fg-3">→</span>
            <button class="btn-default btn-sm" :disabled="busy || !desktop" @click="chooseCompareRoot('right')"><AppIcon name="folder" :size="14" />右侧文件夹</button>
            <span class="text-[11px] text-fg-3 truncate max-w-48" :title="compareRoot">{{ compareRoot ? basename(compareRoot) : '未选择' }}</span>
          </template>
        </div>
      </template>
    </PageHeader>

    <ToolLayout aside-width="narrow">
      <template v-if="viewMode === 'health'">
        <section v-if="!report" class="panel min-h-96 p-8 stack items-center justify-center gap-4 text-center">
        <span class="center w-14 h-14 rounded-xl bg-accent-soft text-accent"><AppIcon name="search" :size="28" /></span>
        <div class="stack gap-1.5 max-w-xl">
          <h2 class="text-[16px] font-semibold text-fg">扫描前不修改任何文件</h2>
          <p class="text-[12px] text-fg-3 leading-relaxed">Knitspace 只读取目录元信息，并对同大小文件计算 SHA-256。检测到图片且本机有 Czkawka CLI 时，会以固定参数追加只读相似图片扫描；符号链接会跳过，文件数量和哈希总量都有上限，直到你明确选择并确认，任何文件都不会移动。</p>
        </div>
        <button class="btn-primary" :disabled="!desktop || !root || busy" @click="scan"><AppIcon name="search" :size="15" />{{ busy ? '正在扫描…' : '开始扫描' }}</button>
        <p class="text-[11px] text-fg-3" aria-live="polite">{{ message }}</p>
        </section>

        <template v-else>
        <section class="panel p-3 stack gap-3">
          <div class="row-between gap-3">
            <div class="stack gap-0.5 min-w-0"><p class="eyebrow">扫描结果</p><p class="text-[12px] text-fg-2 truncate" :title="report.root">{{ report.root }}</p></div>
            <div class="row gap-1.5 shrink-0"><button class="btn-default btn-sm" :disabled="busy" @click="exportReport"><AppIcon name="download" :size="14" />导出报告</button><button class="btn-default btn-sm" :disabled="busy || !desktop" @click="exportManifest"><AppIcon name="hash" :size="14" />校验清单</button><button class="btn-default btn-sm" :disabled="busy" @click="scan"><AppIcon name="refresh" :size="14" />重新扫描</button></div>
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
              <AppIcon :name="item.kind === 'duplicate' ? 'duplicate' : item.kind === 'similar-image' ? 'image' : item.kind === 'large-file' ? 'file-text' : item.kind === 'empty-directory' ? 'folder' : 'warning'" :size="15" class="text-fg-3 shrink-0" />
              <span class="stack gap-0.5 min-w-0 flex-1"><strong class="text-[12px] font-medium text-fg truncate" :title="item.path">{{ item.relativePath || item.name }}</strong><small class="text-[11px] text-fg-3 truncate">{{ item.detail }}<template v-if="item.suggestedKeep"> · 建议保留</template><template v-if="item.kind === 'similar-image'"> · 仅代表视觉相似，不代表内容重复</template></small></span>
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
      </template>

      <template v-else-if="viewMode === 'compare'">
        <section v-if="!compareReport" class="panel min-h-96 p-8 stack items-center justify-center gap-4 text-center">
          <span class="center w-14 h-14 rounded-xl bg-accent-soft text-accent"><AppIcon name="diff" :size="28" /></span>
          <div class="stack gap-1.5 max-w-xl">
            <h2 class="text-[16px] font-semibold text-fg">对比前不修改任何文件</h2>
            <p class="text-[12px] text-fg-3 leading-relaxed">相同大小的文件会计算 SHA-256，新增、缺少和内容变化会分组显示。读取数量和哈希总量都有安全上限，超出部分会标记为未校验。</p>
          </div>
          <button class="btn-primary" :disabled="!desktop || !root || !compareRoot || busy" @click="compare"><AppIcon name="diff" :size="15" />{{ busy ? '正在对比…' : '开始对比' }}</button>
          <p class="text-[11px] text-fg-3" aria-live="polite">{{ message }}</p>
        </section>

        <template v-else>
          <section class="panel p-3 stack gap-3">
            <div class="row-between gap-3">
              <div class="stack gap-0.5 min-w-0"><p class="eyebrow">对比结果</p><p class="text-[12px] text-fg-2 truncate" :title="`${compareReport.leftRoot} → ${compareReport.rightRoot}`">{{ basename(compareReport.leftRoot) }} → {{ basename(compareReport.rightRoot) }}</p></div>
              <div class="row gap-1.5 shrink-0"><button class="btn-default btn-sm" :disabled="busy" @click="exportCompareReport"><AppIcon name="download" :size="14" />导出报告</button><button class="btn-default btn-sm" :disabled="busy" @click="compare"><AppIcon name="refresh" :size="14" />重新对比</button></div>
            </div>
            <div class="row gap-1.5 flex-wrap" role="tablist" aria-label="对比结果类型">
              <button v-for="item in compareFilters" :key="item.id" class="h-7 px-2.5 rounded-full text-[11px] transition-colors" :class="compareFilter === item.id ? 'bg-accent-solid text-accent-fg font-medium' : 'text-fg-2 hover:bg-surface-2'" :aria-selected="compareFilter === item.id" role="tab" @click="compareFilter = item.id">{{ item.label }} <span class="tabular-nums opacity-70">{{ compareReport ? item.count(compareReport) : 0 }}</span></button>
            </div>
          </section>

          <section v-if="compareItems.length" class="panel overflow-hidden">
            <header class="row-between gap-3 px-3 h-11 border-b border-line"><div class="row gap-2"><AppIcon name="diff" :size="15" class="text-accent" /><strong class="text-[13px] font-medium text-fg">{{ compareFilters.find(item => item.id === compareFilter)?.label }}</strong><span class="text-[11px] text-fg-3">{{ compareItems.length }} 项</span></div><span class="text-[11px] text-fg-3">只读</span></header>
            <ul class="stack gap-0.5 p-1.5 max-h-128 overflow-y-auto">
              <li v-for="item in compareItems" :key="`${item.status}:${item.relativePath}`" class="row gap-2 px-2.5 py-2 rounded-sm hover:bg-surface-2">
                <AppIcon :name="item.status === 'same' ? 'check' : item.status === 'changed' ? 'refresh' : item.status === 'unverified' ? 'warning' : 'file-text'" :size="15" :class="item.status === 'same' ? 'text-success' : item.status === 'unverified' ? 'text-warn' : 'text-accent'" class="shrink-0" />
                <span class="stack gap-0.5 min-w-0 flex-1"><strong class="text-[12px] font-medium text-fg truncate" :title="item.relativePath">{{ item.relativePath || item.name }}</strong><small class="text-[11px] text-fg-3 truncate">{{ item.detail }}</small></span>
                <span class="text-[11px] text-fg-3 tabular-nums shrink-0">{{ item.leftSize === item.rightSize ? formatBytes(item.leftSize ?? 0) : `${formatBytes(item.leftSize ?? 0)} → ${formatBytes(item.rightSize ?? 0)}` }}</span>
              </li>
            </ul>
          </section>
          <section v-else class="panel p-8 stack items-center gap-2 text-center"><AppIcon name="check" :size="22" class="text-success" /><p class="text-[13px] font-medium text-fg">当前筛选没有项目</p><p class="text-[11px] text-fg-3">切换结果类型，或重新对比确认目录状态。</p></section>
        </template>
      </template>

      <template v-else-if="viewMode === 'sync'">
        <section v-if="!syncPlan" class="panel min-h-96 p-8 stack items-center justify-center gap-4 text-center">
          <span class="center w-14 h-14 rounded-xl bg-accent-soft text-accent"><AppIcon name="arrow-right" :size="28" /></span>
          <div class="stack gap-1.5 max-w-xl">
            <h2 class="text-[16px] font-semibold text-fg">先生成不写入文件的同步预览</h2>
            <p class="text-[12px] text-fg-3 leading-relaxed">Knitspace 会重新只读比较两个文件夹。预览只把目标缺少的文件列为“待补齐”，绝不复制、覆盖或删除；内容不同和未校验的文件必须人工决定。</p>
          </div>
          <button class="btn-primary" :disabled="!desktop || !root || !compareRoot || busy" @click="createSyncPreview"><AppIcon name="diff" :size="15" />{{ busy ? '正在生成…' : '生成同步预览' }}</button>
          <p class="text-[11px] text-fg-3" aria-live="polite">{{ message }}</p>
        </section>

        <template v-else>
          <section class="panel p-3 stack gap-3">
            <div class="row-between gap-3">
              <div class="stack gap-0.5 min-w-0"><p class="eyebrow">单向补齐预览</p><p class="text-[12px] text-fg-2 truncate" :title="`${syncPlan.sourceRoot} → ${syncPlan.targetRoot}`">{{ basename(syncPlan.sourceRoot) }} → {{ basename(syncPlan.targetRoot) }}</p></div>
              <div class="row gap-1.5 shrink-0"><button class="btn-default btn-sm" :disabled="busy" @click="exportSyncPreview"><AppIcon name="download" :size="14" />导出预览</button><button class="btn-default btn-sm" :disabled="busy" @click="createSyncPreview"><AppIcon name="refresh" :size="14" />重新生成</button></div>
            </div>
            <div class="row gap-1 p-0.5 rounded-sm bg-surface-2 w-fit" role="tablist" aria-label="同步方向">
              <button class="h-7 px-2.5 rounded-sm text-[11px]" :class="syncDirection === 'left-to-right' ? 'bg-surface text-fg shadow-sm' : 'text-fg-3 hover:text-fg-2'" role="tab" :aria-selected="syncDirection === 'left-to-right'" @click="syncDirection = 'left-to-right'">左侧 → 右侧补齐</button>
              <button class="h-7 px-2.5 rounded-sm text-[11px]" :class="syncDirection === 'right-to-left' ? 'bg-surface text-fg shadow-sm' : 'text-fg-3 hover:text-fg-2'" role="tab" :aria-selected="syncDirection === 'right-to-left'" @click="syncDirection = 'right-to-left'">右侧 → 左侧补齐</button>
            </div>
            <p class="text-[11px] text-fg-3 leading-relaxed">此页面仅生成计划。目标独有文件保持不动，内容不同与未校验文件不会被覆盖；即使“待补齐”条目也不会在这里自动执行。</p>
          </section>

          <section class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="panel p-3 stack gap-1"><p class="eyebrow">待补齐</p><strong class="text-[18px] font-semibold text-fg tabular-nums">{{ syncPlan.copyCount }}</strong><span class="text-[11px] text-fg-3">预计 {{ formatBytes(syncPlan.copyBytes) }} · 尚未复制</span></div>
            <div class="panel p-3 stack gap-1"><p class="eyebrow">内容冲突</p><strong class="text-[18px] font-semibold text-warn tabular-nums">{{ syncPlan.conflictCount }}</strong><span class="text-[11px] text-fg-3">两侧不同，必须人工决定</span></div>
            <div class="panel p-3 stack gap-1"><p class="eyebrow">人工复核</p><strong class="text-[18px] font-semibold text-warn tabular-nums">{{ syncPlan.reviewCount }}</strong><span class="text-[11px] text-fg-3">未校验或路径不适合自动操作</span></div>
          </section>

          <section class="panel p-3 stack gap-2">
            <p class="eyebrow text-warn">安全边界</p>
            <p v-for="warning in syncPlan.warnings" :key="warning" class="text-[11px] text-fg-3 leading-relaxed">{{ warning }}</p>
          </section>

          <section v-if="syncItems.length" class="panel overflow-hidden">
            <header class="row-between gap-3 px-3 h-11 border-b border-line"><div class="row gap-2"><AppIcon name="diff" :size="15" class="text-accent" /><strong class="text-[13px] font-medium text-fg">{{ syncActionFilters.find(item => item.id === syncFilter)?.label }}</strong><span class="text-[11px] text-fg-3">{{ syncItems.length }} 项</span></div><span class="text-[11px] text-fg-3">只读预览</span></header>
            <div class="row gap-1.5 flex-wrap px-3 py-2 border-b border-line" role="tablist" aria-label="同步预览类型">
              <button v-for="item in syncActionFilters" :key="item.id" class="h-7 px-2.5 rounded-full text-[11px] transition-colors" :class="syncFilter === item.id ? 'bg-accent-solid text-accent-fg font-medium' : 'text-fg-2 hover:bg-surface-2'" :aria-selected="syncFilter === item.id" role="tab" @click="syncFilter = item.id">{{ item.label }} <span class="tabular-nums opacity-70">{{ item.count(syncPlan) }}</span></button>
            </div>
            <ul class="stack gap-0.5 p-1.5 max-h-128 overflow-y-auto">
              <li v-for="item in syncItems" :key="`${item.action}:${item.relativePath}`" class="row gap-2 px-2.5 py-2 rounded-sm hover:bg-surface-2">
                <AppIcon :name="syncActionIcon(item.action)" :size="15" :class="syncActionTone(item.action)" class="shrink-0" />
                <span class="stack gap-0.5 min-w-0 flex-1"><strong class="text-[12px] font-medium text-fg truncate" :title="item.relativePath">{{ item.relativePath }}</strong><small class="text-[11px] text-fg-3 truncate">{{ syncActionLabel(item.action) }} · {{ item.detail }}</small></span>
                <span class="text-[11px] text-fg-3 tabular-nums shrink-0">{{ item.action === 'copy-missing' ? formatBytes(item.sourceBytes ?? 0) : item.sourceBytes === item.targetBytes ? formatBytes(item.sourceBytes ?? 0) : `${formatBytes(item.sourceBytes ?? 0)} → ${formatBytes(item.targetBytes ?? 0)}` }}</span>
              </li>
            </ul>
          </section>
          <section v-else class="panel p-8 stack items-center gap-2 text-center"><AppIcon name="check" :size="22" class="text-success" /><p class="text-[13px] font-medium text-fg">当前筛选没有项目</p><p class="text-[11px] text-fg-3">切换预览类型，或重新生成目录对比。</p></section>
        </template>
      </template>

      <template v-else>
        <section v-if="!verificationReport" class="panel min-h-96 p-8 stack items-center justify-center gap-4 text-center">
          <span class="center w-14 h-14 rounded-xl bg-accent-soft text-accent"><AppIcon name="hash" :size="28" /></span>
          <div class="stack gap-1.5 max-w-xl">
            <h2 class="text-[16px] font-semibold text-fg">对照校验清单确认文件完整性</h2>
            <p class="text-[12px] text-fg-3 leading-relaxed">选择文件夹和 Knitspace 导出的 JSON 校验清单后，会只读检查缺失、额外文件、大小与 SHA-256。清单中的不安全路径、符号链接和解析到目录外的路径都会拒绝处理。</p>
          </div>
          <button class="btn-primary" :disabled="!desktop || !root || !manifestPath || busy" @click="verifyManifest"><AppIcon name="hash" :size="15" />{{ busy ? '正在验证…' : '开始验证' }}</button>
          <p class="text-[11px] text-fg-3" aria-live="polite">{{ message }}</p>
        </section>

        <template v-else>
          <section class="panel p-3 stack gap-3">
            <div class="row-between gap-3">
              <div class="stack gap-0.5 min-w-0"><p class="eyebrow">验证结果</p><p class="text-[12px] text-fg-2 truncate" :title="`${verificationReport.root} ← ${verificationReport.manifestPath}`">{{ basename(verificationReport.root) }} ← {{ basename(verificationReport.manifestPath) }}</p></div>
              <div class="row gap-1.5 shrink-0"><button class="btn-default btn-sm" :disabled="busy" @click="exportVerificationReport"><AppIcon name="download" :size="14" />导出报告</button><button class="btn-default btn-sm" :disabled="busy" @click="verifyManifest"><AppIcon name="refresh" :size="14" />重新验证</button></div>
            </div>
            <p class="text-[11px] text-fg-3 leading-relaxed">只读验证：不会修复、复制、删除或覆盖文件。只有“大小和 SHA-256 都一致”才会标为一致；仅匹配大小的条目会保留为未验证。</p>
          </section>

          <section class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="panel p-3 stack gap-1"><p class="eyebrow">已一致</p><strong class="text-[18px] font-semibold text-success tabular-nums">{{ verificationReport.matchCount }}</strong><span class="text-[11px] text-fg-3">大小和 SHA-256 均匹配</span></div>
            <div class="panel p-3 stack gap-1"><p class="eyebrow">内容或大小变化</p><strong class="text-[18px] font-semibold text-accent tabular-nums">{{ verificationReport.sizeMismatchCount + verificationReport.hashMismatchCount }}</strong><span class="text-[11px] text-fg-3">文件存在但与清单不同</span></div>
            <div class="panel p-3 stack gap-1"><p class="eyebrow">需复核</p><strong class="text-[18px] font-semibold text-warn tabular-nums">{{ verificationIssueCount - verificationReport.sizeMismatchCount - verificationReport.hashMismatchCount }}</strong><span class="text-[11px] text-fg-3">缺失、额外、未验证或无法读取</span></div>
          </section>

          <section v-if="verificationItems.length" class="panel overflow-hidden">
            <header class="row-between gap-3 px-3 h-11 border-b border-line"><div class="row gap-2"><AppIcon name="hash" :size="15" class="text-accent" /><strong class="text-[13px] font-medium text-fg">{{ verificationFilters.find(item => item.id === verificationFilter)?.label }}</strong><span class="text-[11px] text-fg-3">{{ verificationItems.length }} 项</span></div><span class="text-[11px] text-fg-3">只读</span></header>
            <div class="row gap-1.5 flex-wrap px-3 py-2 border-b border-line" role="tablist" aria-label="清单验证结果类型">
              <button v-for="item in verificationFilters" :key="item.id" class="h-7 px-2.5 rounded-full text-[11px] transition-colors" :class="verificationFilter === item.id ? 'bg-accent-solid text-accent-fg font-medium' : 'text-fg-2 hover:bg-surface-2'" :aria-selected="verificationFilter === item.id" role="tab" @click="verificationFilter = item.id">{{ item.label }} <span class="tabular-nums opacity-70">{{ item.count(verificationReport) }}</span></button>
            </div>
            <ul class="stack gap-0.5 p-1.5 max-h-128 overflow-y-auto">
              <li v-for="item in verificationItems" :key="`${item.status}:${item.relativePath}`" class="row gap-2 px-2.5 py-2 rounded-sm hover:bg-surface-2">
                <AppIcon :name="verificationStatusIcon(item.status)" :size="15" :class="verificationStatusTone(item.status)" class="shrink-0" />
                <span class="stack gap-0.5 min-w-0 flex-1"><strong class="text-[12px] font-medium text-fg truncate" :title="item.relativePath">{{ item.relativePath || item.name }}</strong><small class="text-[11px] text-fg-3 truncate">{{ verificationStatusLabel(item.status) }} · {{ item.detail }}</small></span>
                <span class="text-[11px] text-fg-3 tabular-nums shrink-0">{{ item.expectedSize === undefined ? `当前 ${formatBytes(item.actualSize ?? 0)}` : item.actualSize === undefined ? `清单 ${formatBytes(item.expectedSize)}` : item.expectedSize === item.actualSize ? formatBytes(item.actualSize) : `${formatBytes(item.expectedSize)} → ${formatBytes(item.actualSize)}` }}</span>
              </li>
            </ul>
          </section>
          <section v-else class="panel p-8 stack items-center gap-2 text-center"><AppIcon name="check" :size="22" class="text-success" /><p class="text-[13px] font-medium text-fg">当前筛选没有项目</p><p class="text-[11px] text-fg-3">切换验证结果类型，或重新验证文件夹。</p></section>

        </template>
      </template>

      <template #aside>
        <template v-if="viewMode === 'health'">
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
        <template v-else-if="viewMode === 'compare'">
          <section class="panel p-4 stack gap-4">
            <p class="eyebrow">对比设置</p>
            <p class="text-[11px] text-fg-3 leading-relaxed">左侧可理解为基准目录，右侧是待检查目录。只报告差异，不提供同步或覆盖操作。</p>
            <button class="btn-primary btn-lg w-full" :disabled="!desktop || !root || !compareRoot || busy" @click="compare"><AppIcon name="diff" :size="15" />{{ busy ? '正在对比…' : compareReport ? '重新对比' : '开始对比' }}</button>
            <p class="text-[11px] text-fg-3 leading-relaxed" aria-live="polite">{{ message }}</p>
          </section>
          <section v-if="compareReport" class="panel p-4 stack gap-2">
            <p class="eyebrow">只读结果</p>
            <div class="row-between text-[11px] text-fg-3"><span>哈希校验</span><span class="tabular-nums">{{ formatBytes(compareReport.hashedBytes) }}</span></div>
            <div class="row-between text-[11px] text-fg-3"><span>左侧文件</span><span class="tabular-nums">{{ compareReport.scannedLeftFiles }}</span></div>
            <div class="row-between text-[11px] text-fg-3"><span>右侧文件</span><span class="tabular-nums">{{ compareReport.scannedRightFiles }}</span></div>
            <p v-if="compareReport.truncated" class="text-[11px] text-warn leading-relaxed">结果触及上限，未校验项请人工复核。</p>
          </section>
          <section v-if="compareWarnings.length" class="panel p-4 stack gap-2"><p class="eyebrow text-warn">对比提示</p><p v-for="warning in compareWarnings.slice(0, 5)" :key="warning" class="text-[11px] text-fg-3 leading-relaxed">{{ warning }}</p><p v-if="compareWarnings.length > 5" class="text-[11px] text-fg-3">另有 {{ compareWarnings.length - 5 }} 条提示已收起。</p></section>
        </template>
        <template v-else-if="viewMode === 'sync'">
          <section class="panel p-4 stack gap-4">
            <p class="eyebrow">预览策略</p>
            <p class="text-[11px] text-fg-3 leading-relaxed">把一侧视为来源、另一侧视为目标。仅提示“目标缺少”的文件；不删除目标独有文件，不覆盖内容不同文件，也不在本页执行复制。</p>
            <button class="btn-primary btn-lg w-full" :disabled="!desktop || !root || !compareRoot || busy" @click="createSyncPreview"><AppIcon name="diff" :size="15" />{{ busy ? '正在生成…' : syncPlan ? '重新生成预览' : '生成同步预览' }}</button>
            <p class="text-[11px] text-fg-3 leading-relaxed" aria-live="polite">{{ message }}</p>
          </section>
          <section v-if="syncPlan" class="panel p-4 stack gap-2">
            <p class="eyebrow">预览摘要</p>
            <div class="row-between text-[11px] text-fg-3"><span>目标缺少</span><span class="tabular-nums">{{ syncPlan.copyCount }} · {{ formatBytes(syncPlan.copyBytes) }}</span></div>
            <div class="row-between text-[11px] text-fg-3"><span>目标保留</span><span class="tabular-nums">{{ syncPlan.keepTargetCount }}</span></div>
            <div class="row-between text-[11px] text-fg-3"><span>冲突 / 复核</span><span class="tabular-nums">{{ syncPlan.conflictCount }} / {{ syncPlan.reviewCount }}</span></div>
            <p v-if="syncPlan.partial" class="text-[11px] text-warn leading-relaxed">原始对比触及安全上限，不能将此预览当作完整同步清单。</p>
          </section>
          <section v-if="compareWarnings.length" class="panel p-4 stack gap-2"><p class="eyebrow text-warn">对比提示</p><p v-for="warning in compareWarnings.slice(0, 5)" :key="warning" class="text-[11px] text-fg-3 leading-relaxed">{{ warning }}</p><p v-if="compareWarnings.length > 5" class="text-[11px] text-fg-3">另有 {{ compareWarnings.length - 5 }} 条提示已收起。</p></section>
        </template>
        <template v-else>
          <section class="panel p-4 stack gap-4">
            <p class="eyebrow">验证设置</p>
            <p class="text-[11px] text-fg-3 leading-relaxed">选择文件夹和 Knitspace 导出的 JSON 清单。验证只读取当前目录和清单；不会更改任何文件，也不会跟随符号链接或目录外路径。</p>
            <button class="btn-primary btn-lg w-full" :disabled="!desktop || !root || !manifestPath || busy" @click="verifyManifest"><AppIcon name="hash" :size="15" />{{ busy ? '正在验证…' : verificationReport ? '重新验证' : '开始验证' }}</button>
            <p class="text-[11px] text-fg-3 leading-relaxed" aria-live="polite">{{ message }}</p>
          </section>
          <section v-if="verificationReport" class="panel p-4 stack gap-2">
            <p class="eyebrow">验证摘要</p>
            <div class="row-between text-[11px] text-fg-3"><span>带哈希一致</span><span class="tabular-nums">{{ verificationReport.matchCount }}</span></div>
            <div class="row-between text-[11px] text-fg-3"><span>缺失 / 额外</span><span class="tabular-nums">{{ verificationReport.missingCount }} / {{ verificationReport.extraCount }}</span></div>
            <div class="row-between text-[11px] text-fg-3"><span>哈希内容</span><span class="tabular-nums">{{ formatBytes(verificationReport.hashedBytes) }}</span></div>
            <p v-if="verificationReport.truncated" class="text-[11px] text-warn leading-relaxed">清单或扫描触及安全上限，未验证项目需人工复核。</p>
          </section>
          <section v-if="verificationWarnings.length" class="panel p-4 stack gap-2"><p class="eyebrow text-warn">验证提示</p><p v-for="warning in verificationWarnings.slice(0, 5)" :key="warning" class="text-[11px] text-fg-3 leading-relaxed">{{ warning }}</p><p v-if="verificationWarnings.length > 5" class="text-[11px] text-fg-3">另有 {{ verificationWarnings.length - 5 }} 条提示已收起。</p></section>
        </template>
      </template>
    </ToolLayout>
  </div>
</template>
