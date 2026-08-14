<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { actionLabels, aiErrorMessage, getSessionApiKey, makeAiPayload, runAi, type AiAction } from '@/lib/ai'
import { isDesktop } from '@/lib/native'
import type { StudyDocument } from '@/types'
import { useWorkbenchStore } from '@/stores/workbench'
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps<{ document: StudyDocument }>()
const emit = defineEmits<{ insert: [content: string] }>()
const store = useWorkbenchStore()
const action = ref<AiAction>('hint')
const open = ref(false)
const running = ref(false)
const result = ref('')
const error = ref('')
const profileId = ref('')
const drawerId = 'knitspace-ai-assist-drawer'
let activeController: AbortController | undefined
const selectedProfile = computed(() => store.aiProfiles.find((profile) => profile.id === profileId.value) ?? store.aiProfiles[0])
const payload = computed(() => makeAiPayload(props.document, action.value))

async function run() {
  if (running.value) return
  error.value = ''; result.value = ''
  const profile = selectedProfile.value
  if (!profile) { error.value = '先到设置页配置一个 OpenAI 兼容服务。'; return }
  const key = getSessionApiKey(profile.id)
  if (!isDesktop() && !key) { error.value = '浏览器开发模式需要在设置页重新输入一次 Session API Key；桌面版会从系统凭据库读取。'; return }
  const controller = new AbortController()
  activeController = controller
  running.value = true
  try { result.value = await runAi(profile, key, props.document, action.value, undefined, controller.signal) || '服务没有返回文本。' }
  catch (reason) { error.value = aiErrorMessage(reason) }
  finally { if (activeController === controller) activeController = undefined; running.value = false }
}
function cancelRun() { if (!activeController?.signal.aborted) { error.value = '正在停止本次 AI 请求…'; activeController?.abort() } }
async function copyResult() { if(!result.value)return;try{await navigator.clipboard.writeText(result.value)}catch(reason){error.value=reason instanceof Error?reason.message:'系统剪贴板暂时不可用。'} }
function close() { open.value = false }
onBeforeUnmount(() => activeController?.abort())
</script>

<!--
  A launcher that stays out of the way and a panel that opens above it, both
  anchored to the bottom-right corner of the window. `flex-col-reverse` is what
  puts the panel above the button while keeping the button first in the DOM, so
  focus still lands on the control that opened the dialog.

  The panel is an ordinary `panel`, not a tinted gradient card: it floats over
  the user's own Markdown, and a surface that is nearly the editor's colour is
  the one thing it cannot be.
-->
<template>
  <aside class="fixed right-5 bottom-5 z-100 flex flex-col-reverse items-end gap-2.5">
    <button class="btn-primary shadow-lg" type="button" :aria-expanded="open" :aria-controls="drawerId" @click="open = !open" @keydown.esc.stop.prevent="close"><AppIcon name="sparkle" :size="15" /><span>AI 辅助</span></button>
    <section v-if="open" :id="drawerId" class="stack gap-3 w-[min(24rem,calc(100vw_-_2.5rem))] max-h-[min(42.75rem,calc(100vh_-_5.5rem))] overflow-y-auto p-3.5 panel shadow-lg" role="dialog" aria-modal="false" aria-label="AI 辅助草稿" tabindex="-1" @keydown.esc.stop="close">
      <header class="flex items-start justify-between gap-3 shrink-0 pb-3 border-b border-line">
        <div class="stack gap-1 min-w-0">
          <p class="eyebrow">上下文操作 · 需手动触发</p>
          <h3 class="text-[15px] font-semibold leading-snug text-fg">只在你点击时，发出你选的文本。</h3>
        </div>
        <button class="center w-7 h-7 shrink-0 rounded-sm text-fg-3 hover:bg-surface-2 hover:text-fg" type="button" aria-label="关闭 AI 辅助" title="关闭（Esc）" @click="close"><AppIcon name="close" :size="16" /></button>
      </header>
      <div class="grid grid-cols-3 gap-1.5 shrink-0">
        <button
          v-for="item in Object.keys(actionLabels) as AiAction[]"
          :key="item"
          type="button"
          class="center h-8 px-1.5 rounded-sm text-[12px] transition-colors duration-120"
          :class="action === item ? 'bg-accent-soft text-accent font-medium' : 'bg-surface-2 text-fg-2 hover:bg-surface-3 hover:text-fg'"
          @click="action = item"
        >{{ actionLabels[item] }}</button>
      </div>
      <label v-if="store.aiProfiles.length" class="stack gap-1.5 shrink-0 text-[12px] font-medium text-fg-2">使用配置<select v-model="profileId" class="field h-8 px-2 text-[12px]"><option value="">{{ selectedProfile?.label }}</option><option v-for="profile in store.aiProfiles" :key="profile.id" :value="profile.id">{{ profile.label }}</option></select></label>
      <details class="shrink-0"><summary class="row gap-1.5 h-7 -mx-1.5 px-1.5 rounded-sm list-none cursor-pointer text-[12px] text-fg-3 transition-colors duration-120 hover:bg-surface-2 hover:text-fg">查看本次发送内容</summary><pre class="mt-1.5 max-h-40 overflow-auto p-2.5 rounded-sm well font-mono text-[11px] leading-relaxed text-fg-2 whitespace-pre-wrap break-all">{{ JSON.stringify(payload, null, 2) }}</pre></details>
      <button class="w-full shrink-0" :class="running ? 'btn-danger' : 'btn-primary'" @click="running ? cancelRun() : run()">{{ running ? '停止等待' : actionLabels[action] }}</button>
      <p v-if="error" class="shrink-0 pl-2.5 border-l-2 border-l-danger text-[12px] leading-relaxed text-danger" role="alert">{{ error }}</p>
      <article v-if="result" class="stack gap-2 shrink-0 p-2.5 rounded-md well" aria-live="polite"><p class="eyebrow">DRAFT · 需要你确认</p><pre class="max-h-64 overflow-auto font-ui text-[12px] leading-relaxed text-fg whitespace-pre-wrap break-words">{{ result }}</pre><div class="row justify-end gap-2"><button class="btn-default btn-sm" type="button" @click="copyResult">复制</button><button class="btn-primary btn-sm" type="button" @click="emit('insert', result)">插入正文</button></div></article>
    </section>
  </aside>
</template>
