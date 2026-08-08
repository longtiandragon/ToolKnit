<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { checkDesktopUpdate, isDesktop, openExternalUrl, removeApiKey, setClipboardMonitor, storeApiKey, type GitHubRelease } from '@/lib/native'
import { chooseOutputDirectory } from '@/lib/output'
import { newId } from '@/lib/id'
import { removeSessionApiKey, setSessionApiKey } from '@/lib/ai'
import { downloadText } from '@/lib/code-image'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import AppBreadcrumbs from '@/components/AppBreadcrumbs.vue'

const store = useWorkbenchStore()
const ui = useUiStore()
const route=useRoute()
const label = ref('我的兼容 API')
const baseUrl = ref('https://api.openai.com/v1')
const model = ref('')
const apiKey = ref('')
const profileMessage = ref('')
const backupInput = ref<HTMLInputElement>()
const backupMessage = ref('')
const pendingProfileDelete = ref('')
const desktop = isDesktop()
const appVersion = __APP_VERSION__
const updateResult = ref<GitHubRelease>()
const updateMessage = ref('')
const checkingUpdate = ref(false)

function validateEndpoint(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname) } catch { return false }
}
async function saveProfile() {
  if (!validateEndpoint(baseUrl.value)) { profileMessage.value = '远程地址必须使用 HTTPS；仅 localhost 可以使用 HTTP。'; return }
  if (!model.value.trim()) { profileMessage.value = '填写模型名称后才能保存。'; return }
  const id = newId()
  try {
    const suppliedKey = Boolean(apiKey.value.trim())
    let persistedKey = false
    if (suppliedKey) { persistedKey = await storeApiKey(id, apiKey.value.trim()); setSessionApiKey(id, apiKey.value.trim()) }
    store.saveAiProfile({ id, label: label.value.trim() || '未命名配置', baseUrl: baseUrl.value.replace(/\/$/, ''), model: model.value.trim(), hasKey: persistedKey })
    apiKey.value = ''
    profileMessage.value = persistedKey ? '配置已保存；API Key 已写入系统凭据库。' : suppliedKey ? '配置已保存；浏览器模式下 API Key 只保留到当前标签页关闭。' : '配置已保存，但尚未提供 API Key。'
  } catch {
    profileMessage.value = '系统凭据库写入失败，未保存 API Key。请检查 Windows 凭据管理器后重试。'
  }
}
async function deleteProfile(id: string, label: string, hasKey: boolean) {
  if (pendingProfileDelete.value !== id) { pendingProfileDelete.value = id; profileMessage.value = `再次点击“确认删除”以移除“${label}”${hasKey ? '及其系统凭据' : ''}。`; return }
  try {
    if (hasKey) await removeApiKey(id)
    removeSessionApiKey(id)
    store.removeAiProfile(id)
    pendingProfileDelete.value = ''
    profileMessage.value = `已删除配置“${label}”。`
  } catch { profileMessage.value = '系统凭据删除失败，配置仍然保留。请稍后重试。' }
}
function downloadBackup() { downloadText(`toolknit-${new Date().toISOString().slice(0, 10)}.toolknit-backup.json`, store.exportBrowserBackup(), 'application/json'); store.updateSettings({ lastBackupAt: new Date().toISOString() }); store.addActivity('backup','导出工作区备份','不包含 API Key、剪贴板和原始文件'); backupMessage.value = '工作区 JSON 备份已下载；不包含 API Key、剪贴板或原始文件。' }
async function restoreBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    if (!await ui.confirm({ title:'恢复工作区？', message:'恢复会替换当前工作区中的资料、笔记、任务、收藏和设置，剪贴板历史不受影响。', danger:true, confirmLabel:'确认恢复' })) { backupMessage.value = '已取消恢复，当前资料未修改。'; return }
    const restored = store.restoreBrowserBackup(await file.text())
    backupMessage.value = `恢复完成：${restored.sources} 份资料、${restored.documents} 篇文档、${restored.recipes} 个配方。`
  } catch (error) { backupMessage.value = error instanceof Error ? error.message : '恢复失败，当前资料未修改。' }
  finally { input.value = '' }
}
async function pickOutputDirectory() { const path = await chooseOutputDirectory(); if (path) { store.updateSettings({ outputDirectory:path }); ui.toast('默认输出目录已更新',path,'success') } }
async function changeClipboardEnabled() { store.updateSettings({ clipboardEnabled:!store.settings.clipboardEnabled, clipboardPaused:false }); await setClipboardMonitor(store.settings.clipboardEnabled,false) }
async function checkUpdate() { checkingUpdate.value=true; updateMessage.value=''; try { const release=await checkDesktopUpdate(); store.updateSettings({lastUpdateCheck:new Date().toISOString()}); if(!release){updateMessage.value='浏览器模式无法检查桌面版本。';return} updateResult.value=release; updateMessage.value=release.tag_name.replace(/^v/,'')===__APP_VERSION__?'当前已是最新版本。':`发现新版本 ${release.tag_name}，安装包将在 GitHub Releases 中提供。` } catch(error){updateMessage.value=error instanceof Error?error.message:'检查更新失败，请确认网络连接。'} finally{checkingUpdate.value=false} }
async function focusSection(){const section=typeof route.query.section==='string'?route.query.section:'';if(!section)return;await nextTick();document.getElementById(section)?.scrollIntoView({behavior:'smooth',block:'start'})}
watch(()=>route.query.section,focusSection)
onMounted(()=>{store.pruneClipboard();focusSection()})
</script>

<template>
  <div class="settings page-enter"><AppBreadcrumbs :items="[{label:'设置',to:'/'},{label:'配置与备份'}]"/><section class="page-heading"><div><p class="eyebrow">CONTROL ROOM</p><h2>权限、数据与服务，<em>都由你决定。</em></h2><p>正式功能不会把本地文件和密钥悄悄送往网络。</p></div></section>
    <div class="settings-grid"><section class="panel setting-card"><p class="eyebrow">ENGINE ROADMAP</p><h3>识别引擎状态</h3><p>离线 OCR 与公式识别尚在实验室阶段，因此正式工具区不会显示“安装”或“可用”的假状态。</p><div class="engine-row"><div><b>本地中英文 OCR</b><span>待接入：受控 sidecar、模型校验、许可证清单</span></div><RouterLink class="quiet-button" to="/lab">查看实验室</RouterLink></div><div class="engine-row"><div><b>公式 → LaTeX</b><span>待接入：用户确认的视觉 API 草稿流程</span></div><RouterLink class="quiet-button" to="/lab">查看实验室</RouterLink></div></section>
      <section id="config" class="panel setting-card desktop-settings"><p class="eyebrow">WINDOWS DESKTOP</p><h3>桌面行为</h3><p>输出使用真实路径；关闭窗口、后台监听和通知均由你显式控制。</p><div class="setting-control"><span><b>默认输出目录</b><small>{{store.settings.outputDirectory||'首次导出时选择'}}</small></span><button class="quiet-button" :disabled="!desktop" @click="pickOutputDirectory">选择目录</button></div><div class="setting-control"><span><b>关闭按钮行为</b><small>托盘菜单始终保留“彻底退出”</small></span><select :value="store.settings.closeBehavior" @change="store.updateSettings({closeBehavior:($event.target as HTMLSelectElement).value as any})"><option value="ask">每次询问</option><option value="tray">隐藏到托盘</option><option value="quit">彻底退出</option></select></div><label class="setting-toggle"><span><b>系统通知</b><small>仅用于长任务完成、失败、备份和更新</small></span><input type="checkbox" :checked="store.settings.notificationsEnabled" @change="store.updateSettings({notificationsEnabled:!store.settings.notificationsEnabled})"/></label></section>
      <section class="panel setting-card clipboard-settings"><p class="eyebrow">LOCAL CLIPBOARD</p><h3>剪贴板历史</h3><p>默认关闭。开启后不做密码过滤，文本、代码和图片会保存在这台设备。</p><label class="setting-toggle warning"><span><b>后台监听</b><small>{{store.settings.clipboardEnabled?'正在本地保存复制内容':'不会后台读取剪贴板'}}</small></span><input type="checkbox" :checked="store.settings.clipboardEnabled" @change="changeClipboardEnabled"/></label><div class="setting-pair"><label>最多保留<input type="number" min="10" max="500" :value="store.settings.clipboardLimit" @change="store.updateSettings({clipboardLimit:Number(($event.target as HTMLInputElement).value)});store.pruneClipboard()"/><small>条</small></label><label>最长保留<input type="number" min="1" max="365" :value="store.settings.clipboardRetentionDays" @change="store.updateSettings({clipboardRetentionDays:Number(($event.target as HTMLInputElement).value)});store.pruneClipboard()"/><small>天</small></label></div><RouterLink class="quiet-button" to="/clipboard">管理剪贴板历史</RouterLink></section>
      <section class="panel setting-card ai-settings"><p class="eyebrow">BYO AI</p><h3>自带 API，不内置额度</h3><p>只支持 OpenAI 兼容接口。文本会在你点击“解释、提示、错因分析”等动作时发送；不会后台同步资料。</p><label>配置名称<input v-model="label" /></label><label>Base URL<input v-model="baseUrl" placeholder="https://.../v1" /></label><label>模型名称<input v-model="model" placeholder="例如 gpt-4.1-mini / deepseek-chat" /></label><label>API Key<input v-model="apiKey" type="password" :placeholder="desktop ? '写入系统凭据库' : '浏览器模式仅保留当前会话'" /></label><button class="primary-button" @click="saveProfile">保存安全配置</button><p v-if="profileMessage" class="notice">{{ profileMessage }}</p><div v-if="store.aiProfiles.length" class="profile-list"><div v-for="profile in store.aiProfiles" :key="profile.id"><span><b>{{ profile.label }}</b><small>{{ profile.model }} · {{ profile.hasKey ? '系统凭据已保存' : '未持久化 Key' }}</small></span><button class="profile-delete" :class="{ pending: pendingProfileDelete === profile.id }" @click="deleteProfile(profile.id, profile.label, profile.hasKey)">{{ pendingProfileDelete === profile.id ? '确认删除' : '删除' }}</button></div></div></section>
      <section id="backup" class="panel setting-card"><p class="eyebrow">VAULT & BACKUP</p><h3>资料库和备份</h3><p>JSON 备份包含工作区索引、笔记、任务、收藏和设置，不包含 API Key、剪贴板与导入原文件。</p><div class="vault-path">ToolKnitVault/<br /><small>sources · assets · questions · notes · exports</small></div><div class="backup-actions"><button class="quiet-button" @click="downloadBackup">导出工作区 JSON</button><button class="quiet-button" @click="backupInput?.click()">恢复工作区</button><input ref="backupInput" class="visually-hidden" type="file" accept=".json,.toolknit-backup.json" @change="restoreBackup" /></div><p v-if="backupMessage" class="notice">{{ backupMessage }}</p></section>
      <section id="update" class="panel setting-card update-card"><p class="eyebrow">RELEASE CHANNEL</p><h3>版本更新</h3><p>每天最多检查一次 GitHub Releases，不会自动下载或安装。</p><div class="setting-control"><span><b>ToolKnit v{{appVersion}}</b><small>{{store.settings.lastUpdateCheck?`上次检查 ${new Date(store.settings.lastUpdateCheck).toLocaleString('zh-CN')}`:'尚未检查'}}</small></span><button class="quiet-button" :disabled="checkingUpdate||!desktop" @click="checkUpdate">{{checkingUpdate?'检查中…':'检查更新'}}</button></div><label class="setting-toggle"><span><b>每日自动检查</b><small>离线时静默跳过</small></span><input type="checkbox" :checked="store.settings.autoCheckUpdates" @change="store.updateSettings({autoCheckUpdates:!store.settings.autoCheckUpdates})"/></label><p v-if="updateMessage" class="notice">{{updateMessage}}</p><button v-if="updateResult && updateResult.tag_name.replace(/^v/,'')!==appVersion" class="new-task" @click="openExternalUrl(updateResult.html_url)">打开 GitHub Release →</button></section>
      <section class="panel setting-card policy-card"><p class="eyebrow">PRIVACY PROMISE</p><h3>默认不上传，不做遥测。</h3><ul><li>API Key 不进入 Markdown、备份或 Git。</li><li>模型包、缓存和资料库均被忽略规则排除。</li><li>批处理永远输出新文件，不覆盖原件。</li></ul></section></div>
  </div>
</template>
