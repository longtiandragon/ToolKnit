<script setup lang="ts">
import { computed, ref } from 'vue'
import { actionLabels, getSessionApiKey, makeAiPayload, runAi, type AiAction } from '@/lib/ai'
import { isDesktop } from '@/lib/native'
import type { StudyDocument } from '@/types'
import { useWorkbenchStore } from '@/stores/workbench'

const props = defineProps<{ document: StudyDocument }>()
const emit = defineEmits<{ insert: [content: string] }>()
const store = useWorkbenchStore()
const action = ref<AiAction>('hint')
const open = ref(false)
const running = ref(false)
const result = ref('')
const error = ref('')
const profileId = ref('')
const selectedProfile = computed(() => store.aiProfiles.find((profile) => profile.id === profileId.value) ?? store.aiProfiles[0])
const payload = computed(() => makeAiPayload(props.document, action.value))

async function run() {
  error.value = ''; result.value = ''
  const profile = selectedProfile.value
  if (!profile) { error.value = '先到设置页配置一个 OpenAI 兼容服务。'; return }
  const key = getSessionApiKey(profile.id)
  if (!isDesktop() && !key) { error.value = '浏览器开发模式需要在设置页重新输入一次 Session API Key；桌面版会从系统凭据库读取。'; return }
  running.value = true
  try { result.value = await runAi(profile, key, props.document, action.value) || '服务没有返回文本。' }
  catch (reason) { error.value = reason instanceof Error ? reason.message : 'AI 请求失败。' }
  finally { running.value = false }
}
async function copyResult() { if (result.value) await navigator.clipboard.writeText(result.value) }
</script>

<template>
  <aside class="ai-assist" :class="{ open }"><button class="ai-tab" @click="open = !open"><span>✦</span> AI 辅助</button><section v-if="open" class="ai-drawer"><header><div><p class="eyebrow">EXPLICIT CONTEXT ACTION</p><h3>只在你点击时，发出你选的文本。</h3></div><button @click="open = false">×</button></header><div class="ai-actions"><button v-for="item in Object.keys(actionLabels) as AiAction[]" :key="item" :class="{ active: action === item }" @click="action = item">{{ actionLabels[item] }}</button></div><label v-if="store.aiProfiles.length">使用配置<select v-model="profileId"><option value="">{{ selectedProfile?.label }}</option><option v-for="profile in store.aiProfiles" :key="profile.id" :value="profile.id">{{ profile.label }}</option></select></label><details><summary>查看本次发送内容</summary><pre>{{ JSON.stringify(payload, null, 2) }}</pre></details><button class="primary-button wide" :disabled="running" @click="run">{{ running ? '正在请求…' : actionLabels[action] }}</button><p v-if="error" class="ai-error">{{ error }}</p><article v-if="result" class="ai-result"><p class="eyebrow">DRAFT · 需要你确认</p><pre>{{ result }}</pre><div><button class="quiet-button" @click="copyResult">复制</button><button class="primary-button" @click="emit('insert', result)">插入正文</button></div></article></section></aside>
</template>
