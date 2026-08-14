<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { aiErrorMessage, contentActionLabels, getSessionApiKey, makeContentChatCompletionRequest, runContentAi, type ContentAiAction } from '@/lib/ai'
import { isDesktop } from '@/lib/native'
import { chooseOutputDirectory, exportOutput } from '@/lib/output'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import FileDropZone from '@/components/FileDropZone.vue'
const MarkdownContent = defineAsyncComponent(() => import('@/components/MarkdownContent.vue'))
const AI_MAX_INPUT_FILE_BYTES = 4 * 1024 * 1024
const AI_MAX_CONTENT_CHARS = 1_000_000
const AI_PAYLOAD_PREVIEW_CHARS = 40_000

const actionMeta: Record<ContentAiAction, { icon: string; description: string; outcome: string }> = {
  summarize: { icon: 'list', description: '压缩长材料，保留事实与重点', outcome: '三行摘要 + 要点清单' },
  translate: { icon: 'arrow-right', description: '自动判断中英文并保留结构', outcome: '忠实的双向译稿' },
  rewrite: { icon: 'file-text', description: '让表达更清晰、专业和简洁', outcome: '改写稿 + 调整说明' },
  extract: { icon: 'inbox', description: '提取事项、负责人、时间与风险', outcome: '可继续整理的表格' },
  email: { icon: 'file-text', description: '从已有材料起草一封中文邮件', outcome: '主题 + 正文 + 下一步' },
}

const store = useWorkbenchStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const normalizeAction = (value: unknown): ContentAiAction => {
  const requested = String(value ?? '')
  return (['summarize', 'translate', 'rewrite', 'extract', 'email'].includes(requested) ? requested : 'summarize') as ContentAiAction
}
const action = ref<ContentAiAction>(normalizeAction(route.query.action))
const resultAction = ref<ContentAiAction>(action.value)
const content = ref(store.consumeIntakeText())
const inputFiles = ref<File[]>(store.consumeIntakeFiles())
const routeProfileId = typeof route.query.profile === 'string' ? route.query.profile : ''
const profileId = ref(store.aiProfiles.some((item) => item.id === routeProfileId) ? routeProfileId : store.aiProfiles[0]?.id ?? '')
const running = ref(false)
const result = ref('')
const error = ref('')
const payloadOpen = ref(false)
const payloadPreview = ref('')
const payloadPreviewTruncated = ref(false)
const payloadSnapshotVersion = ref(-1)
const outputContextMenu = ref<{ x: number; y: number } | null>(null)
const outputMenuElement = ref<HTMLElement>()
const outputPanelElement = ref<HTMLElement>()
let outputMenuTrigger: HTMLElement | undefined
let inputReadVersion = 0
let activeRunController: AbortController | undefined
const payloadVersion = ref(0)

const profile = computed(() => store.aiProfiles.find((item) => item.id === profileId.value))
const payloadStale = computed(() => payloadOpen.value && payloadSnapshotVersion.value !== payloadVersion.value)
const contentSizeLabel = computed(() => {
  const length = content.value.length
  if (length < 1000) return `${length} 字符`
  return `${(length / 1000).toFixed(length < 10_000 ? 1 : 0)}k 字符`
})
const profileStatus = computed(() => profile.value
  ? `${profile.value.label} · ${profile.value.model}`
  : '尚未配置兼容服务')
const requestTarget = computed(() => profile.value
  ? `${profile.value.baseUrl.replace(/\/$/, '')}/chat/completions`
  : '等待选择 AI 配置')
const contentNearLimit = computed(() => content.value.length >= AI_MAX_CONTENT_CHARS * .85)

watch(() => store.aiProfiles.map((item) => item.id), (ids) => {
  if (!ids.includes(profileId.value)) profileId.value = ids[0] ?? ''
}, { immediate: true })
watch(inputFiles,async files=>{const file=files[0];const version=++inputReadVersion;if(!file)return;try{if(file.size>AI_MAX_INPUT_FILE_BYTES)throw new Error('文本文件超过 4 MB，未载入编辑区。');const text=await file.text();if(text.length>AI_MAX_CONTENT_CHARS)throw new Error('文本内容超过 100 万字符，请先在 Markdown 编辑器中拆分需要处理的部分。');if(version===inputReadVersion&&inputFiles.value[0]===file)content.value=text}catch(reason){if(version===inputReadVersion){inputFiles.value=[];error.value=reason instanceof Error?reason.message:'无法读取这个文本文件。'}}})
/* The banner is an answer to what was on screen when 运行 was pressed. Once any
   of that changes the answer is stale — 「先粘贴、输入或拖入需要处理的文本。」
   was still sitting above a box with text in it and a 「31 字符」 counter beside
   it. */
watch([content, action, profileId, () => profile.value?.model], () => {
  payloadVersion.value += 1
  error.value = ''
})
watch(() => route.query.action, value => { action.value = normalizeAction(value) })
watch(() => route.query.profile, value => {
  if (typeof value === 'string' && store.aiProfiles.some((item) => item.id === value)) profileId.value = value
})

function selectAction(next: ContentAiAction) {
  action.value = next
  error.value = ''
  void router.replace({ query: { ...route.query, action: next } })
}
function refreshPayloadPreview() {
  const request = makeContentChatCompletionRequest(profile.value?.model ?? '未选择模型', action.value, content.value)
  const serialized = JSON.stringify(request, null, 2)
  payloadPreviewTruncated.value = serialized.length > AI_PAYLOAD_PREVIEW_CHARS
  payloadPreview.value = payloadPreviewTruncated.value
    ? `${serialized.slice(0, AI_PAYLOAD_PREVIEW_CHARS)}\n\n… 预览已截断；实际请求仍包含你确认的完整材料。`
    : serialized
  payloadSnapshotVersion.value = payloadVersion.value
}
function togglePayloadPreview(event: Event) {
  payloadOpen.value = (event.currentTarget as HTMLDetailsElement).open
  if (payloadOpen.value && !payloadPreview.value) refreshPayloadPreview()
}
function clearInput() {
  if (!content.value && !inputFiles.value.length) return
  content.value = ''
  inputFiles.value = []
  error.value = ''
}
async function run() {
  if (running.value) return
  error.value = ''
  if (!content.value.trim()) { error.value = '先粘贴、输入或拖入需要处理的文本。'; return }
  if (content.value.length > AI_MAX_CONTENT_CHARS) { error.value = '材料超过 100 万字符，请先拆分后再发送，避免窗口卡顿和请求超限。'; return }
  const selected = profile.value
  if (!selected) { error.value = '先到设置中配置一个 OpenAI 兼容服务。'; return }
  const key = getSessionApiKey(selected.id)
  if (!isDesktop() && !key) { error.value = '浏览器开发模式需要在设置页重新输入 Session API Key；桌面版从系统凭据库读取。'; return }
  if (payloadOpen.value) refreshPayloadPreview()
  const requestedAction = action.value
  const names = inputFiles.value.length ? inputFiles.value.map(file => file.name) : ['用户粘贴文本']
  const job = store.addJob('ai', contentActionLabels[requestedAction], names, { toolId: 'ai-content', route: '/ai', parameters: { action: requestedAction }, inputs: inputFiles.value.map(file => ({ name: file.name, size: file.size, mime: file.type, path: (file as File & { path?: string }).path })), retryable: true })
  store.updateJob(job.id, { status: 'running', progress: 12, detail: '正在发送用户确认的文本…' })
  const controller = new AbortController()
  activeRunController = controller
  running.value = true
  try {
    const nextResult = await runContentAi(selected, key, requestedAction, content.value, controller.signal)
    if (!nextResult) throw new Error('服务没有返回文本。')
    result.value = nextResult
    resultAction.value = requestedAction
    store.updateJob(job.id, { status: 'succeeded', progress: 100, outputNames: ['AI 草稿'], detail: '结果仅作为草稿，等待用户复制或导出。' })
    ui.toast('AI 草稿已生成', '结果仍需人工确认。', 'success')
  } catch (reason) {
    const detail = aiErrorMessage(reason)
    error.value = detail
    const cancelled = controller.signal.aborted
    store.updateJob(job.id, { status: cancelled ? 'cancelled' : 'failed', progress: 100, errorCode: cancelled ? 'AI_REQUEST_CANCELLED' : 'AI_REQUEST_FAILED', detail })
    ui.toast(cancelled ? '已停止 AI 请求' : 'AI 请求失败', detail, cancelled ? 'info' : 'error')
  } finally {
    if (activeRunController === controller) activeRunController = undefined
    running.value = false
  }
}
function cancelRun() {
  if (!activeRunController || activeRunController.signal.aborted) return
  error.value = '正在停止本次 AI 请求…'
  activeRunController.abort()
}
async function copy() { if(!result.value)return;try{await navigator.clipboard.writeText(result.value);ui.toast('草稿已复制',undefined,'success')}catch(error){ui.toast('复制失败',error instanceof Error?error.message:'系统剪贴板暂时不可用。','error')} }
async function exportDraft() { if(!result.value)return;try{if(isDesktop()&&!store.settings.outputDirectory){const directory=await chooseOutputDirectory();if(!directory)return;store.updateSettings({outputDirectory:directory})}const draftAction=resultAction.value;const name=`knitspace-${draftAction}-draft.md`;const output=await exportOutput(store.settings.outputDirectory,name,result.value,'text/markdown;charset=utf-8');const job=store.addJob('ai','导出 AI 草稿',['AI 草稿'],{toolId:'ai-content',route:'/ai',parameters:{action:draftAction}});store.updateJob(job.id,{status:'succeeded',progress:100,outputNames:[name],outputs:[output],detail:`${contentActionLabels[draftAction]}草稿已导出为 Markdown。`});ui.toast('草稿已导出',output.path||name,'success')}catch(error){ui.toast('导出失败',error instanceof Error?error.message:'无法导出草稿。','error')} }
function closeOutputContextMenu(restoreFocus=false){outputContextMenu.value=null;if(restoreFocus)void nextTick(()=>outputMenuTrigger?.focus())}
function openOutputContextMenu(event:MouseEvent){if(!result.value)return;const target=event.target instanceof Element?event.target:null;if(target?.closest('.markdown-mermaid'))return;event.preventDefault();outputMenuTrigger=outputPanelElement.value;outputContextMenu.value=clampMenuPosition(event.clientX,event.clientY,{menuWidth:244,menuHeight:164,margin:12});void nextTick(()=>outputMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())}
function openOutputContextFromKeyboard(event:KeyboardEvent){if(!isContextMenuShortcut(event)||!result.value)return;if(event.target instanceof Element&&event.target.closest('.markdown-mermaid'))return;event.preventDefault();const target=outputPanelElement.value;if(!target)return;const bounds=target.getBoundingClientRect();outputMenuTrigger=target;outputContextMenu.value=clampMenuPosition(bounds.right-252,bounds.top+52,{menuWidth:244,menuHeight:164,margin:12});void nextTick(()=>outputMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())}
function handleOutputMenuKeydown(event:KeyboardEvent){const items=[...(outputMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')??[])];if(!items.length)return;if(event.key==='Escape'){event.preventDefault();closeOutputContextMenu(true);return}const index=nextMenuItemIndex(event.key,items.indexOf(document.activeElement as HTMLButtonElement),items.length);if(index===undefined)return;event.preventDefault();items[index]?.focus()}
async function copyFromOutputMenu(){await copy();closeOutputContextMenu()}
async function exportFromOutputMenu(){await exportDraft();closeOutputContextMenu()}
function saveDraftToKnowledge(){if(!result.value)return;const draftAction=resultAction.value;const label=contentActionLabels[draftAction];const title=`AI ${label}草稿`;const document=store.createNote(title,undefined,`# ${title}\n\n${result.value}`);store.saveDocument({...document,subject:'计算机',tags:['AI 草稿',label]});closeOutputContextMenu();void router.push({path:'/documents',query:{kind:'note',document:document.id,mode:'edit'}});ui.toast('草稿已存入知识库',`已按“${label}”保存为独立 Markdown 笔记，可继续人工整理。`,'success')}
onBeforeUnmount(() => activeRunController?.abort())
</script>

<template>
  <!-- No `ai-workbench__*` classes; the scoped block that styled them is gone
       with them. The 01 / 02 / 03 order stays — sending content to a model is
       a linear, consequential task and the steps are the reassurance. -->
  <div class="page-enter h-full mx-auto w-full max-w-320 px-8 py-6" @click="closeOutputContextMenu()">
    <PageHeader title="AI 工作台" subtitle="三步走：选任务、确认要发送的材料、校对生成的草稿">
      <template #actions>
        <span class="row gap-1.5 h-9 px-3 rounded-sm bg-surface-2 border border-line text-[12px] text-fg-2">
          <AppIcon name="shield" :size="14" :class="profile ? 'text-success' : 'text-warn'" />
          {{ profile ? profileStatus : '尚未配置模型' }}
        </span>
        <RouterLink :class="profile ? 'btn-default' : 'btn-primary'" to="/settings?section=ai">
          {{ profile ? '管理配置' : '前往配置' }}<AppIcon name="arrow-right" :size="14" />
        </RouterLink>
      </template>
    </PageHeader>

    <section class="flex-1 min-h-0 grid grid-cols-[minmax(220px,260px)_minmax(0,1.15fr)_minmax(0,0.95fr)] panel overflow-hidden">
      <!-- ── 01 Task ───────────────────────────────────────────────────── -->
      <aside class="stack min-h-0 border-r border-line" aria-label="选择任务">
        <header class="row gap-2 shrink-0 px-3 h-10 border-b border-line">
          <span class="center w-5.5 h-5.5 shrink-0 rounded-sm bg-accent-soft font-mono text-[11px] font-semibold text-accent">01</span>
          <b class="text-[11px] font-semibold text-fg-3">这次要得到什么</b>
        </header>
        <nav class="flex-1 min-h-0 overflow-y-auto stack gap-0.5 p-1.5" aria-label="AI 内容操作">
          <button
            v-for="(label, key) in contentActionLabels"
            :key="key"
            class="row gap-2.5 px-2 py-2 rounded-sm text-left transition-colors duration-120"
            :class="action === key ? 'bg-accent-soft' : 'hover:bg-surface-2'"
            :aria-pressed="action === key"
            @click="selectAction(key as ContentAiAction)"
          >
            <b class="center w-7 h-7 shrink-0 rounded-sm" :class="action === key ? 'bg-accent-solid text-accent-fg' : 'bg-surface-2 text-fg-2'">
              <AppIcon :name="actionMeta[key as ContentAiAction].icon" :size="14" />
            </b>
            <span class="stack gap-0.5 min-w-0 flex-1">
              <strong class="text-[12px] font-medium truncate" :class="action === key ? 'text-accent' : 'text-fg'">{{ label }}</strong>
              <small class="text-[11px] truncate text-fg-3">{{ actionMeta[key as ContentAiAction].description }}</small>
            </span>
          </button>
        </nav>
        <footer class="stack gap-1.5 shrink-0 p-3 border-t border-line">
          <label for="ai-profile" class="text-[11px] font-semibold text-fg-3">使用配置</label>
          <select id="ai-profile" v-model="profileId" class="field h-8 text-[12px]" :disabled="!store.aiProfiles.length">
            <option v-if="!store.aiProfiles.length" value="">尚未配置</option>
            <option v-for="item in store.aiProfiles" :key="item.id" :value="item.id">{{ item.label }} · {{ item.model }}</option>
          </select>
          <RouterLink to="/settings?section=ai" class="tap text-[11px] text-accent hover:underline underline-offset-2">管理 API 与系统凭据</RouterLink>
        </footer>
      </aside>

      <!-- ── 02 Input ──────────────────────────────────────────────────── -->
      <main class="stack min-h-0 border-r border-line" aria-label="确认输入">
        <header class="row-between gap-2 shrink-0 px-3 h-10 border-b border-line">
          <span class="row gap-2 min-w-0">
            <span class="center w-5.5 h-5.5 shrink-0 rounded-sm bg-accent-soft font-mono text-[11px] font-semibold text-accent">02</span>
            <b class="text-[11px] font-semibold text-fg-3">确认发送的材料</b>
          </span>
          <span class="row gap-2 shrink-0">
            <small class="font-mono text-[11px] tabular-nums" :class="contentNearLimit ? 'text-warn' : 'text-fg-3'">{{ contentSizeLabel }} / 100 万</small>
            <button class="btn-sm" :class="running ? 'btn-danger' : 'btn-primary'" @click="running ? cancelRun() : run()">
              <AppIcon :name="running ? 'close' : 'sparkle'" :size="14" />{{ running ? '停止等待' : contentActionLabels[action] }}
            </button>
          </span>
        </header>

        <FileDropZone
          v-model="inputFiles"
          compact
          accept=".txt,.md,.json,.js,.ts,.py,.java,.csv,text/*,application/json"
          :multiple="false"
          :max-file-bytes="AI_MAX_INPUT_FILE_BYTES"
          :max-files="1"
          title="拖入文本、Markdown 或代码"
          class="shrink-0 rounded-none! border-0! border-b! border-line!"
          @error="error = $event"
        />

        <textarea
          v-model="content"
          class="flex-1 min-h-0 px-3 py-2.5 bg-well border-0 text-[13px] leading-relaxed text-fg resize-none focus:outline-none"
          :maxlength="AI_MAX_CONTENT_CHARS"
          spellcheck="true"
          aria-label="准备发送的文字"
          placeholder="粘贴会议记录、课程笔记、邮件草稿、需求说明或代码……"
        />

        <p v-if="error" class="row gap-2 shrink-0 px-3 py-2 border-t border-line bg-danger-soft text-[11px] leading-relaxed text-danger" role="alert">
          <AppIcon name="warning" :size="14" class="shrink-0 mt-0.5" />{{ error }}
        </p>

        <!-- The one disclosure worth keeping: nobody wants a request body on
             screen by default, and everybody should be able to see it. -->
        <details class="stack shrink-0 border-t border-line" @toggle="togglePayloadPreview">
          <summary class="row-between gap-2 px-3 h-9 cursor-pointer text-[11px] transition-colors duration-120 hover:bg-surface-2">
            <span class="row gap-1.5 font-semibold text-fg-3"><AppIcon name="shield" :size="13" />查看实际请求体</span>
            <small :class="payloadStale ? 'text-warn' : 'text-fg-3'">{{ payloadStale ? '正文、模型或任务已变化 · 需要刷新' : '密钥不会显示' }}</small>
          </summary>
          <div class="stack gap-1.5 px-3 pb-3">
            <div class="row-between gap-2">
              <span class="min-w-0 truncate text-[11px] text-fg-3" :title="requestTarget">
                {{ payloadStale ? '当前预览不是最新请求' : payloadPreviewTruncated ? '请求体预览已安全截断' : '与下一次请求体保持一致' }} · {{ requestTarget }}
              </span>
              <button type="button" class="btn-tool shrink-0" @click="refreshPayloadPreview">刷新预览</button>
            </div>
            <pre class="max-h-48 overflow-auto p-2.5 rounded-sm bg-well border border-line font-mono text-[11px] leading-relaxed text-fg-2 whitespace-pre-wrap break-all">{{ payloadPreview }}</pre>
          </div>
        </details>

        <footer class="row-between gap-3 shrink-0 px-3 py-2.5 border-t border-line">
          <span class="row gap-2 min-w-0 text-[11px] leading-relaxed text-fg-3">
            <AppIcon name="shield" :size="14" class="shrink-0 mt-0.5 text-success" />
            需要你主动发送；结果只进入右侧草稿区，不自动写入任何文档。
          </span>
          <button type="button" class="btn-tool shrink-0" :disabled="running || (!content && !inputFiles.length)" @click="clearInput">清空材料</button>
        </footer>
      </main>

      <!-- ── 03 Draft ──────────────────────────────────────────────────── -->
      <aside
        ref="outputPanelElement"
        class="stack min-h-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-inset"
        tabindex="0"
        :aria-busy="running"
        aria-label="AI 草稿结果；右键或 Shift 加 F10 打开操作菜单"
        @contextmenu="openOutputContextMenu"
        @keydown="openOutputContextFromKeyboard"
      >
        <header class="row-between gap-2 shrink-0 px-3 h-10 border-b border-line">
          <span class="row gap-2 min-w-0">
            <span class="center w-5.5 h-5.5 shrink-0 rounded-sm bg-accent-soft font-mono text-[11px] font-semibold text-accent">03</span>
            <b class="text-[11px] font-semibold text-fg-3">人工确认草稿</b>
          </span>
          <span class="chip h-5 px-2 text-[11px] shrink-0">{{ result ? contentActionLabels[resultAction] : '等待生成' }}</span>
        </header>

        <p v-if="running" class="row gap-2 shrink-0 px-3 py-2 border-b border-line bg-accent-soft" role="status">
          <i class="w-1.5 h-1.5 shrink-0 mt-1.5 rounded-full bg-accent animate-pulse" aria-hidden="true" />
          <span class="stack gap-0.5 min-w-0">
            <b class="text-[12px] font-medium text-accent">正在生成新的草稿</b>
            <small class="text-[11px] leading-relaxed text-fg-2">你仍可阅读上一次结果；完成后会原位替换。</small>
          </span>
        </p>

        <div class="flex-1 min-h-0 overflow-y-auto">
          <MarkdownContent v-if="result" class="markdown-content p-4 text-[13px]" :source="result" compact />
          <div v-else class="stack items-center justify-center gap-3 h-full p-6 text-center">
            <span class="center w-12 h-12 rounded-lg bg-accent-soft text-accent"><AppIcon name="file-text" :size="22" /></span>
            <strong class="text-[13px] font-semibold text-fg">结果会留在这里，等你决定下一步</strong>
            <p class="text-[11px] leading-relaxed text-fg-3">选择左侧任务、确认中间材料后生成。草稿可复制、导出，或通过右键存入知识库。</p>
            <small class="text-[11px] text-accent">{{ actionMeta[action].outcome }}</small>
          </div>
        </div>

        <footer v-if="result" class="row-between gap-2 shrink-0 px-3 h-11 border-t border-line">
          <small class="min-w-0 truncate text-[11px] text-fg-3">右键或 Shift+F10 查看全部操作</small>
          <span class="row gap-1.5 shrink-0">
            <button class="btn-default btn-sm" @click="copy"><AppIcon name="duplicate" :size="13" />复制</button>
            <button class="btn-primary btn-sm" @click="exportDraft"><AppIcon name="download" :size="13" />导出</button>
            <button
              class="center w-7 h-7 rounded-sm text-fg-3 hover:bg-surface-2 hover:text-fg"
              aria-label="草稿更多操作"
              aria-haspopup="menu"
              :aria-expanded="Boolean(outputContextMenu)"
              @click.stop="openOutputContextMenu($event)"
            >
              <AppIcon name="more" :size="15" />
            </button>
          </span>
        </footer>
      </aside>
    </section>

    <Teleport to="body">
      <div
        v-if="outputContextMenu"
        ref="outputMenuElement"
        class="menu-panel w-60"
        role="menu"
        aria-label="AI 草稿操作"
        :style="{ left: `${outputContextMenu.x}px`, top: `${outputContextMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleOutputMenuKeydown"
      >
        <p class="menu-title">AI 草稿<small class="font-normal">仅在你确认后执行</small></p>
        <button class="menu-item" role="menuitem" @click="copyFromOutputMenu">复制 Markdown</button>
        <button class="menu-item" role="menuitem" @click="saveDraftToKnowledge">存入本地知识库</button>
        <button class="menu-item" role="menuitem" @click="exportFromOutputMenu">导出为 Markdown…</button>
      </div>
    </Teleport>
  </div>
</template>
