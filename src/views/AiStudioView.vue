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
watch([content, action, profileId, () => profile.value?.model], () => { payloadVersion.value += 1 })
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
  <div class="ai-workbench page-enter mx-auto w-full max-w-320 px-8 py-6" @click="closeOutputContextMenu()">
    <PageHeader title="AI 工作台" subtitle="三步走:选任务、确认要发送的材料、校对生成的草稿">
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

    <section class="ai-workbench__flow">
      <aside class="ai-workbench__actions">
        <header><p class="eyebrow">01 · 选择任务</p><h3>这次要得到什么</h3></header>
        <nav aria-label="AI 内容操作">
          <button
            v-for="(label, key) in contentActionLabels"
            :key="key"
            :class="{ active: action === key }"
            :aria-pressed="action === key"
            @click="selectAction(key as ContentAiAction)"
          >
            <b><AppIcon :name="actionMeta[key as ContentAiAction].icon" :size="15" /></b>
            <span><strong>{{ label }}</strong><small>{{ actionMeta[key as ContentAiAction].description }}</small></span>
            <AppIcon name="chevron" :size="13" />
          </button>
        </nav>
        <footer>
          <label for="ai-profile">使用配置</label>
          <select id="ai-profile" v-model="profileId" :disabled="!store.aiProfiles.length">
            <option v-if="!store.aiProfiles.length" value="">尚未配置</option>
            <option v-for="item in store.aiProfiles" :key="item.id" :value="item.id">{{ item.label }} · {{ item.model }}</option>
          </select>
          <RouterLink to="/settings?section=ai">管理 API 与系统凭据</RouterLink>
        </footer>
      </aside>

      <main class="ai-workbench__composer">
        <header>
          <div><p class="eyebrow">02 · 确认输入</p><h3>确认发送的材料</h3></div>
          <div class="ai-workbench__composer-status"><span :class="{ warning: contentNearLimit }">{{ contentSizeLabel }} / 100 万</span><button class="primary-button" :class="{ 'is-cancelling': running }" @click="running ? cancelRun() : run()"><AppIcon :name="running ? 'close' : 'sparkle'" :size="14" />{{ running ? '停止等待' : contentActionLabels[action] }}</button></div>
        </header>
        <FileDropZone
          v-model="inputFiles"
          accept=".txt,.md,.json,.js,.ts,.py,.java,.csv,text/*,application/json"
          :multiple="false"
          :max-file-bytes="AI_MAX_INPUT_FILE_BYTES"
          :max-files="1"
          title="拖入文本、Markdown 或代码"
          hint="读取后仍会放进下方编辑区，由你最终确认"
          @error="error = $event"
        />
        <label class="ai-workbench__editor">
          <span class="visually-hidden">准备发送的文字</span>
          <textarea v-model="content" :maxlength="AI_MAX_CONTENT_CHARS" spellcheck="true" placeholder="粘贴会议记录、课程笔记、邮件草稿、需求说明或代码……" />
        </label>
        <details class="ai-workbench__payload" @toggle="togglePayloadPreview">
          <summary><span><AppIcon name="shield" :size="14" />查看实际请求体</span><small>{{ payloadStale ? '正文、模型或任务已变化 · 需要刷新' : '密钥不会显示' }}</small></summary>
          <div>
            <header><span :title="requestTarget">{{ payloadStale ? '当前预览不是最新请求' : payloadPreviewTruncated ? '请求体预览已安全截断' : '与下一次请求体保持一致' }} · {{ requestTarget }}</span><button type="button" @click="refreshPayloadPreview">刷新预览</button></header>
            <pre>{{ payloadPreview }}</pre>
          </div>
        </details>
        <p v-if="error" class="ai-workbench__error" role="alert"><AppIcon name="warning" :size="15" />{{ error }}</p>
        <footer>
          <p><AppIcon name="shield" :size="15" /><span><b>需要你主动发送</b><small>结果只进入右侧草稿区，不自动写入任何文档。</small></span></p>
          <button type="button" class="quiet-button" :disabled="running || (!content && !inputFiles.length)" @click="clearInput">清空材料</button>
        </footer>
      </main>

      <aside
        ref="outputPanelElement"
        class="ai-workbench__result ai-output-panel--interactive"
        tabindex="0"
        :aria-busy="running"
        aria-label="AI 草稿结果；右键或 Shift 加 F10 打开操作菜单"
        @contextmenu="openOutputContextMenu"
        @keydown="openOutputContextFromKeyboard"
      >
        <header>
          <div><p class="eyebrow">03 · 校对草稿</p><h3>人工确认草稿</h3></div>
          <span>{{ result ? contentActionLabels[resultAction] : '等待生成' }}</span>
        </header>
        <div v-if="running" class="ai-workbench__running" role="status"><i /><span><b>正在生成新的草稿</b><small>你仍可阅读上一次结果；完成后会原位替换。</small></span></div>
        <MarkdownContent v-if="result" class="ai-workbench__result-text" :source="result" compact />
        <div v-else class="ai-workbench__empty">
          <b><AppIcon name="file-text" :size="24" /></b>
          <strong>结果会留在这里，等你决定下一步</strong>
          <p>选择左侧任务、确认中间材料后生成。草稿可复制、导出，或通过右键存入知识库。</p>
          <span>{{ actionMeta[action].outcome }}</span>
        </div>
        <footer v-if="result">
          <span>右键或 Shift+F10 查看全部操作</span>
          <div><button class="quiet-button" @click="copy"><AppIcon name="copy" :size="14" />复制</button><button class="primary-button" @click="exportDraft"><AppIcon name="download" :size="14" />导出 Markdown</button><button class="more-button ai-output-more" aria-label="草稿更多操作" aria-haspopup="menu" :aria-expanded="Boolean(outputContextMenu)" @click.stop="openOutputContextMenu($event)">•••</button></div>
        </footer>
      </aside>
    </section>

    <Teleport to="body"><div v-if="outputContextMenu" ref="outputMenuElement" class="ai-output-context-menu" role="menu" aria-label="AI 草稿操作" :style="{left:`${outputContextMenu.x}px`,top:`${outputContextMenu.y}px`}" @click.stop @contextmenu.prevent @keydown.stop="handleOutputMenuKeydown"><p>AI 草稿 <small>仅在你确认后执行</small></p><button role="menuitem" @click="copyFromOutputMenu">复制 Markdown</button><button role="menuitem" @click="saveDraftToKnowledge">存入本地知识库</button><button role="menuitem" @click="exportFromOutputMenu">导出为 Markdown…</button></div></Teleport>
  </div>
</template>

<style scoped>
.ai-workbench{width:min(1220px,100%);margin:0 auto;padding:26px 28px 56px;color:var(--text)}
.ai-workbench__hero{display:grid;grid-template-columns:minmax(0,1fr) 260px;overflow:hidden;box-shadow:0 18px 42px var(--accent-soft)}
.ai-workbench__hero:before{display:none}
.ai-workbench__hero>div{position:relative;z-index:1;display:grid;align-content:center;padding:28px 34px}
.ai-workbench__hero .eyebrow{}.ai-workbench__hero h2{max-width:720px;margin:7px 0 9px;font:710 clamp(27px,3vw,40px)/1.14 var(--font-display);letter-spacing:-.045em}.ai-workbench__hero h2 em{font-style:normal}.ai-workbench__hero>div>p:last-child{max-width:690px;margin:0;font-size:11px;line-height:1.75}
.ai-workbench__hero>aside{position:relative;z-index:1;display:grid;align-content:center;gap:6px;padding:25px;border-left:1px solid var(--surface-2);}.ai-workbench__hero>aside>span{display:flex;align-items:center;gap:7px;font:700 9px var(--font-mono);letter-spacing:.06em}.ai-workbench__hero>aside strong{margin-top:5px;font:700 20px var(--font-display)}.ai-workbench__hero>aside small{overflow:hidden;font:9px/1.5 var(--font-mono);text-overflow:ellipsis;white-space:nowrap}.ai-workbench__hero>aside a{display:flex;width:max-content;align-items:center;gap:6px;margin-top:8px;font:700 10px var(--font-ui)}.ai-workbench__hero>aside a:hover{}
.ai-workbench__flow{display:grid;grid-template-columns:205px minmax(300px,1.05fr) minmax(300px,.95fr);align-items:stretch;margin-top:15px;overflow:hidden;border:1px solid var(--accent-soft);border-radius:17px;background:var(--surface-2);box-shadow:0 12px 32px var(--accent-soft)}
.ai-workbench__actions,.ai-workbench__composer,.ai-workbench__result{min-width:0}.ai-workbench__actions{display:flex;min-height:575px;flex-direction:column;border-right:1px solid var(--line-weak);background:linear-gradient(180deg,var(--accent-soft),var(--surface-2))}.ai-workbench__actions>header,.ai-workbench__composer>header,.ai-workbench__result>header{padding:17px 18px 14px;border-bottom:1px solid var(--line-weak)}.ai-workbench__actions h3,.ai-workbench__composer h3,.ai-workbench__result h3{margin:4px 0 0;font:700 17px var(--font-display)}.ai-workbench__actions nav{display:grid;padding:8px}.ai-workbench__actions nav button{display:grid;width:100%;min-height:62px;grid-template-columns:29px minmax(0,1fr) 13px;align-items:center;gap:8px;padding:8px;border:1px solid transparent;border-radius:10px;color:var(--text-secondary);background:transparent;text-align:left}.ai-workbench__actions nav button:hover,.ai-workbench__actions nav button:focus-visible{border-color:var(--accent-soft);color:var(--green-strong);background:var(--surface-2)}.ai-workbench__actions nav button.active{border-color:var(--accent-soft);color:var(--green-strong);background:var(--surface);box-shadow:inset 3px 0 var(--green),0 5px 14px var(--accent-soft)}.ai-workbench__actions nav button>b{display:grid;width:29px;height:29px;place-items:center;border-radius:8px;color:var(--green-strong);background:var(--green-bg)}.ai-workbench__actions nav button>span{display:grid;min-width:0;gap:3px}.ai-workbench__actions nav strong{font:680 10px var(--font-ui)}.ai-workbench__actions nav small{overflow:hidden;color:var(--muted);font-size:8px;text-overflow:ellipsis;white-space:nowrap}.ai-workbench__actions nav button>.app-icon{color:var(--muted)}
.ai-workbench__actions>footer{display:grid;gap:6px;margin-top:auto;padding:14px;border-top:1px solid var(--line-weak)}.ai-workbench__actions>footer label{color:var(--muted);font:700 8px var(--font-mono);letter-spacing:.05em}.ai-workbench__actions select{width:100%;min-width:0;height:34px;padding:0 8px;border:1px solid var(--line);border-radius:7px;color:var(--text-secondary);background:var(--surface);font-size:9px}.ai-workbench__actions>footer a{margin-top:3px;color:var(--green-strong);font:700 9px var(--font-ui)}
.ai-workbench__composer{display:flex;min-height:575px;flex-direction:column;padding:0 16px 15px;border-right:1px solid var(--line-weak)}.ai-workbench__composer>header{display:flex;align-items:flex-end;justify-content:space-between;margin:0 -16px 13px}.ai-workbench__composer>header>span,.ai-workbench__result>header>span{flex:0 0 auto;padding:4px 7px;border-radius:999px;color:var(--green-strong);background:var(--green-bg);font:700 8px var(--font-mono)}.ai-workbench__editor{display:flex;min-height:0;flex:1;margin-top:10px}.ai-workbench__editor textarea{width:100%;min-height:220px;flex:1;padding:14px;border:1px solid var(--line);border-radius:11px;outline:0;color:var(--text);background:var(--surface-2);font:12px/1.75 var(--font-mono);resize:vertical}.ai-workbench__editor textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}.ai-workbench__editor textarea::placeholder{color:var(--text-disabled)}
.ai-workbench__payload{margin-top:9px;overflow:hidden;border:1px solid var(--line-weak);border-radius:9px;background:var(--accent-soft)}.ai-workbench__payload summary{display:flex;min-height:35px;align-items:center;justify-content:space-between;gap:10px;padding:0 10px;cursor:pointer;list-style:none}.ai-workbench__payload summary::-webkit-details-marker{display:none}.ai-workbench__payload summary>span{display:flex;align-items:center;gap:6px;color:var(--text-secondary);font:650 9px var(--font-ui)}.ai-workbench__payload summary small{color:var(--muted);font:8px var(--font-mono)}.ai-workbench__payload>div{border-top:1px solid var(--line-weak)}.ai-workbench__payload>div>header{display:flex;align-items:center;justify-content:space-between;padding:7px 9px;color:var(--muted);font-size:8px}.ai-workbench__payload>div button{padding:0;border:0;color:var(--green-strong);background:transparent;font:700 8px var(--font-ui)}.ai-workbench__payload pre{max-height:150px;overflow:auto;margin:0;padding:10px;color:var(--accent-fg);background:var(--accent);font:9px/1.65 var(--font-mono);white-space:pre-wrap;overflow-wrap:anywhere}.ai-workbench__error{display:flex;align-items:flex-start;gap:7px;margin:9px 0 0;padding:9px 10px;border-left:3px solid var(--danger);color:var(--danger);background:var(--danger-soft);font-size:9px;line-height:1.55}.ai-workbench__composer>footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px}.ai-workbench__composer>footer>p{display:flex;min-width:0;align-items:flex-start;gap:7px;color:var(--green-strong)}.ai-workbench__composer>footer>p>span{display:grid;gap:2px}.ai-workbench__composer>footer b{color:var(--text-secondary);font:650 9px var(--font-ui)}.ai-workbench__composer>footer small{color:var(--muted);font-size:8px;line-height:1.4}.ai-workbench__composer>footer>div{display:flex;flex:0 0 auto;gap:7px}.ai-workbench__composer button{gap:6px;font-size:9px}
.ai-workbench__result{position:relative;display:flex;min-height:575px;flex-direction:column;background:linear-gradient(145deg,var(--surface-2),var(--surface-2))}.ai-workbench__result>header{display:flex;align-items:flex-end;justify-content:space-between}.ai-workbench__result-text{min-height:0;flex:1;overflow:auto;padding:18px 20px;color:var(--text);font-size:11px;line-height:1.8}.ai-workbench__empty{display:grid;flex:1;place-items:center;align-content:center;justify-items:center;gap:8px;padding:34px;text-align:center}.ai-workbench__empty>b{display:grid;width:50px;height:50px;place-items:center;border:1px solid var(--accent-soft);border-radius:15px;color:var(--green-strong);background:var(--green-bg)}.ai-workbench__empty strong{max-width:310px;font:700 16px/1.4 var(--font-display)}.ai-workbench__empty p{max-width:330px;margin:0;color:var(--muted);font-size:10px;line-height:1.65}.ai-workbench__empty>span{margin-top:4px;padding:5px 8px;border-radius:999px;color:var(--green-strong);background:var(--accent-soft);font:700 8px var(--font-mono)}.ai-workbench__running{display:flex;align-items:center;gap:9px;margin:10px 12px 0;padding:9px 10px;border:1px solid var(--accent-soft);border-radius:9px;color:var(--green-strong);background:var(--green-bg)}.ai-workbench__running>i{width:15px;height:15px;border:2px solid var(--accent-soft);border-top-color:var(--green);border-radius:50%;animation:ai-workbench-spin .8s linear infinite}.ai-workbench__running>span{display:grid;gap:2px}.ai-workbench__running b{font-size:9px}.ai-workbench__running small{color:var(--muted);font-size:8px}.ai-workbench__result>footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-top:1px solid var(--line-weak);background:var(--surface-2)}.ai-workbench__result>footer>span{color:var(--muted);font:8px var(--font-mono)}.ai-workbench__result>footer>div{display:flex;gap:6px}.ai-workbench__result>footer button{gap:6px;min-height:32px;font-size:9px}
@keyframes ai-workbench-spin{to{transform:rotate(1turn)}}
@media(max-width:1120px){.ai-workbench{padding-inline:22px}.ai-workbench__flow{grid-template-columns:190px minmax(0,1fr)}.ai-workbench__result{grid-column:1/-1;min-height:360px;border-top:1px solid var(--line-weak)}.ai-workbench__composer{border-right:0}.ai-workbench__actions{min-height:560px}.ai-workbench__composer{min-height:560px}}
@media(max-width:760px){.ai-workbench{padding:18px 14px 42px}.ai-workbench__hero{}.ai-workbench__hero>aside{border-top:1px solid var(--surface-2);border-left:0}.ai-workbench__flow{grid-template-columns:1fr}.ai-workbench__actions{min-height:0}.ai-workbench__actions nav{grid-template-columns:repeat(2,minmax(0,1fr))}.ai-workbench__actions>footer{margin-top:0}.ai-workbench__composer{min-height:520px}.ai-workbench__composer>footer,.ai-workbench__result>footer{align-items:flex-start;flex-direction:column}.ai-workbench__composer>footer>div,.ai-workbench__result>footer>div{width:100%}.ai-workbench__composer>footer button,.ai-workbench__result>footer button{flex:1}.ai-workbench__payload summary small{display:none}}
@media(prefers-reduced-motion:reduce){.ai-workbench__running>i{animation:none}}

/* Keep the primary action visible at the top of the desktop input surface.
   Auxiliary labels stay at least 9 px even in the dense three-pane layout. */
.ai-workbench__composer>header{gap:12px}
.ai-workbench__composer-status{display:flex;flex:0 0 auto;align-items:center;gap:7px}
.ai-workbench__composer-status>span{padding:4px 7px;border-radius:999px;color:var(--green-strong);background:var(--green-bg);font:700 9px var(--font-mono)}
.ai-workbench__composer-status>span.warning{color:var(--warn);background:var(--warn-soft)}
.ai-workbench__composer-status .primary-button{min-height:31px;padding-inline:9px;font-size:9px}
.ai-workbench__composer-status .primary-button.is-cancelling{border-color:var(--danger-soft);color:var(--danger);background:var(--danger-soft);box-shadow:none}
.ai-workbench__payload>div>header>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ai-workbench__actions nav small,.ai-workbench__actions>footer label,.ai-workbench__payload summary small,.ai-workbench__payload>div>header,.ai-workbench__composer>footer small,.ai-workbench__running small,.ai-workbench__result>header>span,.ai-workbench__result>footer>span{font-size:9px}
.ai-workbench__payload>div button,.ai-workbench__empty>span{font-size:9px}
</style>
