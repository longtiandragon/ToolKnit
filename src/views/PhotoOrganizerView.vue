<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import ToolLayout from '@/components/ToolLayout.vue'
import FieldRow from '@/components/FieldRow.vue'
import { newId } from '@/lib/id'
import { isDesktop, revealDesktopFile } from '@/lib/native'
import {
  cancelDesktopPhotoOrganization,
  executeDesktopPhotoOrganization,
  listDesktopPhotoOrganizationReceipts,
  scanDesktopPhotoOrganization,
  undoDesktopPhotoOrganization,
  type PhotoOrganizationNaming,
  type PhotoOrganizationPlan,
  type PhotoOrganizationPlanItem,
  type PhotoOrganizationReceiptSummary,
  type PhotoOrganizationStatus,
} from '@/lib/photo-organizer-native'
import { useUiStore } from '@/stores/ui'
import { useWorkbenchStore } from '@/stores/workbench'
import type { FileReference } from '@/types'

type PlanFilter = 'all' | PhotoOrganizationStatus

const route = useRoute()
const qaPreview = import.meta.env.DEV && route.query.qa === 'preview' && window.location.hostname === '127.0.0.1' && ['1420', '1421'].includes(window.location.port)
const desktop = isDesktop() || qaPreview
const router = useRouter()
const ui = useUiStore()
const store = useWorkbenchStore()
const sourceRoot = ref('')
const destinationRoot = ref('')
const naming = ref<PhotoOrganizationNaming>('datetime-original')
const fallbackToFileModified = ref(false)
const plan = ref<PhotoOrganizationPlan>()
const selectedPaths = ref(new Set<string>())
const filter = ref<PlanFilter>('all')
const busy = ref(false)
const executing = ref(false)
const cancelling = ref(false)
const undoingId = ref('')
const activeRunId = ref('')
const receipts = ref<PhotoOrganizationReceiptSummary[]>([])
const message = ref(desktop ? '先选择照片源目录与整理目标；扫描阶段只读，不会移动文件。' : '此功能需要 Windows 桌面端与本机 ExifTool。')

const moveItems = computed(() => plan.value?.items.filter(item => item.status === 'move' && item.targetRelativePath) ?? [])
const selectedItems = computed(() => moveItems.value.filter(item => selectedPaths.value.has(item.sourceRelativePath)))
const filteredItems = computed(() => {
  const items = plan.value?.items ?? []
  return filter.value === 'all' ? items : items.filter(item => item.status === filter.value)
})
const visibleItems = computed(() => filteredItems.value.slice(0, 300))
const allMovesSelected = computed(() => moveItems.value.length > 0 && selectedItems.value.length === moveItems.value.length)
const canScan = computed(() => desktop && !busy.value && Boolean(sourceRoot.value && destinationRoot.value))
const canExecute = computed(() => !busy.value && !plan.value?.truncated && selectedItems.value.length > 0)

const filters = computed(() => [
  { id: 'all' as const, label: '全部', count: plan.value?.items.length ?? 0 },
  { id: 'move' as const, label: '可移动', count: plan.value?.moveCount ?? 0 },
  { id: 'conflict' as const, label: '冲突', count: plan.value?.conflictCount ?? 0 },
  { id: 'skipped' as const, label: '跳过', count: plan.value?.skippedCount ?? 0 },
  { id: 'same' as const, label: '已整理', count: plan.value?.sameCount ?? 0 },
])

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function statusLabel(status: PhotoOrganizationStatus) {
  return status === 'move' ? '可移动' : status === 'same' ? '已整理' : status === 'conflict' ? '目标冲突' : '缺少日期'
}

function statusTone(status: PhotoOrganizationStatus) {
  return status === 'move' ? 'text-accent bg-accent-soft' : status === 'same' ? 'text-success bg-success-soft' : status === 'conflict' ? 'text-danger bg-danger-soft' : 'text-warn bg-warn-soft'
}

function invalidatePlan() {
  plan.value = undefined
  selectedPaths.value = new Set()
  filter.value = 'all'
}

watch([sourceRoot, destinationRoot, naming, fallbackToFileModified], invalidatePlan)

async function chooseDirectory(target: 'source' | 'destination') {
  if (!desktop || busy.value) return
  const selected = await open({
    title: target === 'source' ? '选择照片源目录' : '选择整理目标目录',
    directory: true,
    multiple: false,
  })
  if (typeof selected !== 'string') return
  if (target === 'source') {
    sourceRoot.value = selected
    if (!destinationRoot.value) destinationRoot.value = selected
  } else destinationRoot.value = selected
}

async function scan() {
  if (!canScan.value) return
  busy.value = true
  message.value = '正在用 ExifTool 只读扫描拍摄时间；最多读取 5,000 张照片。'
  try {
    const result = await scanDesktopPhotoOrganization({
      sourceRoot: sourceRoot.value,
      destinationRoot: destinationRoot.value,
      naming: naming.value,
      fallbackToFileModified: fallbackToFileModified.value,
    })
    plan.value = result
    selectedPaths.value = new Set(result.items.filter(item => item.status === 'move').map(item => item.sourceRelativePath))
    message.value = result.scannedCount
      ? `扫描完成：${result.moveCount} 张可移动，${result.conflictCount} 张冲突，${result.skippedCount} 张缺少日期。`
      : '没有找到受支持的照片。'
  } catch (error) {
    message.value = error instanceof Error ? error.message : '照片扫描失败。'
    ui.toast('照片扫描失败', message.value, 'error')
  } finally {
    busy.value = false
  }
}

function toggleItem(item: PhotoOrganizationPlanItem) {
  if (item.status !== 'move' || busy.value) return
  const next = new Set(selectedPaths.value)
  if (next.has(item.sourceRelativePath)) next.delete(item.sourceRelativePath)
  else next.add(item.sourceRelativePath)
  selectedPaths.value = next
}

function toggleAllMoves() {
  selectedPaths.value = allMovesSelected.value ? new Set() : new Set(moveItems.value.map(item => item.sourceRelativePath))
}

async function executePlan() {
  const current = plan.value
  if (!current || !canExecute.value) return
  const approved = await ui.confirm({
    title: `移动选中的 ${selectedItems.value.length} 张照片？`,
    message: '文件会移动到目标目录的“年/月”子目录。执行前会重新校验，绝不覆盖同名目标；失败或取消会回滚，成功后也可从本页撤销。',
    confirmLabel: '确认移动',
    danger: true,
  })
  if (!approved) return

  const runId = newId()
  const inputs: FileReference[] = selectedItems.value.slice(0, 200).map(item => ({ name: basename(item.sourcePath), path: item.sourcePath, size: item.size, mime: 'image/*' }))
  const job = store.addJob('image', '整理 · 按拍摄日期', selectedItems.value.map(item => basename(item.sourcePath)).slice(0, 200), {
    toolId: 'organize:photo-date',
    route: '/tools?mode=photo-organizer',
    parameters: { naming: naming.value, fallbackToFileModified: fallbackToFileModified.value },
    inputs,
    retryable: false,
  })
  activeRunId.value = runId
  busy.value = true
  executing.value = true
  cancelling.value = false
  store.updateJob(job.id, { status: 'running', progress: 35, detail: '正在逐项校验并移动；取消时会自动回滚。' })
  message.value = '正在逐项校验并移动；取消时会自动回滚。'
  try {
    const result = await executeDesktopPhotoOrganization(current, selectedItems.value, runId)
    const outputs = result.outputPaths.slice(0, 200).map(path => ({ name: basename(path), path, mime: 'image/*' }))
    store.updateJob(job.id, {
      status: 'succeeded', progress: 100, outputs, outputNames: outputs.map(item => item.name),
      detail: `已移动 ${result.movedCount} 张照片；回滚凭据 ${result.receiptId} 已保存在本机。`,
    })
    message.value = `已移动 ${result.movedCount} 张照片（${formatBytes(result.movedBytes)}），可从右侧“最近整理”撤销。`
    ui.toast('照片整理完成', `${result.movedCount} 张 · 可回滚`, 'success')
    invalidatePlan()
    await refreshReceipts()
  } catch (error) {
    const detail = error instanceof Error ? error.message : '照片整理失败。'
    const cancelled = cancelling.value || detail.includes('取消')
    store.updateJob(job.id, { status: cancelled ? 'cancelled' : 'failed', progress: 100, errorCode: cancelled ? 'TOOL_CANCELLED' : 'TOOL_EXECUTION_FAILED', detail })
    message.value = detail
    ui.toast(cancelled ? '照片整理已停止' : '照片整理失败', detail, cancelled ? 'warning' : 'error')
    await refreshReceipts()
  } finally {
    activeRunId.value = ''
    busy.value = false
    executing.value = false
    cancelling.value = false
  }
}

async function cancelExecution() {
  if (!activeRunId.value || cancelling.value) return
  cancelling.value = true
  message.value = '正在停止；已移动的照片会按相反顺序回滚。'
  try { await cancelDesktopPhotoOrganization(activeRunId.value) } catch { /* worker result reports the final state */ }
}

async function refreshReceipts() {
  if (!desktop || qaPreview) return
  try { receipts.value = await listDesktopPhotoOrganizationReceipts() } catch { receipts.value = [] }
}

async function undoReceipt(receipt: PhotoOrganizationReceiptSummary) {
  if (busy.value) return
  const approved = await ui.confirm({
    title: `撤销这次 ${receipt.movedCount} 张照片的整理？`,
    message: 'Knitspace 会先确认整理后的文件没有变化、原位置没有同名文件，然后全部移回；任何冲突都会停止，不会覆盖。',
    confirmLabel: '确认撤销',
    danger: true,
  })
  if (!approved) return
  const job = store.addJob('image', '整理 · 撤销照片移动', [], { toolId: 'organize:photo-date-undo', route: '/tools?mode=photo-organizer', retryable: false })
  busy.value = true
  undoingId.value = receipt.receiptId
  store.updateJob(job.id, { status: 'running', progress: 40, detail: '正在校验并恢复照片原位置。' })
  try {
    const result = await undoDesktopPhotoOrganization(receipt.receiptId)
    store.updateJob(job.id, { status: 'succeeded', progress: 100, detail: `已恢复 ${result.restoredCount} 张照片到原位置。` })
    message.value = `已撤销整理，${result.restoredCount} 张照片恢复到原位置。`
    ui.toast('已撤销照片整理', `${result.restoredCount} 张照片已恢复`, 'success')
    await refreshReceipts()
  } catch (error) {
    const detail = error instanceof Error ? error.message : '撤销照片整理失败。'
    store.updateJob(job.id, { status: 'failed', progress: 100, errorCode: 'TOOL_EXECUTION_FAILED', detail })
    message.value = detail
    ui.toast('无法撤销照片整理', detail, 'error')
  } finally {
    busy.value = false
    undoingId.value = ''
  }
}

async function loadQaPreview() {
  sourceRoot.value = 'C:\\Knitspace-QA\\待整理'
  destinationRoot.value = 'D:\\照片归档'
  await nextTick()
  plan.value = {
    planId: '11111111-1111-4111-8111-111111111111',
    sourceRoot: sourceRoot.value,
    destinationRoot: destinationRoot.value,
    scannedCount: 5,
    moveCount: 2,
    sameCount: 1,
    conflictCount: 1,
    skippedCount: 1,
    fallbackCount: 0,
    truncated: false,
    warnings: ['执行前会重新校验文件大小与修改时间。', '目标文件已存在时会停止，不会覆盖。'],
    items: [
      { sourcePath: `${sourceRoot.value}\\旅行\\IMG_1024.jpg`, sourceRelativePath: '旅行/IMG_1024.jpg', targetPath: `${destinationRoot.value}\\2026\\08\\20260816-093012-IMG_1024.jpg`, targetRelativePath: '2026/08/20260816-093012-IMG_1024.jpg', capturedAt: '2026-08-16T09:30:12', dateSource: 'DateTimeOriginal', size: 4_218_912, modifiedMs: 1_776_000_000_000, status: 'move', detail: '将按拍摄年月移动。' },
      { sourcePath: `${sourceRoot.value}\\旅行\\IMG_1025.jpg`, sourceRelativePath: '旅行/IMG_1025.jpg', targetPath: `${destinationRoot.value}\\2026\\08\\20260816-093105-IMG_1025.jpg`, targetRelativePath: '2026/08/20260816-093105-IMG_1025.jpg', capturedAt: '2026-08-16T09:31:05', dateSource: 'DateTimeOriginal', size: 3_907_584, modifiedMs: 1_776_000_001_000, status: 'move', detail: '将按拍摄年月移动。' },
      { sourcePath: `${sourceRoot.value}\\IMG_0999.jpg`, sourceRelativePath: 'IMG_0999.jpg', targetPath: `${destinationRoot.value}\\2026\\07\\20260730-182211-IMG_0999.jpg`, targetRelativePath: '2026/07/20260730-182211-IMG_0999.jpg', capturedAt: '2026-07-30T18:22:11', dateSource: 'DateTimeOriginal', size: 2_401_280, modifiedMs: 1_775_000_000_000, status: 'conflict', detail: '目标目录已有同名文件。' },
      { sourcePath: `${sourceRoot.value}\\旧照片.png`, sourceRelativePath: '旧照片.png', size: 824_320, modifiedMs: 1_774_000_000_000, status: 'skipped', detail: '没有可用的 EXIF 拍摄日期。' },
      { sourcePath: `${destinationRoot.value}\\2025\\12\\IMG_0001.jpg`, sourceRelativePath: '2025/12/IMG_0001.jpg', targetPath: `${destinationRoot.value}\\2025\\12\\IMG_0001.jpg`, targetRelativePath: '2025/12/IMG_0001.jpg', capturedAt: '2025-12-08T14:05:09', dateSource: 'DateTimeOriginal', size: 1_902_592, modifiedMs: 1_765_000_000_000, status: 'same', detail: '文件已在目标位置。' },
    ],
  }
  selectedPaths.value = new Set(plan.value.items.filter(item => item.status === 'move').map(item => item.sourceRelativePath))
  receipts.value = [{ receiptId: '22222222-2222-4222-8222-222222222222', createdAt: '2026-08-17T11:42:00Z', sourceRoot: sourceRoot.value, destinationRoot: destinationRoot.value, movedCount: 18 }]
  message.value = '交互验收数据：2 张可移动，1 张冲突，1 张缺少日期。'
}

onMounted(() => {
  if (qaPreview) void loadQaPreview()
  else void refreshReceipts()
})
</script>

<template>
  <div class="page-enter mx-auto w-full max-w-320 px-8 py-6">
    <PageHeader title="按拍摄日期整理照片" subtitle="读取 EXIF 拍摄时间，预览“年/月”目录与新文件名，确认后再移动；不覆盖，支持撤销。">
      <template #actions>
        <span class="row gap-1.5 h-9 px-3 rounded-sm bg-surface-2 text-[12px] text-fg-3">
          <AppIcon name="shield" :size="14" />{{ desktop ? '本机处理 · 可回滚' : '需要桌面端' }}
        </span>
      </template>
      <template #lead>
        <button class="btn-ghost btn-sm" :disabled="busy" @click="router.push({ path: '/tools', query: { group: 'organize', operation: 'rename-report' } })">
          <AppIcon name="chevron-left" :size="14" />返回其他整理工具
        </button>
      </template>
    </PageHeader>

    <ToolLayout>
      <section class="panel p-4 stack gap-3">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <button class="stack gap-1 p-3 rounded-md border border-line text-left hover:bg-surface-2 disabled:opacity-55" :disabled="!desktop || busy" @click="chooseDirectory('source')">
            <span class="row gap-2 text-[12px] font-medium text-fg"><AppIcon name="folder-open" :size="15" />照片源目录</span>
            <span class="text-[11px] text-fg-3 truncate" :title="sourceRoot">{{ sourceRoot || '点击选择；会递归扫描常见图片格式' }}</span>
          </button>
          <button class="stack gap-1 p-3 rounded-md border border-line text-left hover:bg-surface-2 disabled:opacity-55" :disabled="!desktop || busy" @click="chooseDirectory('destination')">
            <span class="row gap-2 text-[12px] font-medium text-fg"><AppIcon name="folder" :size="15" />整理目标目录</span>
            <span class="text-[11px] text-fg-3 truncate" :title="destinationRoot">{{ destinationRoot || '默认可与源目录相同' }}</span>
          </button>
        </div>
        <div class="row-between gap-3 flex-wrap">
          <p class="text-[12px] leading-relaxed text-fg-3" aria-live="polite">{{ message }}</p>
          <button class="btn-primary btn-sm shrink-0" :disabled="!canScan" @click="scan">
            <AppIcon name="search" :size="14" />{{ busy && !executing ? '正在扫描…' : '扫描并生成预览' }}
          </button>
        </div>
      </section>

      <template v-if="plan">
        <section class="grid grid-cols-2 md:grid-cols-5 gap-2" aria-label="照片整理扫描摘要">
          <article class="panel p-3"><p class="text-[11px] text-fg-3">已扫描</p><strong class="text-lg tabular-nums">{{ plan.scannedCount }}</strong></article>
          <article class="panel p-3"><p class="text-[11px] text-fg-3">可移动</p><strong class="text-lg tabular-nums text-accent">{{ plan.moveCount }}</strong></article>
          <article class="panel p-3"><p class="text-[11px] text-fg-3">目标冲突</p><strong class="text-lg tabular-nums text-danger">{{ plan.conflictCount }}</strong></article>
          <article class="panel p-3"><p class="text-[11px] text-fg-3">缺少日期</p><strong class="text-lg tabular-nums text-warn">{{ plan.skippedCount }}</strong></article>
          <article class="panel p-3"><p class="text-[11px] text-fg-3">已在目标</p><strong class="text-lg tabular-nums text-success">{{ plan.sameCount }}</strong></article>
        </section>

        <section class="panel overflow-hidden">
          <header class="row-between gap-3 px-3 py-2.5 border-b border-line flex-wrap">
            <div class="row gap-1 flex-wrap" role="tablist" aria-label="筛选照片整理项目">
              <button v-for="item in filters" :key="item.id" class="h-7 px-2.5 rounded-full text-[11px]" :class="filter === item.id ? 'bg-accent-solid text-accent-fg' : 'text-fg-3 hover:bg-surface-2'" @click="filter = item.id">
                {{ item.label }} {{ item.count }}
              </button>
            </div>
            <button class="btn-ghost btn-sm" :disabled="!moveItems.length || busy" @click="toggleAllMoves">
              <AppIcon name="check" :size="13" />{{ allMovesSelected ? '取消全选' : '选择全部可移动项' }}
            </button>
          </header>
          <ul class="stack gap-0.5 p-1.5 max-h-116 overflow-y-auto">
            <li v-for="item in visibleItems" :key="item.sourceRelativePath" class="row gap-2.5 px-2 py-2 rounded-sm hover:bg-surface-2">
              <input v-if="item.status === 'move'" type="checkbox" class="accent-accent shrink-0" :checked="selectedPaths.has(item.sourceRelativePath)" :disabled="busy" :aria-label="`选择 ${item.sourceRelativePath}`" @change="toggleItem(item)" />
              <span v-else class="w-3.5 shrink-0" />
              <span class="stack gap-0.5 min-w-0 flex-1">
                <span class="row gap-2 min-w-0"><strong class="text-[12px] font-medium text-fg truncate">{{ item.sourceRelativePath }}</strong><span class="px-1.5 py-0.5 rounded text-[10px] shrink-0" :class="statusTone(item.status)">{{ statusLabel(item.status) }}</span></span>
                <span class="text-[11px] text-fg-3 truncate" :title="item.targetRelativePath">{{ item.targetRelativePath ? `→ ${item.targetRelativePath}` : item.detail }}</span>
              </span>
              <span class="stack items-end gap-0.5 shrink-0 text-[10px] text-fg-3 tabular-nums"><span>{{ item.capturedAt || '无日期' }}</span><span>{{ formatBytes(item.size) }}</span></span>
            </li>
          </ul>
          <p v-if="filteredItems.length > visibleItems.length" class="px-3 py-2 border-t border-line text-[11px] text-fg-3">为保持页面流畅，仅显示前 300 项；执行仍以你的完整选择为准。</p>
        </section>
      </template>

      <section v-else-if="!desktop" class="panel p-6 stack items-center gap-2 text-center">
        <AppIcon name="warning" :size="22" class="text-warn" />
        <strong class="text-[14px]">浏览器无法安全移动本机照片</strong>
        <p class="text-[12px] text-fg-3">请使用 Windows 桌面端，并在本机安装 ExifTool。</p>
      </section>

      <template #aside>
        <section class="panel p-4 stack gap-4">
          <p class="eyebrow">整理规则</p>
          <FieldRow label="文件名">
            <select v-model="naming" class="field w-full" :disabled="busy">
              <option value="datetime-original">日期时间 + 原文件名</option>
              <option value="datetime">仅日期时间</option>
              <option value="keep">保留原文件名</option>
            </select>
          </FieldRow>
          <p class="text-[11px] text-fg-3 leading-relaxed">目录固定为 <code>年/月</code>。同一秒拍摄的同名结果会添加两位序号；磁盘上已有的目标会标为冲突，不会覆盖。</p>
          <label class="row gap-2 text-[12px] text-fg-2 cursor-pointer">
            <input v-model="fallbackToFileModified" type="checkbox" class="accent-accent" :disabled="busy" />没有 EXIF 日期时使用文件修改时间
          </label>
          <p v-if="fallbackToFileModified" class="text-[11px] text-warn leading-relaxed">复制、下载或编辑图片都可能改变文件修改时间；预览会明确标出回退项。</p>
        </section>

        <section v-if="plan" class="panel p-4 stack gap-3">
          <p class="eyebrow">确认执行</p>
          <p class="text-[12px] text-fg-2">已选择 <strong>{{ selectedItems.length }}</strong> / {{ plan.moveCount }} 张可移动照片。</p>
          <ul class="stack gap-1 text-[11px] text-fg-3 leading-relaxed">
            <li v-for="warning in plan.warnings" :key="warning" class="row gap-1.5 items-start"><AppIcon name="shield" :size="12" class="mt-0.5 shrink-0" />{{ warning }}</li>
          </ul>
          <button v-if="executing" class="btn-default btn-lg w-full" :disabled="cancelling" @click="cancelExecution">{{ cancelling ? '正在回滚…' : '停止并回滚' }}</button>
          <button v-else class="btn-danger btn-lg w-full" :disabled="!canExecute" @click="executePlan"><AppIcon name="sort" :size="15" />确认移动 {{ selectedItems.length }} 张</button>
        </section>

        <section class="panel p-4 stack gap-3">
          <div class="row-between gap-2"><p class="eyebrow">最近整理</p><button class="btn-ghost btn-sm" :disabled="busy" @click="refreshReceipts"><AppIcon name="refresh" :size="13" />刷新</button></div>
          <p v-if="!receipts.length" class="text-[11px] text-fg-3">暂无可用回滚凭据。</p>
          <ul v-else class="stack gap-2">
            <li v-for="receipt in receipts.slice(0, 5)" :key="receipt.receiptId" class="stack gap-1.5 p-2.5 rounded-sm bg-surface-2">
              <span class="text-[12px] text-fg">{{ receipt.movedCount }} 张 · {{ new Date(receipt.createdAt).toLocaleString('zh-CN') }}</span>
              <span class="text-[10px] text-fg-3 truncate" :title="receipt.destinationRoot">{{ receipt.destinationRoot }}</span>
              <span class="row gap-1.5"><button class="btn-ghost btn-sm" :disabled="busy" @click="revealDesktopFile(receipt.destinationRoot)">打开目录</button><button class="btn-default btn-sm" :disabled="busy" @click="undoReceipt(receipt)">{{ undoingId === receipt.receiptId ? '正在撤销…' : '撤销整理' }}</button></span>
            </li>
          </ul>
        </section>
      </template>
    </ToolLayout>
  </div>
</template>
