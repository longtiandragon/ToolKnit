<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import FileDropZone from '@/components/FileDropZone.vue'
import OutputList from '@/components/OutputList.vue'
import PageHeader from '@/components/PageHeader.vue'
import ProgressTrack from '@/components/ProgressTrack.vue'
import ToolLayout from '@/components/ToolLayout.vue'
import { consumeArtifactHandoff, createDirectoryArtifactHandoff } from '@/lib/artifact-handoff'
import { removeAutomationRecipe, savePipelineRecipe, touchPipelineRecipe } from '@/lib/automation-recipes'
import { ArtifactRuntimeRegistry, createFilePipelineAdapters } from '@/lib/file-pipeline-adapters'
import {
  artifactRecipeMatches,
  artifactRecipeSteps,
  artifactStepsForRecipe,
  repeatedArtifactPipelineRuns,
  restoreArtifactPipelineParameters,
  serializeArtifactPipelineSteps,
} from '@/lib/file-pipeline-workflow'
import { newId } from '@/lib/id'
import { portableJobDetail } from '@/lib/job-privacy'
import { isDesktop } from '@/lib/native'
import { chooseOutputDirectory } from '@/lib/output'
import {
  ArtifactPipelineCancelledError,
  type ArtifactPipelineStep,
  getToolDefinition,
  listToolDefinitions,
  runArtifactPipeline,
} from '@/lib/tool-platform'
import { useUiStore } from '@/stores/ui'
import { useWorkbenchStore } from '@/stores/workbench'
import type { ArtifactKind, ArtifactPipelineStepLog, ArtifactRef, FileReference, ToolPipelineRecipe } from '@/types'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const store = useWorkbenchStore()
const files = ref<File[]>([])
const handoffArtifacts = ref<ArtifactRef[]>([])
const handoffSource = ref('')
const steps = ref<ArtifactPipelineStep[]>([{ id: 'file-step-1', toolId: 'image.clean-metadata', onError: 'stop' }])
const selectedTool = ref('image.compress')
const concurrency = ref(2)
const running = ref(false)
const cancelling = ref(false)
const progress = ref(0)
const outputs = ref<FileReference[]>([])
const logs = ref<ArtifactPipelineStepLog[]>([])
const message = ref('选择多份文件，把本地图片、PDF、归档与媒体操作串成一条有界流水线。')
const recipeTitle = ref('')
const activeRecipeId = ref<string>()
let activeController: AbortController | undefined
let registry = new ArtifactRuntimeRegistry()

const definitions = listToolDefinitions().filter(definition => !definition.accepts.includes('text') || definition.accepts.length > 1)
const artifactRecipes = computed(() => store.pipelineRecipes.filter(recipe => recipe.scope === 'artifact'))
const inputRows = computed(() => [
  ...handoffArtifacts.value.map(artifact => ({ key: `handoff:${artifact.id}`, name: artifact.name, kind: artifact.kind, size: artifact.size ?? 0, mime: artifact.mime || '未知 MIME', source: '智能整理' })),
  ...files.value.map(file => ({ key: fileRowKey(file), name: file.name, kind: fileKind(file), size: file.size, mime: file.type || '未知 MIME', source: '手动选择' })),
])
const inputCount = computed(() => inputRows.value.length)
const selectedKinds = computed(() => [...new Set(inputRows.value.map(item => item.kind))])
const compatibleDefinitions = computed(() => definitions.filter(definition => !selectedKinds.value.length || selectedKinds.value.some(kind => definition.accepts.includes(kind))))
const canRun = computed(() => isDesktop() && inputCount.value > 0 && inputCount.value <= 100 && steps.value.length > 0 && !running.value)
const totalBytes = computed(() => inputRows.value.reduce((sum, item) => sum + item.size, 0))
const matchingRecipe = computed(() => artifactRecipes.value.find(recipe => artifactRecipeMatches(recipe, steps.value)))
const repeatedRunCount = computed(() => repeatedArtifactPipelineRuns(store.jobs, steps.value))

function fileKind(file: File): ArtifactKind {
  const name = file.name.toLocaleLowerCase('en-US')
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (file.type.startsWith('audio/') || file.type.startsWith('video/')) return 'media'
  if (/\.(zip|7z|rar|tar|tgz|gz)$/.test(name)) return 'archive'
  return 'files'
}

function fileRowKey(file: File) {
  return `file:${file.name}:${file.size}:${file.lastModified}`
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function definition(step: ArtifactPipelineStep) {
  return getToolDefinition(step.toolId)
}

function resetResults() {
  outputs.value = []
  logs.value = []
  progress.value = 0
}

function inputsChanged() {
  resetResults()
  const firstKind = selectedKinds.value[0]
  if (!firstKind) return
  const suggestion = definitions.find(item => item.accepts.includes(firstKind))
  if (suggestion && steps.value.length === 1 && !definition(steps.value[0])?.accepts.includes(firstKind)) {
    steps.value = [{ id: 'file-step-1', toolId: suggestion.id, onError: 'stop' }]
    selectedTool.value = suggestion.id
  }
}

watch(files, inputsChanged)
watch(handoffArtifacts, inputsChanged)

function clearRouteQuery(name: 'handoff' | 'replay') {
  const query = { ...route.query }
  delete query[name]
  void router.replace({ path: route.path, query, hash: route.hash })
}

watch(() => route.query.handoff, value => {
  if (typeof value !== 'string') return
  const payload = consumeArtifactHandoff(value)
  clearRouteQuery('handoff')
  if (!payload || payload.kind !== 'files') {
    ui.toast('交接已失效', '一次性交接可能已使用、过期或因页面刷新被清除。', 'warning')
    return
  }
  handoffArtifacts.value = payload.artifacts
  handoffSource.value = payload.source === 'smart-organizer' ? 'AI 智能文件收件箱' : '上一条文件流水线'
  message.value = `已接收 ${payload.artifacts.length} 个本机文件引用；路径只保留在本次页面会话中。`
}, { immediate: true })

watch(() => route.query.replay, value => {
  if (typeof value !== 'string') return
  const job = store.jobs.find(item => item.id === value && item.toolId === 'pipeline:artifacts')
  const restored = job ? restoreArtifactPipelineParameters(job.parameters) : undefined
  clearRouteQuery('replay')
  if (!restored) {
    ui.toast('无法恢复流水线', '这条历史没有可恢复的文件流水线参数。', 'warning')
    return
  }
  steps.value = restored.steps
  concurrency.value = restored.concurrency
  activeRecipeId.value = undefined
  recipeTitle.value = `上次配置 · ${job?.label ?? '文件流水线'}`
  resetResults()
  message.value = '已恢复上次的步骤、参数和并发设置。为保护隐私，请重新选择输入文件。'
}, { immediate: true })

function addStep() {
  if (steps.value.length >= 12 || !getToolDefinition(selectedTool.value)) return
  steps.value.push({ id: `file-step-${steps.value.length + 1}-${newId()}`, toolId: selectedTool.value, onError: 'stop' })
  resetResults()
}

function removeStep(index: number) {
  if (steps.value.length <= 1) return
  steps.value.splice(index, 1)
  resetResults()
}

function moveStep(index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= steps.value.length) return
  const next = [...steps.value]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  steps.value = next
  resetResults()
}

function clearHandoff() {
  handoffArtifacts.value = []
  handoffSource.value = ''
  message.value = '一次性交接已从当前页面清除。'
}

function removeInput(key: string) {
  if (key.startsWith('handoff:')) {
    const id = key.slice('handoff:'.length)
    handoffArtifacts.value = handoffArtifacts.value.filter(artifact => artifact.id !== id)
    if (!handoffArtifacts.value.length) handoffSource.value = ''
  } else {
    files.value = files.value.filter(file => fileRowKey(file) !== key)
  }
}

function loadRecipe(recipe: ToolPipelineRecipe) {
  const restored = artifactRecipeSteps(recipe)
  if (!restored) {
    ui.toast('配方不可用', '配方包含未知或不兼容的文件工具。', 'error')
    return
  }
  steps.value = restored
  recipeTitle.value = recipe.title
  activeRecipeId.value = recipe.id
  resetResults()
  message.value = `已载入文件配方“${recipe.title}”；请选择输入后运行。`
}

watch(() => route.query.recipe, value => {
  if (typeof value !== 'string' || value === activeRecipeId.value) return
  const recipe = artifactRecipes.value.find(item => item.id === value)
  if (recipe) loadRecipe(recipe)
  else ui.toast('文件配方不存在', '它可能已被删除，或尚未完成本地资料库迁移。', 'warning')
}, { immediate: true })

async function saveCurrentRecipe() {
  const fallback = steps.value.map(step => definition(step)?.title ?? step.toolId).join(' → ')
  try {
    const recipe = await savePipelineRecipe(store, {
      id: activeRecipeId.value,
      title: recipeTitle.value.trim() || fallback || '文件流水线',
      version: 1,
      scope: 'artifact',
      steps: artifactStepsForRecipe(steps.value),
    })
    recipeTitle.value = recipe.title
    activeRecipeId.value = recipe.id
    message.value = `已保存配方“${recipe.title}”；仅包含步骤、参数与失败策略。`
    ui.toast('文件流水线配方已保存', recipe.title, 'success')
  } catch (error) {
    ui.toast('配方未保存', error instanceof Error ? error.message : '无法写入自动化配方库。', 'error')
  }
}

async function removeRecipe(recipe: ToolPipelineRecipe) {
  try {
    await removeAutomationRecipe(store, recipe.id)
    if (activeRecipeId.value === recipe.id) activeRecipeId.value = undefined
    ui.toast('已删除文件配方', recipe.title, 'success')
  } catch (error) {
    ui.toast('配方未删除', error instanceof Error ? error.message : '无法更新自动化配方库。', 'error')
  }
}

function continueToDeliveryPack() {
  if (!store.settings.outputDirectory || !outputs.value.length) return
  try {
    const directory = store.settings.outputDirectory
    const ticket = createDirectoryArtifactHandoff(directory, directory.split(/[\\/]/).filter(Boolean).at(-1) ?? '流水线输出')
    void router.push({ path: '/tools', query: { mode: 'delivery-pack', handoff: ticket.id } })
  } catch (error) {
    ui.toast('无法继续到交付包', error instanceof Error ? error.message : '输出目录交接失败。', 'error')
  }
}

async function pickOutputDirectory() {
  const directory = await chooseOutputDirectory()
  if (!directory) return
  store.updateSettings({ outputDirectory: directory })
}

function stepParameters(step: ArtifactPipelineStep) {
  step.parameters ??= {}
  return step.parameters
}

function jobParameters(stepLogs: readonly ArtifactPipelineStepLog[] = logs.value) {
  return {
    concurrency: concurrency.value,
    stepConfigs: serializeArtifactPipelineSteps(steps.value),
    stepLogs: stepLogs.map(value => JSON.stringify(value)).slice(0, 12),
  }
}

async function run() {
  if (!canRun.value) return
  if (!store.settings.outputDirectory) {
    const directory = await chooseOutputDirectory()
    if (!directory) return
    store.updateSettings({ outputDirectory: directory })
  }
  if (inputCount.value > 100) {
    ui.toast('输入过多', '文件流水线界面一次最多处理 100 个文件。', 'warning')
    return
  }
  if (totalBytes.value > 1024 * 1024 * 1024) {
    ui.toast('输入过大', '文件流水线界面一次最多处理 1 GB。', 'warning')
    return
  }
  registry.clear()
  registry = new ArtifactRuntimeRegistry()
  const inputArtifacts = [
    ...handoffArtifacts.value.map(artifact => ({
      ...artifact,
      ...(artifact.locator ? { locator: { ...artifact.locator } } : {}),
      ...(artifact.metadata ? { metadata: { ...artifact.metadata } } : {}),
    })),
    ...files.value.map(file => registry.registerFile(file)),
  ]
  activeController = new AbortController()
  running.value = true
  cancelling.value = false
  resetResults()
  progress.value = 5
  const jobKind = selectedKinds.value.every(kind => kind === 'image') ? 'image' : selectedKinds.value.every(kind => kind === 'pdf') ? 'pdf' : 'archive'
  const job = store.addJob(jobKind, `文件流水线 · ${steps.value.length} 步`, inputRows.value.map(item => item.name), {
    toolId: 'pipeline:artifacts',
    route: '/tools?mode=file-pipeline',
    parameters: jobParameters([]),
    inputs: inputRows.value.map(item => ({ name: item.name, size: item.size, mime: item.mime === '未知 MIME' ? undefined : item.mime })),
    retryable: true,
  })
  store.updateJob(job.id, { status: 'running', progress: 5, detail: '正在校验 ArtifactRef 与步骤权限。' })
  try {
    const result = await runArtifactPipeline(inputArtifacts, steps.value, {
      adapters: createFilePipelineAdapters(registry, () => store.settings.outputDirectory),
      concurrency: concurrency.value,
      signal: activeController.signal,
      onProgress(value) {
        progress.value = Math.max(progress.value, Math.round(8 + 78 * (value.stepIndex + value.completedInputs / Math.max(1, value.inputCount)) / value.stepCount))
        message.value = `第 ${value.stepIndex + 1}/${value.stepCount} 步：${value.definition.title} · ${value.completedInputs}/${value.inputCount}`
        store.updateJob(job.id, { status: 'running', progress: progress.value, detail: message.value })
      },
      onStepLog(log) {
        logs.value = [...logs.value, log]
        store.updateJob(job.id, { parameters: jobParameters() })
      },
    })
    progress.value = 90
    message.value = '正在逐项写出最终结果；每个输出都是新文件。'
    const saved: FileReference[] = []
    for (const artifact of result.artifacts) saved.push(await registry.exportFinal(artifact, store.settings.outputDirectory))
    outputs.value = saved
    store.updateJob(job.id, {
      status: 'succeeded', progress: 100,
      outputNames: saved.map(item => item.name),
      outputs: saved.map(item => ({ name: item.name, size: item.size, mime: item.mime })),
      parameters: jobParameters(result.logs),
      detail: `完成 ${result.logs.length} 步，生成 ${saved.length} 个新输出；原件未修改。`,
    })
    if (activeRecipeId.value) void touchPipelineRecipe(store, activeRecipeId.value)
    message.value = `流水线完成：${result.logs.length} 步，生成 ${saved.length} 个新输出。`
    ui.toast('文件流水线完成', `${saved.length} 个新输出，原件未修改。`, 'success')
  } catch (error) {
    const cancelled = error instanceof ArtifactPipelineCancelledError || activeController.signal.aborted
    const detail = portableJobDetail(error instanceof Error ? error.message : undefined, '文件流水线执行失败；包含本机路径的详情已省略。') ?? '文件流水线执行失败。'
    const errorLogs = 'logs' in (error as object) ? (error as { logs?: ArtifactPipelineStepLog[] }).logs ?? logs.value : logs.value
    logs.value = errorLogs
    store.updateJob(job.id, {
      status: cancelled ? 'cancelled' : 'failed', progress: 100,
      errorCode: cancelled ? 'TOOL_CANCELLED' : 'ARTIFACT_PIPELINE_FAILED',
      parameters: jobParameters(errorLogs),
      detail,
    })
    message.value = detail
    ui.toast(cancelled ? '文件流水线已停止' : '文件流水线失败', detail, cancelled ? 'warning' : 'error')
  } finally {
    activeController = undefined
    running.value = false
    cancelling.value = false
  }
}

function cancelRun() {
  if (!activeController || cancelling.value) return
  cancelling.value = true
  message.value = '正在取消当前步骤；已完成的新输出会保留。'
  activeController.abort()
}

function removeOutput(item: FileReference) {
  outputs.value = outputs.value.filter(value => value !== item)
}

onBeforeUnmount(() => {
  activeController?.abort()
  registry.clear()
})
</script>

<template>
  <div class="page-enter page-shell px-8 py-6">
    <PageHeader title="文件流水线" subtitle="多文件输入、默认并发 2、逐步取消与持久化步骤日志；每一步都生成新输出，不覆盖原件。">
      <template #lead><button class="btn-ghost btn-sm" @click="router.push({ path: '/c/organize' })"><AppIcon name="chevron-left" :size="14" />返回整理工作台</button></template>
      <template #actions><span class="row gap-1.5 h-9 px-3 rounded-sm bg-surface-2 text-[12px] text-fg-3"><AppIcon name="task" :size="14" />ArtifactRef · {{ inputCount }} 项 · {{ formatBytes(totalBytes) }}</span></template>
    </PageHeader>

    <ToolLayout>
      <OutputList v-if="outputs.length" :outputs="outputs" @remove="removeOutput" />
      <ProgressTrack v-if="running" label="文件流水线" :value="progress" :detail="message" :done="outputs.map(item => item.name)" :stopping="cancelling" @cancel="cancelRun" />

      <section v-if="handoffSource && !running" class="panel p-4 row-between gap-4 flex-wrap border-accent/35 bg-accent-soft">
        <span class="stack gap-1 min-w-0"><span class="row gap-2 text-[12px] font-medium text-accent"><AppIcon name="inbox" :size="15" />已从{{ handoffSource }}接收 {{ handoffArtifacts.length }} 项</span><small class="text-[11px] text-fg-3">这是单次、内存内的文件引用；不会写入 Pinia、任务历史或备份。</small></span>
        <button class="btn-ghost btn-sm shrink-0" @click="clearHandoff">清除交接</button>
      </section>

      <section v-if="outputs.length && !running" class="panel p-4 stack gap-3 overflow-hidden">
        <div class="row-between gap-4 flex-wrap">
          <div class="stack gap-1"><p class="eyebrow">继续工作流</p><strong class="text-[13px]">整理收件箱 → 文件流水线 → 项目交付包</strong></div>
          <button class="btn-primary btn-sm" @click="continueToDeliveryPack"><AppIcon name="archive" :size="14" />用输出目录制作交付包</button>
        </div>
        <div class="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 text-[11px]">
          <span class="rounded-sm bg-success-soft text-success px-2.5 py-2 text-center">智能整理</span><span class="text-fg-3">→</span><span class="rounded-sm bg-success-soft text-success px-2.5 py-2 text-center">文件流水线</span><span class="text-fg-3">→</span><span class="rounded-sm bg-surface-2 text-fg-2 px-2.5 py-2 text-center">交付包预览</span>
        </div>
        <p class="text-[10px] text-fg-3">下一步会只读扫描当前输出目录的全部内容并先给出清单，不会直接生成归档。</p>
      </section>

      <FileDropZone v-if="!running && inputCount < 100" v-model="files" :multiple="true" accept="image/*,audio/*,video/*,.pdf,.zip,.7z,.tar,.gz" :max-files="100 - handoffArtifacts.length" :max-file-bytes="512 * 1024 * 1024" :max-total-bytes="1024 * 1024 * 1024" title="拖入要批量处理的文件" hint="合计最多 100 项 / 1 GB；文件正文不进入 Pinia，流水线只传 ArtifactRef" @error="ui.toast($event, '', 'error')" />

      <section v-if="inputCount && !running" class="panel overflow-hidden">
        <header class="row-between gap-2 px-3 py-2.5 border-b border-line"><strong class="text-[12px]">输入引用</strong><span class="text-[11px] text-fg-3">{{ selectedKinds.join(' · ') }} · {{ inputCount }} 项</span></header>
        <ul class="grid grid-cols-1 md:grid-cols-2 gap-1 p-2 max-h-56 overflow-y-auto"><li v-for="item in inputRows" :key="item.key" class="row gap-2 px-2.5 py-2 rounded-sm bg-surface-2"><span class="min-w-0 flex-1"><strong class="block text-[11px] truncate">{{ item.name }}</strong><small class="text-[10px] text-fg-3">{{ item.kind }} · {{ item.mime }} · {{ item.source }}</small></span><span class="text-[10px] text-fg-3 shrink-0">{{ formatBytes(item.size) }}</span><button class="center size-6 rounded-sm text-fg-3 hover:bg-danger-soft hover:text-danger" :aria-label="`移除 ${item.name}`" @click="removeInput(item.key)">×</button></li></ul>
      </section>

      <section v-if="logs.length" class="panel p-4 stack gap-2">
        <p class="eyebrow">步骤日志</p>
        <ol class="stack gap-1"><li v-for="(log, index) in logs" :key="`${log.stepId}-${log.completedAt}`" class="row-between gap-3 p-2 rounded-sm bg-surface-2 text-[11px]"><span>{{ index + 1 }}. {{ getToolDefinition(log.toolId)?.title ?? log.toolId }}</span><span class="text-fg-3">{{ log.inputCount }} → {{ log.outputCount }} · 失败 {{ log.failedCount }} · {{ log.status }}</span></li></ol>
      </section>

      <section v-if="!isDesktop()" class="panel p-6 text-center stack gap-2"><AppIcon name="warning" :size="22" class="mx-auto text-warn" /><strong class="text-[13px]">文件流水线需要桌面端</strong><p class="text-[11px] text-fg-3">图片/PDF 步骤使用本地 Worker；归档与媒体步骤使用受控原生命令。</p></section>

      <template #aside>
        <section class="panel p-4 stack gap-3">
          <div class="row-between"><p class="eyebrow">步骤</p><span class="text-[11px] text-fg-3">{{ steps.length }} / 12</span></div>
          <ol class="stack gap-2">
            <li v-for="(step, index) in steps" :key="step.id" class="p-2.5 rounded-sm bg-surface-2 stack gap-2">
              <div class="row gap-1.5"><span class="center size-5 rounded-full bg-accent-soft text-accent text-[10px]">{{ index + 1 }}</span><strong class="min-w-0 flex-1 truncate text-[11px]">{{ definition(step)?.title ?? step.toolId }}</strong><button class="btn-ghost btn-sm" :disabled="index === 0" @click="moveStep(index, -1)">↑</button><button class="btn-ghost btn-sm" :disabled="index + 1 === steps.length" @click="moveStep(index, 1)">↓</button><button class="btn-ghost btn-sm" :disabled="steps.length === 1" @click="removeStep(index)">×</button></div>
              <small class="text-[10px] leading-relaxed text-fg-3">{{ definition(step)?.description }} · {{ definition(step)?.executionBoundary }} · 并发上限 {{ definition(step)?.maxConcurrency }}</small>
              <div v-if="step.toolId === 'image.compress'" class="grid grid-cols-2 gap-2"><label class="stack gap-1 text-[10px] text-fg-3">最大宽度<input v-model.number="stepParameters(step).maxWidth" class="field text-[11px]" type="number" min="320" max="7680" placeholder="1920" /></label><label class="stack gap-1 text-[10px] text-fg-3">质量<input v-model.number="stepParameters(step).quality" class="field text-[11px]" type="number" min="35" max="100" placeholder="84" /></label></div>
              <label v-if="step.toolId === 'pdf.extract-pages'" class="stack gap-1 text-[10px] text-fg-3">页码范围<input v-model="stepParameters(step).pageRange" class="field text-[11px]" placeholder="1-3,5" /></label>
              <label class="row gap-2 text-[10px] text-fg-3">失败时<select v-model="step.onError" class="field h-7 min-w-0 flex-1 text-[10px]"><option value="stop">停止</option><option value="skip">跳过并保留输入</option><option value="retry">重试 2 次</option></select></label>
            </li>
          </ol>
          <div class="row gap-2"><select v-model="selectedTool" class="field min-w-0 flex-1 text-[11px]"><option v-for="item in (compatibleDefinitions.length ? compatibleDefinitions : definitions)" :key="item.id" :value="item.id">{{ item.title }}</option></select><button class="btn-default btn-sm" :disabled="steps.length >= 12" @click="addStep">添加</button></div>
        </section>

        <section class="panel p-4 stack gap-3">
          <div class="row-between gap-2"><p class="eyebrow">可复用配方</p><span class="text-[11px] text-fg-3">{{ artifactRecipes.length }} 条</span></div>
          <p v-if="repeatedRunCount >= 3 && !matchingRecipe" class="rounded-sm bg-accent-soft px-2.5 py-2 text-[11px] leading-relaxed text-accent">这套步骤在 30 天内已完成 {{ repeatedRunCount }} 次，建议保存为配方。</p>
          <input v-model="recipeTitle" class="field text-[11px]" maxlength="120" placeholder="例如：交付前清理图片" />
          <button class="btn-default btn-sm w-full" :disabled="running || !steps.length" @click="saveCurrentRecipe">{{ activeRecipeId ? '更新当前配方' : '保存当前步骤' }}</button>
          <p class="text-[10px] leading-relaxed text-fg-3">只保存工具、参数和失败策略；不保存文件名、正文或路径。</p>
          <div v-if="artifactRecipes.length" class="stack gap-1 border-t border-line pt-3">
            <div v-for="recipe in artifactRecipes.slice(0, 6)" :key="recipe.id" class="row gap-2">
              <button class="min-w-0 flex-1 truncate text-left text-[11px] text-fg-2 hover:text-accent" :title="recipe.title" @click="loadRecipe(recipe)">{{ recipe.title }}</button>
              <button class="text-[10px] text-fg-3 hover:text-danger" title="删除配方" @click="removeRecipe(recipe)">删除</button>
            </div>
          </div>
        </section>

        <section class="panel p-4 stack gap-3">
          <p class="eyebrow">执行边界</p>
          <label class="stack gap-1 text-[11px] text-fg-3">并发（默认 2，最高 4）<select v-model.number="concurrency" class="field"><option :value="1">1</option><option :value="2">2</option><option :value="3">3</option><option :value="4">4</option></select></label>
          <button class="row-between gap-2 w-full text-left border-t border-line pt-3" @click="pickOutputDirectory"><span class="stack gap-0.5 min-w-0"><span class="text-[11px] font-medium">输出目录</span><small class="text-[10px] text-fg-3 truncate" :title="store.settings.outputDirectory">{{ store.settings.outputDirectory || '点击选择' }}</small></span><AppIcon name="folder" :size="14" /></button>
          <button class="btn-primary btn-lg w-full" :disabled="!canRun" @click="run">运行 {{ inputCount }} 项流水线</button>
          <p class="text-[10px] leading-relaxed text-fg-3" aria-live="polite">{{ message }}</p>
        </section>
      </template>
    </ToolLayout>
  </div>
</template>
