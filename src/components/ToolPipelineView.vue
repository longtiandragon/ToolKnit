<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { FileReference, ToolPipelineRecipe, ToolPipelineStep } from '@/types'
import { cleanOutputName } from '@/lib/file-tools'
import { chooseOutputDirectory, exportOutput } from '@/lib/output'
import { createPipelineStep, getToolDefinition, listToolDefinitions, runTextPipeline, suggestToolDefinitions } from '@/lib/tool-platform'
import { isDesktop } from '@/lib/native'
import { useUiStore } from '@/stores/ui'
import { useWorkbenchStore } from '@/stores/workbench'
import AppIcon from '@/components/AppIcon.vue'
import FileDropZone from '@/components/FileDropZone.vue'
import FieldRow from '@/components/FieldRow.vue'
import PageHeader from '@/components/PageHeader.vue'
import ProgressTrack from '@/components/ProgressTrack.vue'
import OutputList from '@/components/OutputList.vue'
import ToolLayout from '@/components/ToolLayout.vue'

const store = useWorkbenchStore()
const ui = useUiStore()
const route = useRoute()
const files = ref<File[]>([])
const input = ref('')
const steps = ref<ToolPipelineStep[]>([createPipelineStep('text.trim', 0)])
const selectedTool = ref('text.json')
const output = ref<FileReference[]>([])
const running = ref(false)
const progress = ref(0)
const message = ref('把几个熟悉的文本工具串起来，一次处理并保存为可复用配方。')
const recipeTitle = ref('')
const activeRecipeId = ref<string>()
const recipeFormOpen = ref(false)
let readToken = 0

const definitions = listToolDefinitions()
const suggestions = computed(() => suggestToolDefinitions(input.value))
const canRun = computed(() => !running.value && input.value.trim().length > 0 && steps.value.length > 0)
const preview = computed(() => output.value.length ? undefined : input.value.trim().slice(0, 2400))
const inputLabel = computed(() => files.value[0]?.name || '粘贴文本')
const recipeCount = computed(() => store.pipelineRecipes.length)

function cloneSteps(value: readonly ToolPipelineStep[]) {
  return value.map((step) => ({ ...step, ...(step.parameters ? { parameters: { ...step.parameters } } : {}) }))
}

function stepDefinition(step: ToolPipelineStep) {
  return getToolDefinition(step.toolId)
}

function addStep(toolId = selectedTool.value) {
  if (!getToolDefinition(toolId) || steps.value.length >= 12) return
  steps.value.push(createPipelineStep(toolId, steps.value.length))
  message.value = `已加入“${getToolDefinition(toolId)!.title}”，可继续调整顺序。`
}

function removeStep(index: number) {
  if (steps.value.length <= 1) {
    message.value = '流水线至少保留一个步骤。'
    return
  }
  steps.value.splice(index, 1)
  steps.value = steps.value.map((step, stepIndex) => ({ ...step, id: `step-${stepIndex + 1}-${step.toolId.replace(/[^a-zA-Z0-9_-]+/g, '-')}` }))
}

function moveStep(index: number, direction: -1 | 1) {
  const next = index + direction
  if (next < 0 || next >= steps.value.length) return
  const reordered = [...steps.value]
  const [item] = reordered.splice(index, 1)
  reordered.splice(next, 0, item)
  steps.value = reordered
}

function loadRecipe(recipe: ToolPipelineRecipe) {
  steps.value = cloneSteps(recipe.steps)
  recipeTitle.value = recipe.title
  activeRecipeId.value = recipe.id
  output.value = []
  message.value = `已载入配方“${recipe.title}”。输入内容后即可运行。`
}

function saveCurrentRecipe() {
  const fallback = steps.value.map((step) => stepDefinition(step)?.title ?? step.toolId).join(' → ')
  const title = recipeTitle.value.trim() || fallback || '文本流水线'
  const recipe = store.savePipelineRecipe({
    id: activeRecipeId.value,
    title,
    version: 1,
    steps: cloneSteps(steps.value),
  })
  recipeTitle.value = recipe.title
  activeRecipeId.value = recipe.id
  message.value = `已保存配方“${recipe.title}”。只保存工具和参数，不保存文件内容。`
  ui.toast('流水线配方已保存', recipe.title, 'success')
}

function removeRecipe(recipe: ToolPipelineRecipe) {
  store.removePipelineRecipe(recipe.id)
  if (activeRecipeId.value === recipe.id) activeRecipeId.value = undefined
  ui.toast('已删除流水线配方', recipe.title, 'success')
}

async function chooseInputFiles(next: File[]) {
  if (!next[0]) return
  const token = ++readToken
  try {
    const text = await next[0].text()
    if (token !== readToken) return
    input.value = text
    output.value = []
    message.value = `已读取“${next[0].name}”，可以先查看推荐步骤。`
  } catch {
    message.value = `无法读取“${next[0].name}”的文本内容。`
  }
}

watch(files, (next) => { void chooseInputFiles(next) })

function loadStagedInput() {
  const stagedText = store.consumeIntakeText()
  if (stagedText.trim()) input.value = stagedText
  const stagedFiles = store.consumeIntakeFiles()
  if (stagedFiles.length) files.value = stagedFiles.slice(0, 1)
  const recipeId = typeof route.query.recipe === 'string' ? route.query.recipe : undefined
  if (recipeId) {
    const recipe = store.pipelineRecipes.find((item) => item.id === recipeId)
    if (recipe) loadRecipe(recipe)
  }
}

onMounted(loadStagedInput)

async function pickOutputDirectory() {
  const directory = await chooseOutputDirectory()
  if (!directory) return
  store.updateSettings({ outputDirectory: directory })
  ui.toast('默认输出目录已更新', directory, 'success')
}

async function run() {
  if (!canRun.value) {
    message.value = '请先输入文本，并至少保留一个工具步骤。'
    return
  }
  if (isDesktop() && !store.settings.outputDirectory) {
    const directory = await chooseOutputDirectory()
    if (!directory) {
      message.value = '已取消：需要先选择默认输出目录。'
      return
    }
    store.updateSettings({ outputDirectory: directory })
  }
  running.value = true
  progress.value = 8
  output.value = []
  const label = `文本流水线 · ${steps.value.length} 步`
  const inputs: FileReference[] = files.value.length
    ? [{ name: files.value[0].name, size: files.value[0].size, mime: files.value[0].type, path: (files.value[0] as File & { path?: string }).path }]
    : [{ name: '粘贴文本', size: new Blob([input.value]).size, mime: 'text/plain;charset=utf-8' }]
  const job = store.addJob('text', label, [inputLabel.value], {
    toolId: 'pipeline:text',
    route: '/tools?mode=pipeline',
    parameters: { steps: JSON.stringify(steps.value) },
    inputs,
    retryable: true,
  })
  store.updateJob(job.id, { status: 'running', progress: 8, detail: '正在校验流水线和输入内容…' })
  try {
    const result = runTextPipeline(input.value, steps.value, ({ index, total, definition }) => {
      progress.value = Math.max(progress.value, Math.round(12 + ((index + 1) / total) * 72))
      message.value = `正在执行第 ${index + 1}/${total} 步：${definition.title}`
      store.updateJob(job.id, { status: 'running', progress: progress.value, detail: message.value })
    })
    progress.value = 92
    message.value = '正在导出流水线结果…'
    const base = cleanOutputName(files.value[0]?.name || 'knitspace')
    const filename = `${base}-pipeline.${result.extension}`
    const saved = await exportOutput(store.settings.outputDirectory, filename, result.content, `text/${result.extension};charset=utf-8`)
    output.value = [saved]
    store.updateJob(job.id, { status: 'succeeded', progress: 100, outputNames: [saved.name], outputs: [saved], detail: '流水线完成，原始输入未修改。' })
    if (activeRecipeId.value) store.touchPipelineRecipe(activeRecipeId.value)
    message.value = `任务完成：已生成 ${saved.name}。`
    ui.toast('流水线已完成', saved.name, 'success', '查看历史', () => location.hash = '#/history')
  } catch (error) {
    const detail = error instanceof Error ? error.message : '流水线执行失败。'
    store.updateJob(job.id, { status: 'failed', progress: 100, errorCode: 'TOOL_PIPELINE_FAILED', detail })
    message.value = detail
    ui.toast('流水线失败', detail, 'error')
  } finally {
    running.value = false
  }
}

function removeOutput(item: FileReference) {
  output.value = output.value.filter((entry) => entry !== item)
}
</script>

<template>
  <div class="page-enter mx-auto w-full max-w-320 px-8 py-6">
    <PageHeader
      title="文本流水线"
      subtitle="把多个常用文本工具串成一次可复用处理，输入与输出都留在本机。"
      :stats="[
        { label: '当前步骤', value: steps.length, tone: 'accent' },
        { label: '已保存配方', value: recipeCount },
      ]"
    >
      <template #actions>
        <span class="row gap-1.5 h-9 px-3 rounded-sm bg-surface-2 text-fg-3 text-[12px]">
          <AppIcon name="task" :size="14" />{{ inputLabel }}
        </span>
      </template>
      <template #lead>
        <div class="row gap-2 flex-wrap text-[12px] text-fg-3">
          <span class="eyebrow">推荐操作</span>
          <button
            v-for="tool in suggestions"
            :key="tool.id"
            class="btn-default btn-sm"
            :disabled="running"
            @click="addStep(tool.id)"
          >
            {{ tool.title }}
          </button>
        </div>
      </template>
    </PageHeader>

    <ToolLayout aside-width="narrow">
      <OutputList v-if="output.length" :outputs="output" @remove="removeOutput" />

      <ProgressTrack
        v-if="running"
        label="文本流水线"
        :value="progress"
        :detail="message"
        :done="output.map((item) => item.name)"
      />

      <section v-if="!running" class="panel overflow-hidden stack flex-1 min-h-64">
        <header class="row-between gap-2 px-3 h-11 border-b border-line shrink-0">
          <div class="row gap-2 min-w-0">
            <AppIcon name="file-text" :size="16" class="text-fg-3" />
            <strong class="text-[13px] font-medium text-fg">输入内容</strong>
            <span class="text-[11px] text-fg-3 tabular-nums">{{ input.length }} 字符</span>
          </div>
          <span class="text-[11px] text-fg-3">不会覆盖原文件</span>
        </header>
        <textarea
          v-model="input"
          name="pipeline-input"
          class="w-full flex-1 min-h-64 px-3 py-3 border-0 rounded-none bg-transparent text-[13px] font-mono leading-relaxed resize-y focus:outline-none"
          placeholder="粘贴 JSON、Markdown、名单或任意文本…"
          :disabled="running"
        />
      </section>

      <section v-if="!input.trim() && !running" class="stack gap-3">
        <FileDropZone
          v-model="files"
          :multiple="false"
          accept=".txt,.md,.json,.csv,.log,text/*,application/json"
          :max-file-bytes="8 * 1024 * 1024"
          title="或者载入一个文本文件"
          hint="载入后会填入输入区，原文件保持不变"
          @error="ui.toast($event, '', 'error')"
        />
      </section>

      <section v-if="!running && input.trim()" class="panel overflow-hidden" aria-live="polite">
        <header class="row-between gap-2 px-3 h-10 border-b border-line">
          <p class="row gap-1.5 text-[12px] font-medium text-fg-2"><AppIcon name="search" :size="14" />输入预览</p>
          <span class="text-[11px] text-fg-3">{{ input.length > 2400 ? '仅显示前 2400 个字符' : '完整内容将在运行时处理' }}</span>
        </header>
        <pre class="m-0 px-3 py-2.5 max-h-60 overflow-auto text-[12px] font-mono leading-relaxed whitespace-pre-wrap break-words text-fg-2">{{ preview }}</pre>
      </section>

      <template #aside>
        <section class="panel p-4 stack gap-3">
          <div class="row-between gap-2">
            <p class="eyebrow">流水线步骤</p>
            <span class="text-[11px] text-fg-3 tabular-nums">{{ steps.length }} / 12</span>
          </div>
          <ol class="stack gap-1.5">
            <li v-for="(step, index) in steps" :key="step.id" class="stack gap-1 p-2 rounded-sm bg-well border border-line">
              <div class="row gap-2 min-w-0">
                <span class="center w-5 h-5 rounded-full bg-accent-soft text-accent text-[11px] font-semibold shrink-0">{{ index + 1 }}</span>
                <span class="min-w-0 flex-1 truncate text-[12px] font-medium text-fg">{{ stepDefinition(step)?.title ?? step.toolId }}</span>
                <button class="center w-6 h-6 rounded-sm text-fg-3 hover:bg-surface-2 disabled:opacity-40 text-[13px]" :disabled="running || index === 0" title="上移" @click="moveStep(index, -1)">↑</button>
                <button class="center w-6 h-6 rounded-sm text-fg-3 hover:bg-surface-2 disabled:opacity-40 text-[13px]" :disabled="running || index === steps.length - 1" title="下移" @click="moveStep(index, 1)">↓</button>
                <button class="center w-6 h-6 rounded-sm text-fg-3 hover:bg-danger-soft hover:text-danger disabled:opacity-40" :disabled="running || steps.length <= 1" title="移除" @click="removeStep(index)"><AppIcon name="close" :size="13" /></button>
              </div>
              <p class="pl-7 text-[11px] text-fg-3 leading-snug">{{ stepDefinition(step)?.description }}</p>
            </li>
          </ol>
          <div class="row gap-2">
            <select v-model="selectedTool" class="field min-w-0 flex-1" :disabled="running || steps.length >= 12" aria-label="选择要添加的工具">
              <option v-for="tool in definitions" :key="tool.id" :value="tool.id">{{ tool.title }}</option>
            </select>
            <button class="btn-default btn-sm shrink-0" :disabled="running || steps.length >= 12" @click="addStep()">添加</button>
          </div>
          <p class="text-[11px] text-fg-3 leading-snug">步骤按顺序执行；每一步的输出会自动交给下一步。</p>
        </section>

        <section class="panel p-4 stack gap-3">
          <p class="eyebrow">执行</p>
          <button class="btn-primary btn-lg w-full" :disabled="!canRun" @click="run">{{ running ? '正在处理…' : '运行流水线' }}</button>
          <p class="text-[12px] text-fg-3 text-center leading-snug" aria-live="polite">{{ message }}</p>
          <button v-if="isDesktop()" type="button" class="row-between gap-2 w-full border-t border-line pt-3 text-left" :disabled="running" @click="pickOutputDirectory">
            <span class="stack gap-0.5 min-w-0"><span class="text-[12px] font-medium text-fg">输出目录</span><span class="text-[11px] text-fg-3 truncate" :title="store.settings.outputDirectory">{{ store.settings.outputDirectory || '尚未设置，点击选择' }}</span></span>
            <span class="row gap-1 shrink-0 text-[11px] text-fg-3"><AppIcon name="folder" :size="14" />更改</span>
          </button>
        </section>

        <section class="panel p-4 stack gap-3">
          <button class="row-between gap-2 w-full text-left" :aria-expanded="recipeFormOpen" @click="recipeFormOpen = !recipeFormOpen">
            <span class="stack gap-0.5"><span class="text-[13px] font-medium text-fg">保存为配方</span><span class="text-[11px] text-fg-3">下次直接复用这条流水线</span></span>
            <AppIcon name="chevron" :size="16" class="text-fg-3 transition-transform" :class="recipeFormOpen ? 'rotate-180' : ''" />
          </button>
          <template v-if="recipeFormOpen">
            <FieldRow label="配方名称"><input v-model="recipeTitle" class="field w-full" placeholder="例如：清理名单并排序" /></FieldRow>
            <button class="btn-default btn-sm w-full" :disabled="running" @click="saveCurrentRecipe">保存配方</button>
            <p class="text-[11px] text-fg-3 leading-snug">只保存工具和参数，不保存文件内容、路径或输出。</p>
          </template>
          <div v-if="store.pipelineRecipes.length" class="stack gap-1 border-t border-line pt-3">
            <p class="text-[11px] text-fg-3">已保存</p>
            <div v-for="recipe in store.pipelineRecipes.slice(0, 6)" :key="recipe.id" class="row gap-2">
              <button class="min-w-0 flex-1 truncate text-left text-[12px] text-fg-2 hover:text-accent" :title="recipe.title" @click="loadRecipe(recipe)">{{ recipe.title }}</button>
              <button class="text-[11px] text-fg-3 hover:text-danger" title="删除配方" @click="removeRecipe(recipe)">删除</button>
            </div>
          </div>
        </section>
      </template>
    </ToolLayout>
  </div>
</template>
