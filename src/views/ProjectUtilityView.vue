<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import { consumeArtifactHandoff } from '@/lib/artifact-handoff'
import { portableJobDetail } from '@/lib/job-privacy'
import { isDesktop, revealDesktopFile } from '@/lib/native'
import {
  compareDesktopFolderSnapshot,
  createDesktopDeliveryPack,
  createDesktopFolderSnapshot,
  deleteDesktopFolderSnapshot,
  listDesktopFolderSnapshots,
  scanDesktopDeliveryPack,
  type DeliveryPackPlan,
  type DeliveryPackReport,
  type FolderSnapshotDiff,
  type FolderSnapshotSummary,
} from '@/lib/project-tools-native'
import { useUiStore } from '@/stores/ui'
import { useWorkbenchStore } from '@/stores/workbench'

const props = defineProps<{ mode: 'delivery-pack' | 'folder-snapshot' }>()
const route = useRoute()
const router = useRouter()
const desktop = isDesktop()
const ui = useUiStore()
const store = useWorkbenchStore()
const sourceRoot = ref('')
const plan = ref<DeliveryPackPlan>()
const report = ref<DeliveryPackReport>()
const snapshots = ref<FolderSnapshotSummary[]>([])
const diff = ref<FolderSnapshotDiff>()
const label = ref('')
const busy = ref(false)
const deletingId = ref('')
const message = ref('')
const handoffNotice = ref('')

const isDelivery = computed(() => props.mode === 'delivery-pack')
const title = computed(() => isDelivery.value ? '项目交付包' : '文件夹时间切片')
const subtitle = computed(() => isDelivery.value
  ? '排除缓存与构建产物，生成 README、文件清单和 SHA-256 校验归档'
  : '手动保存轻量目录清单，比较新增、修改、丢失和异常文件')
const extensionEntries = computed(() => Object.entries(plan.value?.extensionCounts ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 12))

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(2)} GB`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function errorText(error: unknown, fallback: string) {
  const detail = error instanceof Error ? error.message : typeof error === 'string' && error ? error : undefined
  return portableJobDetail(detail, `${fallback.replace(/[。.]$/, '')}；包含本机路径的详情已省略。`) ?? fallback
}

function statusLabel(status: FolderSnapshotDiff['items'][number]['status']) {
  return status === 'added' ? '新增' : status === 'modified' ? '修改' : status === 'missing' ? '丢失' : '异常'
}

function statusClass(status: FolderSnapshotDiff['items'][number]['status']) {
  return status === 'added' ? 'text-success bg-success-soft' : status === 'missing' ? 'text-danger bg-danger-soft' : status === 'anomalous' ? 'text-warn bg-warn-soft' : 'text-accent bg-accent-soft'
}

async function chooseSource() {
  if (!desktop || busy.value) return
  const value = await open({ title: isDelivery.value ? '选择要交付的项目文件夹' : '选择要记录的文件夹', directory: true, multiple: false })
  if (typeof value !== 'string') return
  sourceRoot.value = value
  handoffNotice.value = ''
  plan.value = undefined
  report.value = undefined
  diff.value = undefined
  if (!label.value) label.value = `${basename(value)} · 基线`
}

async function scanDelivery() {
  if (!sourceRoot.value || busy.value) return
  busy.value = true
  message.value = '正在本地读取项目清单并计算 SHA-256；不会修改源目录。'
  try {
    plan.value = await scanDesktopDeliveryPack(sourceRoot.value)
    report.value = undefined
    message.value = `已确认 ${plan.value.fileCount} 个交付文件，排除 ${plan.value.excludedCount} 个缓存或构建条目。`
  } catch (error) {
    message.value = errorText(error, '项目扫描失败。')
    ui.toast('项目扫描失败', message.value, 'error')
  } finally {
    busy.value = false
  }
}

async function createDelivery() {
  if (!plan.value || plan.value.truncated || busy.value) return
  const outputPath = await saveDialog({
    title: '保存项目交付包',
    defaultPath: `${plan.value.projectName}-delivery.zip`,
    filters: [{ name: 'ZIP 归档', extensions: ['zip'] }],
  })
  if (!outputPath) return
  busy.value = true
  const projectName = plan.value.projectName
  const job = store.addJob('archive', '项目交付包', [basename(sourceRoot.value)], {
    toolId: 'project-delivery-pack', route: '/tools?mode=delivery-pack',
    parameters: { fileCount: plan.value.fileCount, excludedCount: plan.value.excludedCount },
  })
  store.updateJob(job.id, { status: 'running', progress: 20, detail: '正在重新校验项目并生成全新 ZIP。' })
  try {
    report.value = await createDesktopDeliveryPack({
      sourceRoot: sourceRoot.value,
      outputPath,
      projectName,
      expectedFingerprint: plan.value.fingerprint,
    })
    store.updateJob(job.id, {
      status: 'succeeded', progress: 100, outputNames: [report.value.archiveName],
      detail: `生成 ${report.value.archiveName}，包含 ${report.value.fileCount} 个文件；源目录未修改。`,
    })
    message.value = `交付包已生成：${report.value.archiveName}`
    ui.toast('交付包已生成', 'README、文件清单与 SHA-256 校验表均已写入。', 'success')
  } catch (error) {
    message.value = errorText(error, '交付包生成失败。')
    store.updateJob(job.id, { status: 'failed', progress: 100, errorCode: 'DELIVERY_PACK_FAILED', detail: message.value })
    ui.toast('交付包生成失败', message.value, 'error')
  } finally {
    busy.value = false
  }
}

async function refreshSnapshots() {
  if (!desktop) return
  try {
    snapshots.value = await listDesktopFolderSnapshots()
  } catch (error) {
    message.value = errorText(error, '无法读取时间切片。')
  }
}

async function createSnapshot() {
  if (!sourceRoot.value || !label.value.trim() || busy.value) return
  busy.value = true
  const rootName = basename(sourceRoot.value)
  const job = store.addJob('archive', '文件夹时间切片', [rootName], {
    toolId: 'folder-snapshot', route: '/tools?mode=folder-snapshot', parameters: { label: label.value.trim() },
  })
  store.updateJob(job.id, { status: 'running', progress: 25, detail: '正在生成轻量清单；不会复制文件。' })
  try {
    const snapshot = await createDesktopFolderSnapshot(sourceRoot.value, label.value.trim())
    store.updateJob(job.id, {
      status: 'succeeded', progress: 100,
      detail: `已记录 ${snapshot.fileCount} 个文件的轻量清单；未复制源文件。`,
    })
    message.value = `已保存“${snapshot.label}”，记录 ${snapshot.fileCount} 个文件。`
    await refreshSnapshots()
    ui.toast('时间切片已保存', '只保存路径、大小、时间与哈希清单，没有复制文件。', 'success')
  } catch (error) {
    message.value = errorText(error, '时间切片保存失败。')
    store.updateJob(job.id, { status: 'failed', progress: 100, errorCode: 'FOLDER_SNAPSHOT_FAILED', detail: message.value })
    ui.toast('时间切片保存失败', message.value, 'error')
  } finally {
    busy.value = false
  }
}

async function compareSnapshot(snapshot: FolderSnapshotSummary) {
  if (busy.value) return
  busy.value = true
  diff.value = undefined
  message.value = `正在将“${snapshot.label}”与当前文件夹比较。`
  try {
    diff.value = await compareDesktopFolderSnapshot(snapshot.snapshotId)
    message.value = `比较完成：新增 ${diff.value.addedCount}，修改 ${diff.value.modifiedCount}，丢失 ${diff.value.missingCount}，异常 ${diff.value.anomalousCount}。`
  } catch (error) {
    message.value = errorText(error, '时间切片比较失败。')
    ui.toast('比较失败', message.value, 'error')
  } finally {
    busy.value = false
  }
}

async function removeSnapshot(snapshot: FolderSnapshotSummary) {
  if (busy.value || !window.confirm(`删除时间切片“${snapshot.label}”？这只删除清单，不会删除文件夹中的文件。`)) return
  deletingId.value = snapshot.snapshotId
  try {
    await deleteDesktopFolderSnapshot(snapshot.snapshotId)
    if (diff.value?.snapshotId === snapshot.snapshotId) diff.value = undefined
    await refreshSnapshots()
  } catch (error) {
    ui.toast('删除失败', errorText(error, '无法删除时间切片。'), 'error')
  } finally {
    deletingId.value = ''
  }
}

watch(() => props.mode, () => {
  sourceRoot.value = ''
  plan.value = undefined
  report.value = undefined
  diff.value = undefined
  message.value = ''
  handoffNotice.value = ''
  if (!isDelivery.value) void refreshSnapshots()
})

watch([() => route.query.handoff, isDelivery], ([value, delivery]) => {
  if (typeof value !== 'string' || !delivery) return
  const payload = consumeArtifactHandoff(value)
  const query = { ...route.query }
  delete query.handoff
  void router.replace({ path: route.path, query, hash: route.hash })
  if (!payload || payload.kind !== 'directory') {
    ui.toast('交接已失效', '一次性交接可能已使用、过期或因页面刷新被清除。', 'warning')
    return
  }
  sourceRoot.value = payload.path
  plan.value = undefined
  report.value = undefined
  handoffNotice.value = payload.name
  message.value = '已接收流水线输出目录。点击扫描后会先展示整个目录的交付清单，不会直接生成 ZIP。'
}, { immediate: true })

onMounted(() => {
  if (!isDelivery.value) void refreshSnapshots()
})
</script>

<template>
  <div class="page-enter page-shell px-8 py-6">
    <PageHeader :title="title" :subtitle="subtitle">
      <template v-if="isDelivery" #lead>
        <button class="btn-ghost btn-sm" @click="router.push({ path: '/tools', query: { mode: 'file-pipeline' } })"><AppIcon name="chevron-left" :size="14" />返回文件流水线</button>
      </template>
      <template #actions>
        <span class="row gap-1.5 h-9 px-3 rounded-sm bg-success-soft text-success text-[12px]">
          <AppIcon name="shield" :size="14" />本地处理 · 不覆盖
        </span>
      </template>
    </PageHeader>

    <div v-if="!desktop" class="panel p-6 mt-5 stack gap-2">
      <h2 class="text-[15px] font-semibold text-fg">需要 Windows 桌面端</h2>
      <p class="text-[13px] text-fg-2">浏览器无法安全访问完整文件夹。请在 Knitspace 桌面端使用此工具。</p>
    </div>

    <div v-else class="grid grid-cols-[minmax(0,1fr)_320px] gap-5 mt-5 items-start">
      <main class="stack gap-4 min-w-0">
        <section v-if="isDelivery && handoffNotice" class="panel p-4 stack gap-3 border-accent/35 bg-accent-soft">
          <div class="row-between gap-4 flex-wrap">
            <span class="stack gap-1"><span class="row gap-2 text-[13px] font-medium text-accent"><AppIcon name="task" :size="15" />已接收“{{ handoffNotice }}”输出目录</span><small class="text-[11px] text-fg-3">一次性交接已消费；目录路径只用于当前页面，不进入任务历史或备份。</small></span>
            <button class="btn-primary btn-sm" :disabled="busy || !sourceRoot" @click="scanDelivery">扫描并预览</button>
          </div>
          <div class="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 text-[11px]">
            <span class="rounded-sm bg-success-soft text-success px-2.5 py-2 text-center">智能整理</span><span class="text-fg-3">→</span><span class="rounded-sm bg-success-soft text-success px-2.5 py-2 text-center">文件流水线</span><span class="text-fg-3">→</span><span class="rounded-sm bg-surface-1 text-accent px-2.5 py-2 text-center">交付包预览</span>
          </div>
        </section>

        <section class="panel p-5 stack gap-4">
          <div class="row-between gap-4">
            <div class="stack gap-1 min-w-0">
              <h2 class="text-[14px] font-semibold text-fg">{{ isDelivery ? '1. 选择项目目录' : '创建手动时间切片' }}</h2>
              <p class="text-[12px] text-fg-3">{{ isDelivery ? '扫描只读；输出为新 ZIP，源目录保持不变。' : '不设定时器、不后台监控，只在点击时记录一次。' }}</p>
            </div>
            <button class="btn-default btn-sm shrink-0" :disabled="busy" @click="chooseSource">
              <AppIcon name="folder" :size="14" />选择文件夹
            </button>
          </div>
          <div class="rounded-sm bg-surface-2 px-3 py-2.5 text-[12px] text-fg-2 truncate" :title="sourceRoot">
            {{ sourceRoot || '尚未选择本地文件夹' }}
          </div>
          <div v-if="!isDelivery" class="row gap-3">
            <input v-model="label" class="field flex-1" maxlength="120" placeholder="例如：课程作业 · 提交前" />
            <button class="btn-primary" :disabled="busy || !sourceRoot || !label.trim()" @click="createSnapshot">
              {{ busy ? '正在记录…' : '保存切片' }}
            </button>
          </div>
          <button v-else class="btn-primary self-start" :disabled="busy || !sourceRoot" @click="scanDelivery">
            {{ busy ? '正在本地扫描…' : plan ? '重新扫描' : '扫描并预览交付内容' }}
          </button>
        </section>

        <template v-if="isDelivery && plan">
          <section class="panel p-5 stack gap-4">
            <div class="row-between gap-4">
              <div>
                <h2 class="text-[14px] font-semibold text-fg">2. 核对交付清单</h2>
                <p class="text-[12px] text-fg-3 mt-1">生成前会再次校验指纹；项目有变化时必须重新扫描。</p>
              </div>
              <span class="text-[12px] text-fg-2 tabular-nums">{{ plan.fileCount }} 文件 · {{ formatBytes(plan.totalBytes) }}</span>
            </div>
            <div class="grid grid-cols-3 gap-3">
              <div class="rounded-sm bg-surface-2 p-3"><p class="text-[11px] text-fg-3">交付文件</p><p class="text-[18px] font-semibold tabular-nums">{{ plan.fileCount }}</p></div>
              <div class="rounded-sm bg-surface-2 p-3"><p class="text-[11px] text-fg-3">排除条目</p><p class="text-[18px] font-semibold tabular-nums">{{ plan.excludedCount }}</p></div>
              <div class="rounded-sm bg-surface-2 p-3"><p class="text-[11px] text-fg-3">跳过链接</p><p class="text-[18px] font-semibold tabular-nums">{{ plan.skippedLinkCount }}</p></div>
            </div>
            <div v-if="extensionEntries.length" class="row flex-wrap gap-2">
              <span v-for="[extension, count] in extensionEntries" :key="extension" class="tag text-[11px]">{{ extension }} · {{ count }}</span>
            </div>
            <div class="max-h-[360px] overflow-auto rounded-sm border border-line divide-y divide-line">
              <div v-for="file in plan.files" :key="file.relativePath" class="row-between gap-4 px-3 py-2 text-[12px]">
                <span class="truncate text-fg-2" :title="file.relativePath">{{ file.relativePath }}</span>
                <span class="shrink-0 text-fg-3 tabular-nums">{{ formatBytes(file.size) }}</span>
              </div>
            </div>
            <p v-if="plan.previewTruncated" class="text-[11px] text-fg-3">界面只展示前 {{ plan.files.length }} 项；ZIP 与清单仍包含全部已核对文件。</p>
            <div v-for="warning in plan.warnings" :key="warning" class="rounded-sm bg-warn-soft px-3 py-2 text-[12px] text-warn">{{ warning }}</div>
          </section>
        </template>

        <template v-if="!isDelivery">
          <section class="panel p-5 stack gap-3">
            <div class="row-between">
              <div><h2 class="text-[14px] font-semibold text-fg">已保存的时间切片</h2><p class="text-[12px] text-fg-3 mt-1">最多保留 100 份本机清单。</p></div>
              <button class="btn-ghost btn-sm" :disabled="busy" @click="refreshSnapshots"><AppIcon name="refresh" :size="14" />刷新</button>
            </div>
            <p v-if="!snapshots.length" class="rounded-sm bg-surface-2 p-4 text-[12px] text-fg-3">尚未保存时间切片。</p>
            <div v-for="snapshot in snapshots" :key="snapshot.snapshotId" class="rounded-sm border border-line p-3 row-between gap-4">
              <div class="min-w-0">
                <p class="text-[13px] font-medium text-fg truncate">{{ snapshot.label }}</p>
                <p class="text-[11px] text-fg-3 mt-1">{{ snapshot.rootName }} · {{ snapshot.fileCount }} 文件 · {{ formatBytes(snapshot.totalBytes) }} · {{ formatDate(snapshot.createdAt) }}</p>
              </div>
              <div class="row gap-2 shrink-0">
                <button class="btn-default btn-sm" :disabled="busy" @click="compareSnapshot(snapshot)">与当前比较</button>
                <button class="btn-ghost btn-sm text-danger" :disabled="deletingId === snapshot.snapshotId" @click="removeSnapshot(snapshot)">删除</button>
              </div>
            </div>
          </section>

          <section v-if="diff" class="panel p-5 stack gap-4">
            <div>
              <h2 class="text-[14px] font-semibold text-fg">差异 · {{ diff.label }}</h2>
              <p class="text-[12px] text-fg-3 mt-1">相同 {{ diff.unchangedCount }} · 新增 {{ diff.addedCount }} · 修改 {{ diff.modifiedCount }} · 丢失 {{ diff.missingCount }} · 异常 {{ diff.anomalousCount }}</p>
            </div>
            <div class="max-h-[420px] overflow-auto rounded-sm border border-line divide-y divide-line">
              <div v-for="item in diff.items" :key="`${item.status}:${item.relativePath}`" class="row gap-3 px-3 py-2.5 text-[12px]">
                <span class="rounded-xs px-1.5 py-0.5 text-[10px] shrink-0" :class="statusClass(item.status)">{{ statusLabel(item.status) }}</span>
                <span class="text-fg-2 truncate" :title="item.relativePath">{{ item.relativePath }}</span>
              </div>
            </div>
            <p v-if="diff.truncated" class="text-[11px] text-fg-3">差异项超过显示上限，统计数字仍为完整结果。</p>
          </section>
        </template>
      </main>

      <aside class="stack gap-4 sticky top-5">
        <section v-if="isDelivery" class="panel p-4 stack gap-3">
          <h2 class="text-[13px] font-semibold text-fg">3. 生成全新归档</h2>
          <p class="text-[12px] text-fg-3 leading-relaxed">包含 README.md、FILE-MANIFEST.json 与 SHA256SUMS.txt。不会覆盖已有输出。</p>
          <button class="btn-primary w-full" :disabled="busy || !plan || plan.truncated" @click="createDelivery">
            {{ busy && plan ? '正在生成…' : '选择位置并生成 ZIP' }}
          </button>
          <button v-if="report" class="btn-default w-full" @click="revealDesktopFile(report.outputPath)">
            <AppIcon name="folder" :size="14" />在文件夹中显示
          </button>
          <div v-if="report" class="rounded-sm bg-success-soft p-3 text-[12px] text-success">
            {{ report.archiveName }} · {{ formatBytes(report.archiveSize) }}
          </div>
        </section>
        <section class="panel p-4 stack gap-2">
          <h2 class="text-[13px] font-semibold text-fg">安全边界</h2>
          <p class="text-[12px] text-fg-3 leading-relaxed" v-if="isDelivery">符号链接不会跟随；输出必须位于项目目录之外；生成前重新核对大小、时间和哈希。</p>
          <p class="text-[12px] text-fg-3 leading-relaxed" v-else>切片清单仅保存在本机应用配置目录，不进入 Vault 备份；删除切片不会删除真实文件。</p>
        </section>
        <p v-if="message" class="panel px-4 py-3 text-[12px] text-fg-2 leading-relaxed" aria-live="polite">{{ message }}</p>
      </aside>
    </div>
  </div>
</template>
