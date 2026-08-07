<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { v7 as uuid } from 'uuid'
import { storeApiKey } from '@/lib/native'
import { setSessionApiKey } from '@/lib/ai'
import { downloadText } from '@/lib/code-image'
import { useWorkbenchStore } from '@/stores/workbench'

const store = useWorkbenchStore()
const label = ref('我的兼容 API')
const baseUrl = ref('https://api.openai.com/v1')
const model = ref('')
const apiKey = ref('')
const profileMessage = ref('')
const backupInput = ref<HTMLInputElement>()
const backupMessage = ref('')

function validateEndpoint(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname) } catch { return false }
}
async function saveProfile() {
  if (!validateEndpoint(baseUrl.value)) { profileMessage.value = '远程地址必须使用 HTTPS；仅 localhost 可以使用 HTTP。'; return }
  if (!model.value.trim()) { profileMessage.value = '填写模型名称后才能保存。'; return }
  const id = uuid()
  try {
    const hasKey = Boolean(apiKey.value.trim())
    if (hasKey) { await storeApiKey(id, apiKey.value.trim()); setSessionApiKey(id, apiKey.value.trim()) }
    store.saveAiProfile({ id, label: label.value.trim() || '未命名配置', baseUrl: baseUrl.value.replace(/\/$/, ''), model: model.value.trim(), hasKey })
    apiKey.value = ''; profileMessage.value = '已保存配置。桌面端的 Key 仅写入 Windows Credential Manager。'
  } catch {
    profileMessage.value = '系统凭据库写入失败，未保存 API Key。请检查 Windows 凭据管理器后重试。'
  }
}
function downloadBackup() { downloadText(`toolknit-${new Date().toISOString().slice(0, 10)}.toolknit-backup.json`, store.exportBrowserBackup(), 'application/json'); backupMessage.value = '浏览器版备份已下载。桌面版会生成包含原始文件的 .toolknit-backup。' }
async function restoreBackup(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; try { store.restoreBrowserBackup(await file.text()); backupMessage.value = '已恢复浏览器版资料库。'; } catch (error) { backupMessage.value = error instanceof Error ? error.message : '恢复失败。' } }
</script>

<template>
  <div class="settings page-enter"><section class="page-heading"><div><p class="eyebrow">CONTROL ROOM</p><h2>权限、数据与服务，<em>都由你决定。</em></h2><p>正式功能不会把本地文件和密钥悄悄送往网络。</p></div></section>
    <div class="settings-grid"><section class="panel setting-card"><p class="eyebrow">ENGINE ROADMAP</p><h3>识别引擎状态</h3><p>离线 OCR 与公式识别尚在实验室阶段，因此正式工具区不会显示“安装”或“可用”的假状态。</p><div class="engine-row"><div><b>本地中英文 OCR</b><span>待接入：受控 sidecar、模型校验、许可证清单</span></div><RouterLink class="quiet-button" to="/lab">查看实验室</RouterLink></div><div class="engine-row"><div><b>公式 → LaTeX</b><span>待接入：用户确认的视觉 API 草稿流程</span></div><RouterLink class="quiet-button" to="/lab">查看实验室</RouterLink></div></section>
      <section class="panel setting-card ai-settings"><p class="eyebrow">BYO AI</p><h3>自带 API，不内置额度</h3><p>只支持 OpenAI 兼容接口。文本会在你点击“解释、提示、错因分析”等动作时发送；不会后台同步资料。</p><label>配置名称<input v-model="label" /></label><label>Base URL<input v-model="baseUrl" placeholder="https://.../v1" /></label><label>模型名称<input v-model="model" placeholder="例如 gpt-4.1-mini / deepseek-chat" /></label><label>API Key<input v-model="apiKey" type="password" placeholder="仅用于写入系统凭据库" /></label><button class="primary-button" @click="saveProfile">保存安全配置</button><p v-if="profileMessage" class="notice">{{ profileMessage }}</p><div v-if="store.aiProfiles.length" class="profile-list"><div v-for="profile in store.aiProfiles" :key="profile.id"><b>{{ profile.label }}</b><span>{{ profile.model }} · {{ profile.hasKey ? '已保存 Key' : '无 Key' }}</span></div></div></section>
      <section class="panel setting-card"><p class="eyebrow">VAULT & BACKUP</p><h3>资料库和备份</h3><p>当前浏览器开发模式使用本地演示数据。Tauri 桌面版会在首次启动时让你选择资料库目录。</p><div class="vault-path">ToolKnitVault/<br /><small>sources · assets · questions · notes · exports</small></div><div class="backup-actions"><button class="quiet-button" @click="downloadBackup">导出浏览器备份</button><button class="quiet-button" @click="backupInput?.click()">恢复备份</button><input ref="backupInput" class="visually-hidden" type="file" accept=".json,.toolknit-backup.json" @change="restoreBackup" /></div><p v-if="backupMessage" class="notice">{{ backupMessage }}</p></section>
      <section class="panel setting-card policy-card"><p class="eyebrow">PRIVACY PROMISE</p><h3>默认不上传，不做遥测。</h3><ul><li>API Key 不进入 Markdown、备份或 Git。</li><li>模型包、缓存和资料库均被忽略规则排除。</li><li>批处理永远输出新文件，不覆盖原件。</li></ul></section></div>
  </div>
</template>
