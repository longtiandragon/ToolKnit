<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowReactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { newId } from '@/lib/id'
import { collectPrivateToolOutputPaths } from '@/lib/private-tool-output'
import { privateToolDisplayText, privateToolFieldErrors, privateToolFieldValue, privateToolManifestTemplate, privateToolReplay, privateToolRouteAction } from '@/lib/private-tool-workflows'
import {
  cancelPrivateToolRun,
  loadPrivateTools,
  runPrivateTool,
  type PrivateToolDefinition,
  type PrivateToolField,
  type PrivateToolOperation,
  type PrivateToolRunResult,
} from '@/lib/private-tools-native'
import { isDesktop, revealDesktopFile } from '@/lib/native'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'

type ContextTarget = 'tool' | 'result'
type ResultView = 'payload' | 'log'

const store = useWorkbenchStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const desktop = isDesktop()

/* Two onboarding lists said almost the same thing — one for "no desktop", one
   for "no manifest". The empty state is the same either way: this is what the
   three steps are. */
const onboardingSteps = [
  { index: '01', title: '准备清单', detail: '外部 JSON 描述脚本、字段和操作；路径不进入 Core' },
  { index: '02', title: '生成预览', detail: '修改文件前先核对影响，写入操作必须有 Dry Run' },
  { index: '03', title: '确认执行', detail: '输出、日志、取消与历史都在本机留痕' },
]
const manifestPath = ref(store.settings.privateToolsManifestPath)
const tools = ref<PrivateToolDefinition[]>([])
const activeToolId = ref('')
const activeOperationId = ref('')
const values = shallowReactive<Record<string, string | number>>({})
const loading = ref(false)
const running = ref(false)
const cancelling = ref(false)
const activeRunId = ref('')
const notice = ref('选择一个只保存在本机的工具清单后即可开始。')
const previewResult = ref<PrivateToolRunResult>()
const finalResult = ref<PrivateToolRunResult>()
const previewFingerprint = ref('')
const resultView = ref<ResultView>('payload')
const formValidationAttempted = ref(false)
const touchedFields = ref<Set<string>>(new Set())
const formElement = ref<HTMLFormElement>()
const contextMenu = ref<{ target: ContextTarget; x: number; y: number; toolId?: string }>()
const contextMenuElement = ref<HTMLElement>()
let contextMenuTrigger: HTMLElement | undefined

const activeTool = computed(() => tools.value.find((tool) => tool.id === activeToolId.value))
const activeOperation = computed(() => activeTool.value?.operations.find((operation) => operation.id === activeOperationId.value))
const currentFields = computed(() => activeOperation.value?.fields ?? [])
const normalizedValues = computed<Record<string, string>>(() => Object.fromEntries(currentFields.value.map((field) => [field.key, privateToolFieldValue(values[field.key])])))
const currentFingerprint = computed(() => JSON.stringify({ manifest: manifestPath.value, tool: activeToolId.value, operation: activeOperationId.value, values: normalizedValues.value }))
const operationChangesFiles = computed(() => activeOperation.value?.risk === 'changesFiles')
const fieldErrors = computed(() => privateToolFieldErrors(currentFields.value, normalizedValues.value))
const invalidFields = computed(() => currentFields.value.filter((field) => fieldErrors.value[field.key]))
const activeResult = computed(() => finalResult.value ?? previewResult.value)
const resultFailed = computed(() => Boolean(activeResult.value && activeResult.value.exitCode !== 0))
const canExecute = computed(() => Boolean(activeTool.value && activeOperation.value && !running.value && !invalidFields.value.length && (!operationChangesFiles.value || previewFingerprint.value === currentFingerprint.value)))
const payloadText = computed(() => {
  const payload = activeResult.value?.payload
  return payload ? JSON.stringify(payload, null, 2) : ''
})
const resultLog = computed(() => {
  const result = activeResult.value
  if (!result) return ''
  return result.stderr.trim() || (result.exitCode !== 0 ? result.stdout.trim() : '')
})
const displayedPayload = computed(() => privateToolDisplayText(payloadText.value))
const displayedLog = computed(() => privateToolDisplayText(resultLog.value))
const outputPaths = computed(() => collectPrivateToolOutputPaths(finalResult.value?.payload))
const scriptHistoryRoute = computed(() => ({ path: '/history', query: { kind: 'script', ...(activeToolId.value ? { q: `private:${activeToolId.value}${activeOperationId.value ? `:${activeOperationId.value}` : ''}` } : {}) } }))

function resetValues(fields = currentFields.value) {
  Object.keys(values).forEach((key) => delete values[key])
  for (const field of fields) values[field.key] = field.defaultValue ?? ''
  previewResult.value = undefined
  finalResult.value = undefined
  previewFingerprint.value = ''
  resultView.value = 'payload'
  formValidationAttempted.value = false
  touchedFields.value = new Set()
}

function syncRoute() {
  void router.replace({ path: '/private-tools', query: { tool: activeToolId.value, operation: activeOperationId.value } })
}

function activate(toolId: string, operationId?: string, sync = true) {
  if (running.value) return
  const tool = tools.value.find((item) => item.id === toolId) ?? tools.value[0]
  if (!tool) return
  const operation = tool.operations.find((item) => item.id === operationId) ?? tool.operations[0]
  if (!operation) return
  activeToolId.value = tool.id
  activeOperationId.value = operation.id
  resetValues(operation.fields)
  if (sync) syncRoute()
}

async function loadManifest(path = manifestPath.value) {
  if (running.value) { ui.toast('任务正在执行', '停止或等待当前脚本完成后再更换清单。', 'warning'); return }
  if (!path.trim()) return
  loading.value = true
  notice.value = '正在读取本机工具清单…'
  try {
    const catalog = await loadPrivateTools(path)
    tools.value = catalog.tools
    manifestPath.value = path
    store.updateSettings({ privateToolsManifestPath: path })
    const replayId = typeof route.query.replay === 'string' ? route.query.replay : ''
    if (replayId) await restoreJobParameters(replayId)
    else {
      activate(typeof route.query.tool === 'string' ? route.query.tool : catalog.tools[0]?.id ?? '', typeof route.query.operation === 'string' ? route.query.operation : undefined, false)
      notice.value = `已加载 ${catalog.tools.length} 个本机工具；命令、路径和脚本均不进入 Knitspace Core。`
    }
  } catch (error) {
    tools.value = []
    activeToolId.value = ''
    activeOperationId.value = ''
    notice.value = error instanceof Error ? error.message : '无法读取私人工具清单。'
  } finally {
    loading.value = false
  }
}

async function chooseManifest() {
  if (running.value) { ui.toast('任务正在执行', '停止或等待当前脚本完成后再更换清单。', 'warning'); return }
  if (!desktop) { ui.toast('仅桌面端可用', '私人工具包需要本机进程权限。', 'warning'); return }
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({ title: '选择 Knitspace 私人工具清单', multiple: false, filters: [{ name: 'JSON 清单', extensions: ['json'] }] })
  if (typeof selected === 'string') await loadManifest(selected)
}

async function chooseField(field: PrivateToolField) {
  if (!desktop) return
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({ title: `选择${field.label}`, multiple: false, directory: field.kind === 'directory' })
  if (typeof selected === 'string') values[field.key] = selected
}

function isFormReady() {
  return !invalidFields.value.length
}

function fieldError(field: PrivateToolField) {
  return fieldErrors.value[field.key] ?? ''
}

function showFieldError(field: PrivateToolField) {
  return Boolean(fieldError(field) && (formValidationAttempted.value || touchedFields.value.has(field.key)))
}

function touchField(field: PrivateToolField) {
  touchedFields.value = new Set([...touchedFields.value, field.key])
}

function failedRunMessage(result: PrivateToolRunResult) {
  const output = result.stderr.trim() || result.stdout.trim()
  if (!output) return `工具执行失败（退出码 ${result.exitCode}），没有返回错误信息。`
  const maxLength = 1800
  const detail = output.length > maxLength ? `${output.slice(0, maxLength)}\n…完整输出请在“运行日志”中查看。` : output
  return `工具执行失败（退出码 ${result.exitCode}）：${detail}`
}

function outputNames(result?: PrivateToolRunResult) {
  return collectPrivateToolOutputPaths(result?.payload).map((path) => path.split(/[\\/]/).pop() || path).slice(0, 12)
}

async function restoreJobParameters(jobId: string) {
  const replay = privateToolReplay(store.jobs.find((job) => job.id === jobId))
  if (!replay) {
    notice.value = '无法恢复这条任务：历史记录缺少可用的私人工具参数。'
    ui.toast('参数未恢复', notice.value, 'warning')
    const query = { ...route.query }
    delete query.replay
    await router.replace({ path: '/private-tools', query })
    return
  }
  const tool = tools.value.find((item) => item.id === replay.toolId)
  const operation = tool?.operations.find((item) => item.id === replay.operationId)
  if (!tool || !operation) {
    notice.value = '当前清单中找不到历史任务对应的工具或操作；请加载原来的清单。'
    ui.toast('需要原工具清单', notice.value, 'warning')
    return
  }
  activate(tool.id, operation.id, false)
  for (const field of currentFields.value) {
    if (replay.values[field.key] !== undefined) values[field.key] = privateToolFieldValue(replay.values[field.key])
  }
  previewResult.value = undefined
  finalResult.value = undefined
  previewFingerprint.value = ''
  resultView.value = 'payload'
  notice.value = operation.risk === 'changesFiles'
    ? '已恢复上次参数。为保护原文件，请重新生成 Dry Run 预览后再确认执行。'
    : '已恢复上次参数；核对输入后可再次执行，本次不会自动运行。'
  await router.replace({ path: '/private-tools', query: { tool: tool.id, operation: operation.id } })
  void nextTick(() => formElement.value?.querySelector<HTMLElement>('input, select, button')?.focus({ preventScroll: true }))
}

async function run(mode: 'preview' | 'apply') {
  const tool = activeTool.value
  const operation = activeOperation.value
  if (!tool || !operation || running.value) return
  if (!isFormReady()) {
    formValidationAttempted.value = true
    touchedFields.value = new Set(currentFields.value.map((field) => field.key))
    notice.value = `请先修正：${invalidFields.value.map((field) => field.label).join('、')}。`
    void nextTick(() => formElement.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
    return
  }
  formValidationAttempted.value = false
  if (mode === 'apply' && operationChangesFiles.value && previewFingerprint.value !== currentFingerprint.value) {
    notice.value = '参数已变化。请先重新生成预览，再确认执行。'
    return
  }
  if (mode === 'apply' && operationChangesFiles.value) {
    const approved = await ui.confirm({
      title: `执行“${operation.title}”？`,
      message: operation.confirmationText || '该脚本会修改或移动本机文件。Knitspace 已要求预览；请确认预览结果与当前参数一致。',
      confirmLabel: '确认执行',
      danger: true,
    })
    if (!approved) { notice.value = '已取消执行，未修改文件。'; return }
  }
  const runId = newId()
  activeRunId.value = runId
  running.value = true
  cancelling.value = false
  const label = `${tool.title} · ${operation.title}${mode === 'preview' ? '（预览）' : ''}`
  const job = store.addJob('script', label, currentFields.value.filter((field) => field.kind === 'file' || field.kind === 'directory').map((field) => normalizedValues.value[field.key]).filter(Boolean), {
    toolId: `private:${tool.id}:${operation.id}`,
    route: `/private-tools?tool=${tool.id}&operation=${operation.id}`,
    retryable: true,
    parameters: { mode, ...normalizedValues.value },
  })
  store.updateJob(job.id, { status: 'running', progress: 18, detail: mode === 'preview' ? '正在生成安全预览…' : '脚本正在本机执行…' })
  notice.value = mode === 'preview' ? '正在读取并生成预览；原文件保持不变。' : '脚本正在本机执行；可以随时请求停止。'
  try {
    const result = await runPrivateTool({ manifestPath: manifestPath.value, toolId: tool.id, operationId: operation.id, input: normalizedValues.value, runId, mode, confirmed: mode === 'apply' && operationChangesFiles.value })
    if (result.exitCode !== 0) {
      if (mode === 'preview') {
        previewResult.value = result
        previewFingerprint.value = ''
        finalResult.value = undefined
      } else {
        finalResult.value = result
      }
      resultView.value = 'log'
      throw new Error(failedRunMessage(result))
    }
    if (mode === 'preview') {
      previewResult.value = result
      previewFingerprint.value = currentFingerprint.value
      finalResult.value = undefined
      resultView.value = 'payload'
      notice.value = `预览已完成，用时 ${(result.elapsedMs / 1000).toFixed(1)} 秒。参数不变时才可执行。`
    } else {
      finalResult.value = result
      resultView.value = 'payload'
      notice.value = `执行完成，用时 ${(result.elapsedMs / 1000).toFixed(1)} 秒。`
    }
    store.updateJob(job.id, { status: 'succeeded', progress: 100, outputNames: outputNames(result), detail: notice.value })
    store.addActivity('tool', mode === 'preview' ? '生成私人工具预览' : '执行私人工具', label, '/private-tools', job.id)
    ui.toast(mode === 'preview' ? '预览已完成' : '私人工具已完成', notice.value, 'success')
  } catch (error) {
    const detail = error instanceof Error ? error.message : '私人工具执行失败。'
    const cancelled = cancelling.value || detail.includes('任务已取消') || store.jobs.find((item) => item.id === job.id)?.errorCode === 'PRIVATE_TOOL_CANCEL_REQUESTED'
    store.updateJob(job.id, { status: cancelled ? 'cancelled' : 'failed', progress: 100, errorCode: cancelled ? 'PRIVATE_TOOL_CANCELLED' : 'PRIVATE_TOOL_FAILED', detail })
    notice.value = detail
    ui.toast(cancelled ? '任务已停止' : '私人工具失败', detail, cancelled ? 'warning' : 'error')
  } finally {
    activeRunId.value = ''
    running.value = false
    cancelling.value = false
  }
}

async function cancelRun() {
  if (!activeRunId.value || cancelling.value) return
  cancelling.value = true
  try {
    await cancelPrivateToolRun(activeRunId.value)
    notice.value = '已向脚本发送停止请求，正在等待进程退出。'
  } catch (error) {
    cancelling.value = false
    ui.toast('无法停止任务', error instanceof Error ? error.message : '任务状态不可用。', 'error')
  }
}

function showContext(target: ContextTarget, x: number, y: number, trigger: HTMLElement, toolId?: string) {
  contextMenuTrigger = trigger
  contextMenu.value = { target, toolId, ...clampMenuPosition(x, y, { menuWidth: 218, menuHeight: target === 'result' ? 188 : 224 }) }
  void nextTick(() => contextMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus())
}

function openContext(event: MouseEvent, target: ContextTarget, toolId?: string) {
  event.preventDefault()
  showContext(target, event.clientX, event.clientY, event.currentTarget as HTMLElement, toolId)
}

function openContextFromKeyboard(target: ContextTarget, trigger: HTMLElement, toolId?: string) {
  const bounds = trigger.getBoundingClientRect()
  showContext(target, bounds.right + 6, bounds.top + 6, trigger, toolId)
}

function handleContextTriggerKeydown(event: KeyboardEvent, target: ContextTarget, toolId?: string) {
  if (!isContextMenuShortcut(event)) return
  event.preventDefault()
  event.stopPropagation()
  openContextFromKeyboard(target, event.currentTarget as HTMLElement, toolId)
}

async function copyText(value: string, success: string) {
  try { await navigator.clipboard.writeText(value); ui.toast(success, undefined, 'success') }
  catch (error) { ui.toast('复制失败', error instanceof Error ? error.message : '系统剪贴板暂不可用。', 'error') }
  contextMenu.value = undefined
}

function openContextTool() {
  if (contextMenu.value?.toolId) activate(contextMenu.value.toolId)
  closeContext()
}

function copyManifestTemplate() {
  void copyText(privateToolManifestTemplate, '清单模板已复制')
}

function copyCurrentToolLink() {
  const toolId = contextMenu.value?.toolId ?? activeToolId.value
  const tool = tools.value.find((item) => item.id === toolId)
  const operationId = toolId === activeToolId.value && tool?.operations.some((operation) => operation.id === activeOperationId.value)
    ? activeOperationId.value
    : tool?.operations[0]?.id
  const target = router.resolve({ path: '/private-tools', query: { tool: toolId, ...(operationId ? { operation: operationId } : {}) } }).href
  void copyText(target, '工具深链已复制')
}

function openToolHistory() {
  const toolId = contextMenu.value?.toolId ?? activeToolId.value
  closeContext()
  void router.push({ path: '/history', query: { kind: 'script', ...(toolId ? { q: `private:${toolId}` } : {}) } })
}

async function revealOutput(path?: string) {
  if (!path) return
  try { await revealDesktopFile(path) }
  catch (error) { ui.toast('无法打开输出位置', error instanceof Error ? error.message : '输出文件可能已移动。', 'error') }
}

async function consumeRouteAction(value: unknown) {
  const action = privateToolRouteAction(value)
  if (!action) return
  const query = { ...route.query }
  delete query.action
  await router.replace({ path: '/private-tools', query })
  if (action === 'choose-manifest') await chooseManifest()
  else if (action === 'copy-template') copyManifestTemplate()
  else if (manifestPath.value) await loadManifest()
}

watch(() => [route.query.tool, route.query.operation], () => {
  const toolId = typeof route.query.tool === 'string' ? route.query.tool : ''
  const operationId = typeof route.query.operation === 'string' ? route.query.operation : ''
  if (tools.value.length && (toolId !== activeToolId.value || operationId !== activeOperationId.value)) activate(toolId, operationId, false)
})
watch(() => route.query.action, (value) => { void consumeRouteAction(value) }, { immediate: true })
watch(() => route.query.replay, (value) => {
  if (typeof value === 'string' && tools.value.length) void restoreJobParameters(value)
})

watch(currentFingerprint, () => {
  if (previewFingerprint.value && previewFingerprint.value !== currentFingerprint.value) finalResult.value = undefined
})

function closeContext() { contextMenu.value = undefined }
function closeContextWithFocus() {
  closeContext()
  contextMenuTrigger?.focus({ preventScroll: true })
}
function closeContextOnWindow() { closeContext() }
function handleContextMenuKeydown(event: KeyboardEvent) {
  const menuItems = [...(contextMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  if (event.key === 'Escape') {
    event.preventDefault()
    closeContextWithFocus()
    return
  }
  const nextIndex = nextMenuItemIndex(event.key, menuItems.indexOf(document.activeElement as HTMLButtonElement), menuItems.length)
  if (nextIndex === undefined) return
  event.preventDefault()
  menuItems[nextIndex]?.focus()
}

onMounted(async () => {
  window.addEventListener('click', closeContextOnWindow)
  window.addEventListener('blur', closeContextOnWindow)
  if (manifestPath.value) await loadManifest()
  else await nextTick()
})

onBeforeUnmount(() => {
  window.removeEventListener('click', closeContextOnWindow)
  window.removeEventListener('blur', closeContextOnWindow)
})
</script>

<template>
  <!-- No `private-tools__*` classes. The 01 参数 / 02 预览 / 03 执行 order
       stays — running someone's own script against their own files is the one
       flow in this app where the steps are the safety story. -->
  <div class="page-enter h-full mx-auto w-full max-w-320 px-8 py-6" @click="closeContext">
    <PageHeader title="私人工具包" subtitle="按清单加载你自己的脚本；改文件的操作一律先预览再执行">
      <template #actions>
        <span class="row gap-1.5 h-9 px-3 rounded-sm bg-surface-2 border border-line text-[12px] text-fg-2">
          <i class="w-1.5 h-1.5 rounded-full shrink-0" :class="desktop ? 'bg-success' : 'bg-warn'" aria-hidden="true" />
          {{ desktop ? '本机可执行' : '仅桌面端' }}
        </span>
      </template>
    </PageHeader>

    <section v-if="!desktop || !tools.length" class="flex-1 min-h-0 center panel">
      <div class="stack items-center gap-4 max-w-140 px-6 text-center">
        <span class="center w-12 h-12 rounded-lg bg-accent-soft text-accent"><AppIcon name="terminal" :size="24" /></span>
        <div class="stack gap-1.5">
          <strong class="text-[15px] font-semibold text-fg">
            {{ !desktop ? '私人工具包需要桌面端' : loading ? '正在读取清单…' : '还没有加载私人工具清单' }}
          </strong>
          <p class="text-[12px] leading-relaxed text-fg-3">
            {{ !desktop ? '浏览器模式不会执行本地 Python、PowerShell 或其他脚本，避免网页获取不必要的系统权限。' : notice }}
          </p>
        </div>
        <ol class="grid grid-cols-3 gap-2 w-full" aria-label="私人工具执行流程">
          <li v-for="step in onboardingSteps" :key="step.index" class="stack gap-1 p-3 rounded-sm border border-line bg-well text-left">
            <span class="font-mono text-[11px] font-semibold text-accent">{{ step.index }}</span>
            <b class="text-[12px] font-medium text-fg">{{ step.title }}</b>
            <small class="text-[11px] leading-relaxed text-fg-3">{{ step.detail }}</small>
          </li>
        </ol>
        <div class="row flex-wrap justify-center gap-2">
          <button v-if="desktop" class="btn-primary" :disabled="loading" @click="chooseManifest">选择本机 JSON 清单</button>
          <button class="btn-default" @click.stop="copyManifestTemplate"><AppIcon name="duplicate" :size="14" />复制清单模板</button>
          <RouterLink v-if="!desktop" class="btn-default" to="/history?kind=script"><AppIcon name="clock" :size="14" />查看脚本历史</RouterLink>
        </div>
        <small class="text-[11px] leading-relaxed text-fg-3">清单由你自己保管；Knitspace 不会扫描磁盘或自动运行脚本。</small>
      </div>
    </section>

    <section v-else class="flex-1 min-h-0 grid grid-cols-[minmax(220px,260px)_minmax(0,1fr)] panel overflow-hidden">
      <aside class="stack min-h-0 border-r border-line" aria-label="私人工具列表">
        <header class="row-between gap-2 shrink-0 px-3 h-10 border-b border-line">
          <span class="row gap-2 min-w-0">
            <b class="text-[11px] font-semibold text-fg-3">本地工具包</b>
            <span class="chip h-5 px-1.5 text-[11px] tabular-nums">{{ tools.length }}</span>
          </span>
          <small class="min-w-0 truncate font-mono text-[11px] text-fg-3" :title="manifestPath">{{ manifestPath.split(/[\\/]/).pop() }}</small>
        </header>
        <div class="flex-1 min-h-0 overflow-y-auto stack gap-0.5 p-1.5">
          <button
            v-for="tool in tools"
            :key="tool.id"
            class="row gap-2 px-2 py-2 rounded-sm text-left transition-colors duration-120 disabled:opacity-45 disabled:cursor-not-allowed"
            :class="tool.id === activeToolId ? 'bg-accent-soft' : 'hover:not-disabled:bg-surface-2'"
            :disabled="running"
            :aria-pressed="tool.id === activeToolId"
            aria-haspopup="menu"
            :aria-expanded="contextMenu?.target === 'tool' && contextMenu.toolId === tool.id"
            @click.stop="activate(tool.id)"
            @contextmenu.stop="openContext($event, 'tool', tool.id)"
            @keydown="handleContextTriggerKeydown($event, 'tool', tool.id)"
          >
            <span class="center w-7 h-7 shrink-0 rounded-sm bg-surface-2" :class="tool.id === activeToolId ? 'text-accent' : 'text-fg-2'">
              <AppIcon :name="tool.icon || 'terminal'" :size="15" />
            </span>
            <span class="stack gap-0.5 min-w-0 flex-1">
              <b class="text-[12px] font-medium truncate" :class="tool.id === activeToolId ? 'text-accent' : 'text-fg'">{{ tool.title }}</b>
              <small class="text-[11px] truncate text-fg-3">{{ tool.description || '本地脚本工具' }}</small>
            </span>
          </button>
        </div>
        <footer class="shrink-0 p-2 border-t border-line">
          <button class="btn-default btn-sm w-full" :disabled="loading || running" @click.stop="loadManifest()"><AppIcon name="rotate" :size="13" />重新读取清单</button>
        </footer>
      </aside>

      <main v-if="activeTool && activeOperation" class="stack min-h-0">
        <header class="row-between gap-3 shrink-0 px-3 py-2 border-b border-line">
          <span class="stack gap-0.5 min-w-0">
            <h3 class="text-[14px] font-semibold truncate text-fg">{{ activeTool.title }}</h3>
            <p class="text-[11px] truncate text-fg-3">{{ activeTool.description }}</p>
          </span>
          <span class="chip h-6 px-2 text-[11px] shrink-0" :class="operationChangesFiles ? 'bg-warn-soft text-warn' : 'bg-success-soft text-success'">
            {{ operationChangesFiles ? '先预览 · 再修改' : '只读执行' }}
          </span>
        </header>

        <nav class="row flex-wrap gap-1.5 shrink-0 px-3 py-2 border-b border-line" aria-label="工具操作">
          <button
            v-for="operation in activeTool.operations"
            :key="operation.id"
            class="stack gap-0.5 px-2.5 py-1.5 rounded-sm border text-left transition-colors duration-120 disabled:opacity-45 disabled:cursor-not-allowed"
            :class="operation.id === activeOperationId ? 'border-accent bg-accent-soft' : 'border-line hover:not-disabled:border-line-strong'"
            :disabled="running"
            :aria-pressed="operation.id === activeOperationId"
            @click="activate(activeTool.id, operation.id)"
          >
            <b class="text-[12px] font-medium" :class="operation.id === activeOperationId ? 'text-accent' : 'text-fg'">{{ operation.title }}</b>
            <small class="text-[11px] text-fg-3">{{ operation.description || (operation.risk === 'changesFiles' ? '需预览确认' : '不修改文件') }}</small>
          </button>
        </nav>

        <div class="flex-1 min-h-0 grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <form ref="formElement" class="stack min-h-0 border-r border-line" @submit.prevent="run(operationChangesFiles ? 'preview' : 'apply')">
            <header class="row-between gap-2 shrink-0 px-3 h-9 border-b border-line">
              <span class="row gap-2">
                <span class="center w-5.5 h-5.5 rounded-sm bg-accent-soft font-mono text-[11px] font-semibold text-accent">01</span>
                <b class="text-[11px] font-semibold text-fg-3">参数</b>
              </span>
              <small class="text-[11px] text-fg-3">{{ operationChangesFiles ? '预览后才能执行' : '不会修改原文件' }}</small>
            </header>
            <div class="flex-1 min-h-0 overflow-y-auto grid grid-cols-2 gap-2.5 p-3 content-start">
              <label
                v-for="field in currentFields"
                :key="field.key"
                class="stack gap-1.5"
                :class="field.kind === 'text' || field.kind === 'file' || field.kind === 'directory' ? 'col-span-2' : ''"
              >
                <span class="row gap-1.5 text-[12px] text-fg-3">
                  {{ field.label }}
                  <i v-if="field.required" class="text-[11px] not-italic text-warn">必填</i>
                </span>
                <span v-if="field.kind === 'file' || field.kind === 'directory'" class="row gap-1.5">
                  <input
                    v-model="values[field.key]"
                    class="field h-8 min-w-0 flex-1 text-[12px]"
                    :class="showFieldError(field) ? 'border-danger!' : ''"
                    :disabled="running"
                    :aria-invalid="showFieldError(field)"
                    maxlength="32768"
                    :placeholder="field.placeholder || (field.kind === 'file' ? '选择文件…' : '选择目录…')"
                    spellcheck="false"
                    @blur="touchField(field)"
                  />
                  <button type="button" class="btn-default btn-sm shrink-0" :disabled="running" @click="chooseField(field)">选择</button>
                </span>
                <select
                  v-else-if="field.kind === 'select'"
                  v-model="values[field.key]"
                  class="field h-8 text-[12px]"
                  :class="showFieldError(field) ? 'border-danger!' : ''"
                  :disabled="running"
                  :aria-invalid="showFieldError(field)"
                  @blur="touchField(field)"
                  @change="touchField(field)"
                >
                  <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <input
                  v-else
                  v-model="values[field.key]"
                  class="field h-8 text-[12px]"
                  :class="showFieldError(field) ? 'border-danger!' : ''"
                  :disabled="running"
                  :aria-invalid="showFieldError(field)"
                  :type="field.kind === 'integer' ? 'number' : 'text'"
                  :min="field.min"
                  :max="field.max"
                  :step="field.kind === 'integer' ? 1 : undefined"
                  maxlength="32768"
                  :placeholder="field.placeholder"
                  :inputmode="field.kind === 'integer' ? 'numeric' : undefined"
                  @blur="touchField(field)"
                />
                <small v-if="showFieldError(field)" class="text-[11px] leading-relaxed text-danger" role="alert">{{ fieldError(field) }}</small>
                <small v-else-if="field.help" class="text-[11px] leading-relaxed text-fg-3">{{ field.help }}</small>
              </label>
            </div>
          </form>

          <aside
            class="stack min-h-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-inset"
            tabindex="0"
            role="region"
            aria-label="本机工具结果；按菜单键打开结果操作"
            aria-haspopup="menu"
            :aria-expanded="contextMenu?.target === 'result'"
            @contextmenu.stop="openContext($event, 'result')"
            @keydown="handleContextTriggerKeydown($event, 'result')"
          >
            <header class="row-between gap-2 shrink-0 px-3 h-9 border-b border-line">
              <span class="row gap-2 min-w-0">
                <span class="center w-5.5 h-5.5 shrink-0 rounded-sm font-mono text-[11px] font-semibold" :class="resultFailed ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'">02</span>
                <b class="text-[11px] font-semibold truncate" :class="resultFailed ? 'text-danger' : 'text-fg-3'">
                  {{ resultFailed ? '脚本未能完成' : finalResult ? '本机结果' : previewResult ? '预览已就绪' : '等待预览' }}
                </b>
              </span>
              <span class="row gap-2 shrink-0">
                <span class="row gap-0.5 p-0.5 rounded-sm bg-well border border-line" role="tablist" aria-label="结果内容">
                  <button
                    class="center h-6 px-2 rounded-[4px] text-[11px] transition-colors duration-120"
                    :class="resultView === 'payload' ? 'bg-surface text-fg font-medium shadow-sm' : 'text-fg-3 hover:text-fg'"
                    role="tab"
                    :aria-selected="resultView === 'payload'"
                    @click.stop="resultView = 'payload'"
                  >
                    JSON
                  </button>
                  <button
                    class="center h-6 px-2 rounded-[4px] text-[11px] transition-colors duration-120 disabled:opacity-40 disabled:cursor-not-allowed"
                    :class="resultView === 'log' ? 'bg-surface text-fg font-medium shadow-sm' : 'text-fg-3 hover:not-disabled:text-fg'"
                    role="tab"
                    :aria-selected="resultView === 'log'"
                    :disabled="!resultLog"
                    @click.stop="resultView = 'log'"
                  >
                    日志
                  </button>
                </span>
                <small v-if="activeResult" class="font-mono text-[11px] tabular-nums text-fg-3">{{ (activeResult.elapsedMs / 1000).toFixed(1) }}s</small>
              </span>
            </header>

            <div v-if="resultView === 'payload' && payloadText" class="flex-1 min-h-0 overflow-auto stack gap-1.5 p-3 bg-well">
              <pre class="font-mono text-[11px] leading-relaxed text-fg-2 whitespace-pre-wrap break-all">{{ displayedPayload.text }}</pre>
              <small v-if="displayedPayload.truncated" class="text-[11px] leading-relaxed text-fg-3">
                界面少渲染 {{ displayedPayload.hiddenCharacters.toLocaleString('zh-CN') }} 个字符；右键复制仍保留完整 JSON。
              </small>
            </div>
            <div v-else-if="resultView === 'log' && resultLog" class="flex-1 min-h-0 overflow-auto stack gap-1.5 p-3 bg-well">
              <pre class="font-mono text-[11px] leading-relaxed text-fg-2 whitespace-pre-wrap break-all">{{ displayedLog.text }}</pre>
              <small v-if="activeResult?.logTruncated" class="text-[11px] leading-relaxed text-warn">进程日志已在 512 KB 安全边界截断；请让脚本输出摘要。</small>
              <small v-else-if="displayedLog.truncated" class="text-[11px] leading-relaxed text-fg-3">
                界面少渲染 {{ displayedLog.hiddenCharacters.toLocaleString('zh-CN') }} 个字符；右键复制仍保留完整日志。
              </small>
            </div>
            <div v-else class="flex-1 min-h-0 stack items-center justify-center gap-2 p-6 text-center">
              <AppIcon name="file-text" :size="20" class="text-fg-3" />
              <b class="text-[12px] font-medium text-fg">
                {{ resultFailed ? '脚本未能完成' : resultView === 'log' ? '这次运行没有返回日志' : operationChangesFiles ? '先生成安全预览' : '执行后显示 JSON 结果' }}
              </b>
              <p class="max-w-80 text-[11px] leading-relaxed text-fg-3">{{ notice }}</p>
            </div>

            <footer v-if="outputPaths.length" class="row-between gap-2 shrink-0 px-3 h-10 border-t border-line">
              <span class="row gap-2 min-w-0 text-[11px]">
                <b class="shrink-0 font-medium text-fg">输出位置</b>
                <small class="min-w-0 truncate text-fg-3">{{ outputPaths.length }} 项已由脚本返回</small>
              </span>
              <button class="btn-tool shrink-0" @click.stop="revealOutput(outputPaths[0])">打开位置</button>
            </footer>
          </aside>
        </div>

        <footer class="row-between gap-3 shrink-0 px-3 py-2.5 border-t border-line">
          <span class="stack gap-0.5 min-w-0">
            <span class="row gap-2">
              <span class="center w-5.5 h-5.5 shrink-0 rounded-sm bg-accent-soft font-mono text-[11px] font-semibold text-accent">03</span>
              <strong class="min-w-0 truncate text-[12px] font-medium text-fg" aria-live="polite">{{ notice }}</strong>
            </span>
            <small v-if="invalidFields.length" class="text-[11px] text-warn">还需修正 {{ invalidFields.map((field) => field.label).join('、') }}。</small>
            <small v-else-if="operationChangesFiles && previewFingerprint && previewFingerprint !== currentFingerprint" class="text-[11px] text-warn">参数已改变，需要重新预览。</small>
            <small v-else-if="operationChangesFiles" class="text-[11px] text-fg-3">预览与当前参数一致后，才会启用确认执行。</small>
            <div
              v-if="running"
              class="h-1 mt-1 rounded-full bg-surface-2 overflow-hidden"
              role="progressbar"
              :aria-label="operationChangesFiles ? '私人工具正在本机执行' : '本机工具正在运行'"
              aria-valuetext="运行中"
            >
              <i class="block h-full w-1/3 rounded-full bg-accent-solid animate-pulse" aria-hidden="true" />
            </div>
          </span>
          <span class="row gap-2 shrink-0">
            <button v-if="running" class="btn-danger btn-sm" :disabled="cancelling" @click="cancelRun">{{ cancelling ? '正在停止…' : '停止任务' }}</button>
            <button v-else-if="operationChangesFiles" class="btn-default btn-sm" @click="run('preview')">{{ previewResult ? '重新预览' : '生成预览' }}</button>
            <button class="btn-primary btn-sm" :disabled="!canExecute" @click="run('apply')">
              {{ running ? '执行中…' : operationChangesFiles ? '确认执行' : '执行本机工具' }}
            </button>
          </span>
        </footer>
      </main>
    </section>

    <Teleport to="body">
      <div
        v-if="contextMenu"
        ref="contextMenuElement"
        class="menu-panel w-64"
        role="menu"
        :aria-label="contextMenu.target === 'tool' ? '工具操作' : '结果操作'"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleContextMenuKeydown"
      >
        <p class="menu-title">{{ contextMenu.target === 'tool' ? '工具操作' : '结果操作' }}</p>
        <template v-if="contextMenu.target === 'tool'">
          <button class="menu-item" role="menuitem" @click="copyText(contextMenu.toolId ?? activeToolId, '工具标识已复制')">复制工具标识</button>
          <button class="menu-item" role="menuitem" @click="copyCurrentToolLink">复制当前工具深链</button>
          <button class="menu-item" role="menuitem" @click="openContextTool">打开此工具</button>
          <button class="menu-item" role="menuitem" @click="openToolHistory">查看此工具历史</button>
          <i class="menu-sep" aria-hidden="true" />
          <button class="menu-item" role="menuitem" :disabled="running" @click="loadManifest(); closeContext()">重新读取清单</button>
        </template>
        <template v-else>
          <button class="menu-item" role="menuitem" :disabled="!payloadText" @click="copyText(payloadText, 'JSON 结果已复制')">复制 JSON 结果</button>
          <button class="menu-item" role="menuitem" :disabled="!resultLog" @click="copyText(resultLog, '运行日志已复制')">复制运行日志</button>
          <button class="menu-item" role="menuitem" :disabled="!outputPaths.length" @click="revealOutput(outputPaths[0]); closeContext()">打开首个输出位置</button>
        </template>
      </div>
    </Teleport>
  </div>
</template>
