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

<template>
  <aside class="ai-assist" :class="{ open }">
    <button class="ai-tab" type="button" :aria-expanded="open" :aria-controls="drawerId" @click="open = !open" @keydown.esc.stop.prevent="close"><AppIcon name="sparkle" :size="15" /><span>AI 辅助</span></button>
    <section v-if="open" :id="drawerId" class="ai-drawer" role="dialog" aria-modal="false" aria-label="AI 辅助草稿" tabindex="-1" @keydown.esc.stop="close">
      <header><div><p class="eyebrow">上下文操作 · 需手动触发</p><h3>只在你点击时，发出你选的文本。</h3></div><button type="button" aria-label="关闭 AI 辅助" title="关闭（Esc）" @click="close"><AppIcon name="close" :size="16" /></button></header>
      <div class="ai-actions"><button v-for="item in Object.keys(actionLabels) as AiAction[]" :key="item" type="button" :class="{ active: action === item }" @click="action = item">{{ actionLabels[item] }}</button></div>
      <label v-if="store.aiProfiles.length">使用配置<select v-model="profileId"><option value="">{{ selectedProfile?.label }}</option><option v-for="profile in store.aiProfiles" :key="profile.id" :value="profile.id">{{ profile.label }}</option></select></label>
      <details><summary>查看本次发送内容</summary><pre>{{ JSON.stringify(payload, null, 2) }}</pre></details>
      <button class="primary-button wide" :class="{ 'ai-cancel': running }" @click="running ? cancelRun() : run()">{{ running ? '停止等待' : actionLabels[action] }}</button>
      <p v-if="error" class="ai-error" role="alert">{{ error }}</p>
      <article v-if="result" class="ai-result" aria-live="polite"><p class="eyebrow">DRAFT · 需要你确认</p><pre>{{ result }}</pre><div><button class="quiet-button" type="button" @click="copyResult">复制</button><button class="primary-button" type="button" @click="emit('insert', result)">插入正文</button></div></article>
    </section>
  </aside>
</template>
