<script setup lang="ts">
import { ref } from 'vue'
import { v7 as uuid } from 'uuid'
import { storeApiKey } from '@/lib/native'
import { useWorkbenchStore } from '@/stores/workbench'

const store = useWorkbenchStore()
const label = ref('我的兼容 API')
const baseUrl = ref('https://api.openai.com/v1')
const model = ref('')
const apiKey = ref('')
const profileMessage = ref('')
const engineMessage = ref('')

function validateEndpoint(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname) } catch { return false }
}
async function saveProfile() {
  if (!validateEndpoint(baseUrl.value)) { profileMessage.value = '远程地址必须使用 HTTPS；仅 localhost 可以使用 HTTP。'; return }
  if (!model.value.trim()) { profileMessage.value = '填写模型名称后才能保存。'; return }
  const id = uuid()
  try {
    const hasKey = Boolean(apiKey.value.trim())
    if (hasKey) await storeApiKey(id, apiKey.value.trim())
    store.saveAiProfile({ id, label: label.value.trim() || '未命名配置', baseUrl: baseUrl.value.replace(/\/$/, ''), model: model.value.trim(), hasKey })
    apiKey.value = ''; profileMessage.value = '已保存配置。桌面端的 Key 仅写入 Windows Credential Manager。'
  } catch {
    profileMessage.value = '系统凭据库写入失败，未保存 API Key。请检查 Windows 凭据管理器后重试。'
  }
}
function installEngine(engine: 'ocr' | 'formula') {
  const job = store.addJob('download', `${engine === 'ocr' ? '文字 OCR' : '公式 OCR'} 离线引擎包`)
  store.updateJob(job.id, { status: 'running', progress: 18 })
  window.setTimeout(() => { store.updateJob(job.id, { status: 'succeeded', progress: 100 }); store.setEngine(engine, true); engineMessage.value = `${engine === 'ocr' ? '文字 OCR' : '公式 OCR'} 已标记为可用。发布版将校验上游包 SHA-256 后安装。` }, 900)
}
</script>

<template>
  <div class="settings page-enter"><section class="section-heading"><div><p class="eyebrow">LOCAL CONTROL ROOM</p><h2>所有能力都在你手里。</h2><p>资料在本机，AI 只有在你点击动作后才会被调用。</p></div></section>
    <div class="settings-grid"><section class="panel setting-card"><p class="eyebrow">OPTIONAL ENGINES</p><h3>离线识别引擎</h3><p>基础应用不携带模型。安装后可离线识别，模型包会单独显示来源、版本和许可证。</p><div class="engine-row"><div><b>中英文 OCR</b><span>{{ store.engineInstalled.ocr ? '已安装' : '未安装' }}</span></div><button class="quiet-button" :disabled="store.engineInstalled.ocr" @click="installEngine('ocr')">{{ store.engineInstalled.ocr ? '可用' : '安装' }}</button></div><div class="engine-row"><div><b>公式 → LaTeX</b><span>{{ store.engineInstalled.formula ? '已安装' : '未安装' }}</span></div><button class="quiet-button" :disabled="store.engineInstalled.formula" @click="installEngine('formula')">{{ store.engineInstalled.formula ? '可用' : '安装' }}</button></div><p v-if="engineMessage" class="notice">{{ engineMessage }}</p></section>
      <section class="panel setting-card ai-settings"><p class="eyebrow">BYO AI</p><h3>自带 API，不内置额度</h3><p>只支持 OpenAI 兼容接口。文本会在你点击“解释、提示、错因分析”等动作时发送；不会后台同步资料。</p><label>配置名称<input v-model="label" /></label><label>Base URL<input v-model="baseUrl" placeholder="https://.../v1" /></label><label>模型名称<input v-model="model" placeholder="例如 gpt-4.1-mini / deepseek-chat" /></label><label>API Key<input v-model="apiKey" type="password" placeholder="仅用于写入系统凭据库" /></label><button class="primary-button" @click="saveProfile">保存安全配置</button><p v-if="profileMessage" class="notice">{{ profileMessage }}</p><div v-if="store.aiProfiles.length" class="profile-list"><div v-for="profile in store.aiProfiles" :key="profile.id"><b>{{ profile.label }}</b><span>{{ profile.model }} · {{ profile.hasKey ? '已保存 Key' : '无 Key' }}</span></div></div></section>
      <section class="panel setting-card"><p class="eyebrow">VAULT & BACKUP</p><h3>资料库和备份</h3><p>当前浏览器开发模式使用本地演示数据。Tauri 桌面版会在首次启动时让你选择资料库目录。</p><div class="vault-path">ToolKnitVault/<br /><small>sources · assets · questions · notes · exports</small></div><button class="quiet-button" @click="store.persist()">立即保存本地状态</button></section>
      <section class="panel setting-card policy-card"><p class="eyebrow">PRIVACY PROMISE</p><h3>默认不上传，不做遥测。</h3><ul><li>API Key 不进入 Markdown、备份或 Git。</li><li>模型包、缓存和资料库均被忽略规则排除。</li><li>批处理永远输出新文件，不覆盖原件。</li></ul></section></div>
  </div>
</template>
