<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowReactive, shallowRef, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { open, save } from '@tauri-apps/plugin-dialog'
import { checkDesktopUpdate, createDesktopAutoBackup, createDesktopVaultBackup, getDesktopVaultHealth, getDesktopVaultStorageSpace, hasStoredApiKey, inspectDesktopVaultBackup, isDesktop, openExternalUrl, probeDesktopTranscriptionEngine, removeApiKey, restoreDesktopVaultBackup, revealDesktopFile, setClipboardMonitor, storeApiKey, type DesktopStorageSpace, type DesktopVaultBackupInspection, type DesktopVaultHealth, type GitHubRelease } from '@/lib/native'
import { chooseOutputDirectory } from '@/lib/output'
import { newId } from '@/lib/id'
import { aiErrorMessage, getSessionApiKey, removeSessionApiKey, setSessionApiKey, testAiConnection } from '@/lib/ai'
import { downloadText } from '@/lib/code-image'
import { aiProviderPresets, findAiProviderPreset } from '@/lib/ai-presets'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import AppIcon from '@/components/AppIcon.vue'
import VaultRestorePreviewDialog from '@/components/VaultRestorePreviewDialog.vue'
import { clampMenuPosition, isContextMenuShortcut, nextMenuItemIndex } from '@/lib/desktop-menu'
import { storageSpaceLevel, storageSpacePercent } from '@/lib/storage-health'
import { buildProfile, buildProfileDiagnostic, personalPackEnabled } from '@/lib/build-profile'
import { findReusableAiProfile } from '@/lib/ai-profile-editor'
import { automaticBackupTimestamp, latestBackupRecord, manualBackupTimestamp } from '@/lib/backup-status'
import type { AiProfile } from '@/types'

const store = useWorkbenchStore()
const ui = useUiStore()
const route=useRoute()
const router=useRouter()
const label = ref('我的兼容 API')
const baseUrl = ref('https://api.openai.com/v1')
const model = ref('')
const apiKey = ref('')
const selectedPresetId = ref('custom')
const editingProfileId = ref('')
const selectedPreset = computed(() => findAiProviderPreset(selectedPresetId.value))
const profileMessage = ref('')
const backupInput = ref<HTMLInputElement>()
const backupMessage = ref('')
const backupNoticeTone = ref<'neutral' | 'working' | 'success' | 'error'>('neutral')
const backupExporting = ref(false)
const vaultBackupCreating = ref(false)
const vaultAutoBackupCreating = ref(false)
const vaultBackupRestoring = ref(false)
const vaultBackupInspecting = ref(false)
const vaultRestoreReview = shallowRef<{ archivePath: string; inspection: DesktopVaultBackupInspection }>()
const vaultRestoreError = ref('')
const vaultRestorePhase = ref<'idle' | 'working' | 'reloading' | 'error'>('idle')
const vaultHealth = ref<DesktopVaultHealth>()
const vaultStorage = ref<DesktopStorageSpace>()
const vaultHealthLoading = ref(false)
const vaultHealthError = ref('')
const vaultStorageError = ref('')
const vaultMenu = ref<{ x: number; y: number } | null>(null)
const vaultMenuElement = ref<HTMLElement>()
let vaultMenuTrigger: HTMLElement | undefined
const buildMenu = ref<{ x: number; y: number } | null>(null)
const buildMenuElement = ref<HTMLElement>()
let buildMenuTrigger: HTMLElement | undefined
const pendingProfileDelete = ref('')
type AiConnectionState = { tone: 'working' | 'success' | 'error' | 'neutral'; message: string }
const aiConnectionStates = ref<Record<string, AiConnectionState>>({})
const aiTestControllers = shallowReactive(new Map<string, AbortController>())
const aiProfileMenu = ref<{ x: number; y: number; profile: AiProfile }>()
const aiProfileMenuElement = ref<HTMLElement>()
let aiProfileMenuTrigger: HTMLElement | undefined
const desktop = isDesktop()
const appVersion = __APP_VERSION__
const updateResult = ref<GitHubRelease>()
const updateMessage = ref('')
const checkingUpdate = ref(false)
const transcriptionChecking = ref(false)
const transcriptionMessage = ref('')
const transcriptionReady = ref(false)
const readingScaleOptions = [
  { id: 'compact', label: '紧凑', detail: '14 px' },
  { id: 'comfortable', label: '舒适', detail: '16 px' },
  { id: 'large', label: '大字', detail: '18 px' },
] as const
const readingDensityOptions = [
  { id: 'compact', label: '紧凑', detail: '1.62' },
  { id: 'comfortable', label: '舒展', detail: '1.78' },
  { id: 'airy', label: '宽松', detail: '1.94' },
] as const
const readingWidthOptions = [
  { id: 'focused', label: '专注', detail: '680 px' },
  { id: 'balanced', label: '平衡', detail: '860 px' },
  { id: 'wide', label: '宽屏', detail: '1040 px' },
] as const
const paperToneOptions = [
  { id: 'warm', label: '暖纸', color: '#fffcf7' },
  { id: 'neutral', label: '清白', color: '#ffffff' },
  { id: 'mist', label: '雾绿', color: '#f5f7f3' },
  { id: 'night', label: '夜墨', color: '#17211d' },
] as const
const vaultStructureHealthy = computed(() => Boolean(vaultHealth.value
  && vaultHealth.value.integrity === 'ok'
  && vaultHealth.value.schemaVersion === vaultHealth.value.latestSchemaVersion
  && vaultHealth.value.missingMarkdownCount === 0))
const vaultStorageLevel = computed(() => storageSpaceLevel(vaultStorage.value))
const vaultStoragePercent = computed(() => storageSpacePercent(vaultStorage.value))
const vaultHealthy = computed(() => vaultStructureHealthy.value && vaultStorageLevel.value === 'ready')
const vaultName = computed(() => vaultHealth.value?.root.split(/[\\/]/).filter(Boolean).at(-1) || store.activeVaultName || 'KnitspaceVault')
const vaultStatusLabel = computed(() => vaultHealthLoading.value
  ? '正在检查本地资料库'
  : vaultStorageLevel.value === 'critical'
    ? '磁盘空间严重不足'
    : vaultStorageLevel.value === 'low'
      ? '磁盘空间偏低'
      : vaultStorageError.value
        ? '磁盘检查未完成'
      : vaultHealthError.value
          ? '资料库检查未完成'
          : vaultStructureHealthy.value
            ? '结构与正文检查正常'
            : '资料库需要处理')
const vaultStorageLabel = computed(() => vaultStorageLevel.value === 'critical'
  ? '写入随时可能失败，请立即释放空间'
  : vaultStorageLevel.value === 'low'
    ? '建议在继续导入或创建归档前释放空间'
    : vaultStorageLevel.value === 'ready'
      ? '足够支持当前 Vault、WAL 与自动归档'
      : vaultStorageError.value || '尚未读取资料库所在磁盘')
const manualBackupAt = computed(() => manualBackupTimestamp(store.settings))
const automaticBackupAt = computed(() => automaticBackupTimestamp(store.settings, vaultHealth.value?.lastAutomaticBackupAt))
const legacyBackupAt = computed(() => !manualBackupAt.value && latestBackupRecord(store.settings)?.kind === 'legacy' ? store.settings.lastBackupAt : undefined)

function validateEndpoint(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname) } catch { return false }
}
function applyProviderPreset() {
  const preset = selectedPreset.value
  if (!preset || preset.id === 'custom') return
  label.value = preset.profileLabel
  baseUrl.value = preset.baseUrl
  model.value = preset.models[0] ?? ''
  profileMessage.value = `已套用“${preset.name}”预设，保存前仍可修改地址和模型。`
}
function editProfile(profile: AiProfile) {
  editingProfileId.value = profile.id
  label.value = profile.label
  baseUrl.value = profile.baseUrl
  model.value = profile.model
  apiKey.value = ''
  selectedPresetId.value = aiProviderPresets.find((preset) => (
    preset.id !== 'custom'
    && preset.baseUrl.replace(/\/$/, '') === profile.baseUrl.replace(/\/$/, '')
    && preset.models.includes(profile.model)
  ))?.id ?? 'custom'
  profileMessage.value = `正在编辑“${profile.label}”；API Key 留空会保留现有凭据。`
}
async function saveProfile() {
  if (!validateEndpoint(baseUrl.value)) { profileMessage.value = '远程地址必须使用 HTTPS；仅 localhost 可以使用 HTTP。'; return }
  if (!model.value.trim()) { profileMessage.value = '填写模型名称后才能保存。'; return }
  const normalizedProfile = {
    label: label.value.trim() || '未命名配置',
    baseUrl: baseUrl.value.replace(/\/$/, ''),
    model: model.value.trim(),
  }
  const existing = store.aiProfiles.find((profile) => profile.id === editingProfileId.value)
    ?? findReusableAiProfile(store.aiProfiles, normalizedProfile)
  const id = existing?.id ?? newId()
  try {
    const suppliedKey = Boolean(apiKey.value.trim())
    let persistedKey = existing?.hasKey ?? false
    if (suppliedKey) { persistedKey = await storeApiKey(id, apiKey.value.trim()); setSessionApiKey(id, apiKey.value.trim()) }
    store.saveAiProfile({ id, ...normalizedProfile, hasKey: persistedKey })
    apiKey.value = ''
    editingProfileId.value = ''
    const savedLabel = existing ? '配置已更新' : '配置已保存'
    const hasSessionKey = Boolean(getSessionApiKey(id))
    profileMessage.value = persistedKey ? `${savedLabel}；API Key 已写入系统凭据库。` : suppliedKey || hasSessionKey ? `${savedLabel}；浏览器模式下 API Key 只保留到当前标签页关闭。` : `${savedLabel}，但尚未提供 API Key。`
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
    if (editingProfileId.value === id) editingProfileId.value = ''
    pendingProfileDelete.value = ''
    profileMessage.value = `已删除配置“${label}”。`
  } catch { profileMessage.value = '系统凭据删除失败，配置仍然保留。请稍后重试。' }
}
async function testAiProfile(profile: AiProfile) {
  closeAiProfileMenu()
  const active = aiTestControllers.get(profile.id)
  if (active) { active.abort(); return }
  if (desktop) {
    try {
      const credentialExists = await hasStoredApiKey(profile.id)
      if (!credentialExists) {
        if (profile.hasKey) store.saveAiProfile({ ...profile, hasKey: false })
        aiConnectionStates.value = { ...aiConnectionStates.value, [profile.id]: { tone: 'error', message: '系统凭据已丢失，请点“编辑”重新保存 API Key。' } }
        return
      }
    } catch (reason) {
      aiConnectionStates.value = { ...aiConnectionStates.value, [profile.id]: { tone: 'error', message: `无法读取系统凭据库：${aiErrorMessage(reason)}` } }
      return
    }
  }
  const key = getSessionApiKey(profile.id)
  if (!desktop && !key) {
    aiConnectionStates.value = { ...aiConnectionStates.value, [profile.id]: { tone: 'error', message: '浏览器预览需要重新输入 Session API Key。' } }
    return
  }
  const controller = new AbortController()
  aiTestControllers.set(profile.id, controller)
  aiConnectionStates.value = { ...aiConnectionStates.value, [profile.id]: { tone: 'working', message: '正在发送最小连接检查；再次点击可停止。' } }
  const startedAt = performance.now()
  try {
    await testAiConnection(profile, key, controller.signal)
    const seconds = Math.max(.1, (performance.now() - startedAt) / 1000).toFixed(1)
    aiConnectionStates.value = { ...aiConnectionStates.value, [profile.id]: { tone: 'success', message: `连接正常 · ${seconds} 秒 · 未保存测试回复` } }
  } catch (reason) {
    const cancelled = controller.signal.aborted
    aiConnectionStates.value = { ...aiConnectionStates.value, [profile.id]: { tone: cancelled ? 'neutral' : 'error', message: cancelled ? '已停止连接检查。' : aiErrorMessage(reason, '连接检查失败。') } }
  } finally { aiTestControllers.delete(profile.id) }
}
function closeAiProfileMenu(restoreFocus = false) {
  aiProfileMenu.value = undefined
  if (restoreFocus) void nextTick(() => aiProfileMenuTrigger?.focus({ preventScroll: true }))
}
function openAiProfileMenu(event: MouseEvent | KeyboardEvent, profile: AiProfile) {
  if ('key' in event && !isContextMenuShortcut(event)) return
  event.preventDefault()
  event.stopPropagation()
  closeVaultMenu(); closeBuildMenu()
  aiProfileMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = aiProfileMenuTrigger?.getBoundingClientRect()
  const x = 'clientX' in event && event.clientX ? event.clientX : (bounds?.right ?? 270) - 30
  const y = 'clientY' in event && event.clientY ? event.clientY : (bounds?.top ?? 18) + 42
  aiProfileMenu.value = { ...clampMenuPosition(x, y, { menuWidth: 252, menuHeight: 224, margin: 12 }), profile }
  void nextTick(() => aiProfileMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}
function handleAiProfileMenuKeydown(event: KeyboardEvent) {
  const items = [...(aiProfileMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeAiProfileMenu(true); return }
  const index = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (index === undefined) return
  event.preventDefault(); items[index]?.focus({ preventScroll: true })
}
async function copyAiProfileDiagnosis(profile: AiProfile) {
  closeAiProfileMenu()
  const state = aiConnectionStates.value[profile.id]?.message ?? '本次启动尚未测试'
  const detail = `Knitspace AI 配置\n名称：${profile.label}\n模型：${profile.model}\n地址：${profile.baseUrl.replace(/\/$/, '')}/chat/completions\n凭据：${profile.hasKey ? '系统凭据库已保存' : '未持久化'}\n连接：${state}`
  try { await navigator.clipboard.writeText(detail); ui.toast('已复制 AI 连接诊断', '内容不包含 API Key。', 'success') }
  catch { ui.toast('暂时无法复制', '系统剪贴板当前不可用。', 'error') }
}
function editAiProfileFromMenu(profile: AiProfile) { closeAiProfileMenu(); editProfile(profile) }
function openAiWorkbench(profile: AiProfile) { closeAiProfileMenu(); void router.push({ path: '/ai', query: { profile: profile.id } }) }
async function downloadBackup() {
  if (backupExporting.value) return
  backupExporting.value = true
  backupNoticeTone.value = 'working'
  backupMessage.value = '正在整理工作区正文与设置…'
  try {
    const backup = await store.exportBrowserBackup()
    downloadText(`knitspace-${new Date().toISOString().slice(0, 10)}.knitspace-backup.json`, backup, 'application/json')
    const backedUpAt = new Date().toISOString()
    store.updateSettings({ lastBackupAt: backedUpAt, lastManualBackupAt: backedUpAt })
    store.addActivity('backup','导出工作区备份','不包含 API Key、剪贴板和原始文件')
    backupNoticeTone.value = 'success'
    backupMessage.value = '工作区 JSON 备份已下载；不包含 API Key、剪贴板或原始文件。'
  } catch (error) {
    backupNoticeTone.value = 'error'
    backupMessage.value = error instanceof Error ? `备份未导出：${error.message}` : '备份暂时无法导出。'
  } finally {
    backupExporting.value = false
  }
}
async function createVaultBackup() {
  if (!desktop || vaultBackupCreating.value) return
  const date = new Date().toISOString().slice(0, 10)
  const outputPath = await save({
    title: '保存 Knitspace Vault 完整归档',
    defaultPath: `knitspace-vault-${date}.zip`,
    filters: [{ name: 'Knitspace Vault 归档', extensions: ['zip'] }]
  })
  if (!outputPath) {
    backupNoticeTone.value = 'neutral'
    backupMessage.value = '已取消创建完整 Vault 归档。'
    return
  }
  vaultBackupCreating.value = true
  backupNoticeTone.value = 'working'
  backupMessage.value = '正在创建一致性 SQLite 快照并写入完整 Vault 归档…'
  try {
    await createDesktopVaultBackup(outputPath)
    const backedUpAt = new Date().toISOString()
    store.updateSettings({ lastBackupAt: backedUpAt, lastManualBackupAt: backedUpAt })
    store.addActivity('backup', '已创建完整 Vault 归档', '包含 SQLite 索引、Markdown 正文和受管原始文件')
    backupNoticeTone.value = 'success'
    backupMessage.value = `完整 Vault 归档已保存到：${outputPath}`
    ui.toast('完整 Vault 归档已完成', outputPath, 'success')
    await loadVaultHealth()
  } catch (error) {
    backupNoticeTone.value = 'error'
    backupMessage.value = error instanceof Error ? `完整归档未完成：${error.message}` : '完整归档暂时无法创建。'
  } finally {
    vaultBackupCreating.value = false
  }
}
async function runAutomaticVaultBackup() {
  if (!desktop || vaultAutoBackupCreating.value || vaultBackupCreating.value || vaultBackupRestoring.value) return
  closeVaultMenu()
  vaultAutoBackupCreating.value = true
  backupNoticeTone.value = 'working'
  backupMessage.value = '正在检查今日每日归档；已存在时不会重复写入。'
  try {
    const path = await createDesktopAutoBackup()
    await loadVaultHealth()
    const backedUpAt = vaultHealth.value?.lastAutomaticBackupAt || (path ? new Date().toISOString() : undefined)
    if (backedUpAt) store.updateSettings({ lastAutomaticBackupAt: backedUpAt })
    if (path) {
      store.addActivity('backup', '已创建本地 Vault 归档', '手动检查每日归档 · 保留最近 7 份')
      backupMessage.value = `今日完整归档已创建：${path}`
      ui.toast('今日每日归档已完成', 'SQLite、Markdown 与受管原始文件均已包含。', 'success')
    } else {
      backupMessage.value = '今天的每日归档已经存在，没有重复打包或占用额外空间。'
    }
    backupNoticeTone.value = 'success'
  } catch (error) {
    backupNoticeTone.value = 'error'
    backupMessage.value = error instanceof Error ? `每日归档未完成：${error.message}` : '每日归档暂时无法创建。'
  } finally {
    vaultAutoBackupCreating.value = false
  }
}
async function revealAutomaticBackup() {
  const path = vaultHealth.value?.lastAutomaticBackup
  if (!path) return
  closeVaultMenu()
  try { await revealDesktopFile(path) }
  catch (error) { backupNoticeTone.value = 'error'; backupMessage.value = error instanceof Error ? `无法打开最近归档：${error.message}` : '无法打开最近归档。' }
}
function formatBytes(value = 0) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}
async function loadVaultHealth() {
  if (!desktop || vaultHealthLoading.value) return
  vaultHealthLoading.value = true
  vaultHealthError.value = ''
  vaultStorageError.value = ''
  const [health, storage] = await Promise.allSettled([getDesktopVaultHealth(), getDesktopVaultStorageSpace()])
  if (health.status === 'fulfilled') vaultHealth.value = health.value
  else { vaultHealth.value = undefined; vaultHealthError.value = health.reason instanceof Error ? health.reason.message : '无法读取资料库诊断信息。' }
  if (storage.status === 'fulfilled') vaultStorage.value = storage.value
  else { vaultStorage.value = undefined; vaultStorageError.value = storage.reason instanceof Error ? storage.reason.message : '无法读取资料库磁盘空间。' }
  vaultHealthLoading.value = false
}
function closeVaultMenu(restoreFocus = false) {
  vaultMenu.value = null
  if (restoreFocus) void nextTick(() => vaultMenuTrigger?.focus({ preventScroll: true }))
}
function openVaultMenu(event: MouseEvent | KeyboardEvent) {
  if (!desktop) return
  event.preventDefault()
  event.stopPropagation()
  buildMenu.value = null
  vaultMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = vaultMenuTrigger?.getBoundingClientRect()
  const x = 'clientX' in event && event.clientX ? event.clientX : (bounds?.left ?? 18) + 38
  const y = 'clientY' in event && event.clientY ? event.clientY : (bounds?.top ?? 18) + 42
  vaultMenu.value = clampMenuPosition(x, y, { menuWidth: 252, menuHeight: 329 + (vaultHealth.value?.lastAutomaticBackup ? 39 : 0), margin: 12 })
  void nextTick(() => vaultMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}

function closeBuildMenu(restoreFocus = false) {
  buildMenu.value = null
  if (restoreFocus) void nextTick(() => buildMenuTrigger?.focus({ preventScroll: true }))
}
function openBuildMenu(event: MouseEvent | KeyboardEvent) {
  event.preventDefault()
  event.stopPropagation()
  vaultMenu.value = null
  buildMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = buildMenuTrigger?.getBoundingClientRect()
  const x = 'clientX' in event && event.clientX ? event.clientX : (bounds?.right ?? 270) - 32
  const y = 'clientY' in event && event.clientY ? event.clientY : (bounds?.top ?? 18) + 48
  buildMenu.value = clampMenuPosition(x, y, { menuWidth: 252, menuHeight: 181, margin: 12 })
  void nextTick(() => buildMenuElement.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
}
function openBuildMenuFromKeyboard(event: KeyboardEvent) {
  if (isContextMenuShortcut(event)) openBuildMenu(event)
}
function handleBuildMenuKeydown(event: KeyboardEvent) {
  const items = [...(buildMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeBuildMenu(true); return }
  const index = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (index === undefined) return
  event.preventDefault()
  items[index]?.focus({ preventScroll: true })
}
function openBuildPrimaryAction() {
  closeBuildMenu()
  void router.push(personalPackEnabled ? '/private-tools' : '/tool-space')
}
async function copyBuildDetails() {
  closeBuildMenu()
  try {
    await navigator.clipboard.writeText(buildProfileDiagnostic(buildProfile, appVersion, desktop))
    ui.toast('已复制版本信息', `${buildProfile.title} · ${desktop ? 'Windows 桌面端' : '浏览器预览'}`, 'success')
  } catch { ui.toast('暂时无法复制', '系统剪贴板当前不可用。', 'error') }
}
async function copyBuildCommand() {
  closeBuildMenu()
  const command = personalPackEnabled ? 'pnpm desktop:dev' : 'pnpm desktop:package:public'
  try { await navigator.clipboard.writeText(command); ui.toast('已复制构建命令', command, 'success') }
  catch { ui.toast('暂时无法复制', '系统剪贴板当前不可用。', 'error') }
}
function openVaultMenuFromKeyboard(event: KeyboardEvent) {
  if (isContextMenuShortcut(event)) openVaultMenu(event)
}
function handleVaultMenuKeydown(event: KeyboardEvent) {
  const items = [...(vaultMenuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (event.key === 'Escape') { event.preventDefault(); closeVaultMenu(true); return }
  const index = nextMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
  if (index === undefined) return
  event.preventDefault()
  items[index]?.focus({ preventScroll: true })
}
async function revealVault() {
  const root = vaultHealth.value?.root || store.vaultRoot
  if (!root) { await loadVaultHealth(); return }
  closeVaultMenu()
  try { await revealDesktopFile(root) } catch (error) { vaultHealthError.value = error instanceof Error ? error.message : '无法打开资料库目录。' }
}
async function copyVaultPath() {
  const root = vaultHealth.value?.root || store.vaultRoot
  if (!root) return
  try { await navigator.clipboard.writeText(root); ui.toast('已复制资料库路径', root, 'success') }
  catch { ui.toast('暂时无法复制', '系统剪贴板当前不可用。', 'error') }
  closeVaultMenu()
}
async function copyStorageDiagnosis() {
  const detail = vaultStorage.value
    ? `Knitspace Vault 磁盘空间\n路径：${vaultStorage.value.path}\n可用：${formatBytes(vaultStorage.value.availableBytes)} / ${formatBytes(vaultStorage.value.totalBytes)}\n状态：${vaultStatusLabel.value}`
    : `Knitspace Vault 磁盘空间\n状态：${vaultStorageError.value || '尚未读取'}`
  try { await navigator.clipboard.writeText(detail); ui.toast('已复制磁盘诊断', vaultStorage.value ? `剩余 ${formatBytes(vaultStorage.value.availableBytes)}` : '尚无容量数据', 'success') }
  catch { ui.toast('暂时无法复制', '系统剪贴板当前不可用。', 'error') }
  closeVaultMenu()
}
async function restoreVaultBackup() {
  if (!desktop || vaultBackupRestoring.value || vaultBackupInspecting.value) return
  vaultRestorePhase.value = 'idle'
  const archivePath = await open({
    title: '选择 Knitspace Vault 完整归档',
    multiple: false,
    filters: [{ name: 'Knitspace Vault 归档', extensions: ['zip'] }]
  })
  if (typeof archivePath !== 'string') return
  vaultBackupInspecting.value = true
  backupNoticeTone.value = 'working'
  backupMessage.value = '正在只读检查归档中的 SQLite、Markdown 清单与版本兼容性…'
  try {
    const inspection = await inspectDesktopVaultBackup(archivePath)
    vaultRestoreError.value = ''
    vaultRestoreReview.value = { archivePath, inspection }
    backupNoticeTone.value = 'success'
    backupMessage.value = `归档检查通过：${inspection.documentCount} 篇文档、${inspection.vocabularyCount} 个单词、${inspection.sourceCount} 份资料。等待确认，当前 Vault 未修改。`
  } catch (error) {
    vaultRestorePhase.value = 'error'
    backupNoticeTone.value = 'error'
    backupMessage.value = error instanceof Error ? `归档不可恢复：${error.message}` : '无法检查所选完整 Vault 归档。'
  } finally {
    vaultBackupInspecting.value = false
  }
}
function cancelVaultRestoreReview() {
  if (vaultBackupRestoring.value) return
  vaultRestoreReview.value = undefined
  vaultRestoreError.value = ''
  backupNoticeTone.value = 'neutral'
  backupMessage.value = '已取消完整 Vault 恢复，当前资料未修改。'
}
async function confirmVaultRestore() {
  const review = vaultRestoreReview.value
  if (!review || vaultBackupRestoring.value) return
  vaultRestoreError.value = ''
  try {
    vaultBackupRestoring.value = true
    vaultRestorePhase.value = 'working'
    backupNoticeTone.value = 'working'
    backupMessage.value = '正在验证归档、创建恢复前安全副本并替换当前 Vault…'
    const safetyArchive = await restoreDesktopVaultBackup(review.archivePath)
    vaultRestorePhase.value = 'reloading'
    backupNoticeTone.value = 'success'
    backupMessage.value = `完整 Vault 已恢复，已额外保存恢复前归档：${safetyArchive}。正在重新载入…`
    ui.toast('完整 Vault 已恢复', '正在重新载入资料库。', 'success')
    window.setTimeout(() => window.location.reload(), 700)
  } catch (error) {
    vaultRestorePhase.value = 'error'
    backupNoticeTone.value = 'error'
    vaultRestoreError.value = error instanceof Error ? `完整恢复未完成：${error.message}` : '完整 Vault 暂时无法恢复。'
    backupMessage.value = vaultRestoreError.value
  } finally {
    vaultBackupRestoring.value = false
  }
}
async function restoreBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    if (!await ui.confirm({ title:'恢复工作区？', message:'恢复会替换当前工作区中的资料、笔记、任务、收藏和设置，剪贴板历史不受影响。', danger:true, confirmLabel:'确认恢复' })) { backupNoticeTone.value = 'neutral'; backupMessage.value = '已取消恢复，当前资料未修改。'; return }
    backupNoticeTone.value = 'working'
    backupMessage.value = '正在验证并恢复工作区 JSON 快照…'
    const restored = await store.restoreBrowserBackup(await file.text())
    backupNoticeTone.value = 'success'
    backupMessage.value = `恢复完成：${restored.sources} 份资料、${restored.documents} 篇文档、${restored.recipes} 个配方。`
  } catch (error) { backupNoticeTone.value = 'error'; backupMessage.value = error instanceof Error ? error.message : '恢复失败，当前资料未修改。' }
  finally { input.value = '' }
}
async function pickOutputDirectory() { const path = await chooseOutputDirectory(); if (path) { store.updateSettings({ outputDirectory:path }); ui.toast('默认输出目录已更新',path,'success') } }
async function pickTranscriptionExecutable() {
  if (!desktop) return
  const path = await open({ title: '选择 whisper.cpp CLI', multiple: false, filters: [{ name: 'Windows 可执行程序', extensions: ['exe'] }] })
  if (typeof path !== 'string') return
  store.updateSettings({ transcriptionExecutablePath: path })
  transcriptionReady.value = false
  transcriptionMessage.value = '已记住所选程序；点击“验证本机引擎”后才会运行它。'
}
async function pickTranscriptionModel() {
  if (!desktop) return
  const path = await open({ title: '选择本机 Whisper 模型', multiple: false, filters: [{ name: 'Whisper 模型', extensions: ['bin', 'gguf'] }] })
  if (typeof path !== 'string') return
  store.updateSettings({ transcriptionModelPath: path })
  transcriptionReady.value = false
  transcriptionMessage.value = '已记住模型路径；模型文件不会进入 Vault 或备份。'
}
async function verifyTranscriptionEngine() {
  if (!store.settings.transcriptionExecutablePath || !store.settings.transcriptionModelPath) {
    transcriptionMessage.value = '请先分别选择 whisper.cpp CLI 与本机模型。'
    return
  }
  transcriptionChecking.value = true
  transcriptionReady.value = false
  transcriptionMessage.value = '正在读取所选 CLI 的帮助信息并检查模型路径…'
  try {
    const capability = await probeDesktopTranscriptionEngine(store.settings.transcriptionExecutablePath, store.settings.transcriptionModelPath)
    transcriptionReady.value = capability.available
    transcriptionMessage.value = `${capability.executableName} · ${capability.modelName}：${capability.detail}`
  } catch (error) {
    transcriptionMessage.value = error instanceof Error ? error.message : '本机引擎验证失败。'
  } finally { transcriptionChecking.value = false }
}
async function changeClipboardEnabled() { store.updateSettings({ clipboardEnabled:!store.settings.clipboardEnabled, clipboardPaused:false }); await setClipboardMonitor(store.settings.clipboardEnabled,false) }
async function checkUpdate() { checkingUpdate.value=true; updateMessage.value=''; try { const release=await checkDesktopUpdate(); store.updateSettings({lastUpdateCheck:new Date().toISOString()}); if(!release){updateMessage.value='浏览器模式无法检查桌面版本。';return} updateResult.value=release; updateMessage.value=release.tag_name.replace(/^v/,'')===__APP_VERSION__?'当前已是最新版本。':`发现新版本 ${release.tag_name}，安装包将在 GitHub Releases 中提供。` } catch(error){updateMessage.value=error instanceof Error?error.message:'检查更新失败，请确认网络连接。'} finally{checkingUpdate.value=false} }
function openVaultRestoreReviewQa() {
  if (!import.meta.env.DEV || route.query.qa !== 'vault-restore-preview') return
  vaultHealth.value = { root: 'F:\\Documents\\KnitspaceVault', schemaVersion: 18, latestSchemaVersion: 18, integrity: 'ok', databaseSize: 18_874_368, documentCount: 286, noteCount: 214, questionCount: 72, vocabularyCount: 1380, sourceCount: 94, relationCount: 418, reviewCardCount: 2260, ftsEntryCount: 1760, missingMarkdownCount: 0 }
  vaultRestoreReview.value = { archivePath: 'F:\\Backups\\knitspace-auto-2026-08-05.zip', inspection: { archiveName: 'knitspace-auto-2026-08-05.zip', archiveSize: 184_549_376, modifiedAt: '2026-08-05T21:40:00+08:00', schemaVersion: 18, latestSchemaVersion: 18, integrity: 'ok', documentCount: 263, noteCount: 198, questionCount: 65, vocabularyCount: 1296, sourceCount: 87, relationCount: 391, reviewCardCount: 2114, fileCount: 742, managedFileCount: 478, uncompressedSize: 396_361_728, missingMarkdownCount: 0 } }
}
async function focusSection(){const section=typeof route.query.section==='string'?route.query.section:'';await nextTick();if(!section||section==='config'){window.scrollTo({top:0,behavior:'auto'});return}document.getElementById(section)?.scrollIntoView({behavior:'auto',block:'start'})}
watch(()=>route.query.section,focusSection)
onMounted(()=>{store.pruneClipboard();focusSection();void loadVaultHealth();openVaultRestoreReviewQa()})
</script>

<template>
  <div class="settings page-enter" @click="closeVaultMenu(); closeBuildMenu(); closeAiProfileMenu()">
    <div class="settings-shell">
      <aside class="settings-index" aria-label="设置分类">
        <header>
          <span class="settings-index-icon"><AppIcon name="settings" :size="18" /></span>
          <div><strong>偏好设置</strong><small>本机配置自动保存</small></div>
        </header>
        <nav>
          <RouterLink :to="{ path: '/settings', query: { section: 'config' } }" :class="{ active: !route.query.section || route.query.section === 'config' }" :aria-current="!route.query.section || route.query.section === 'config' ? 'page' : undefined"><AppIcon name="settings" :size="16" /><span>常规</span></RouterLink>
          <RouterLink :to="{ path: '/settings', query: { section: 'appearance' } }" :class="{ active: route.query.section === 'appearance' }" :aria-current="route.query.section === 'appearance' ? 'page' : undefined"><AppIcon name="palette" :size="16" /><span>阅读与外观</span></RouterLink>
          <RouterLink :to="{ path: '/settings', query: { section: 'clipboard' } }" :class="{ active: route.query.section === 'clipboard' }" :aria-current="route.query.section === 'clipboard' ? 'page' : undefined"><AppIcon name="file-text" :size="16" /><span>剪贴板</span></RouterLink>
          <RouterLink :to="{ path: '/settings', query: { section: 'ai' } }" :class="{ active: route.query.section === 'ai' }" :aria-current="route.query.section === 'ai' ? 'page' : undefined"><AppIcon name="sparkle" :size="16" /><span>AI 服务</span></RouterLink>
          <RouterLink :to="{ path: '/settings', query: { section: 'engines' } }" :class="{ active: route.query.section === 'engines' }" :aria-current="route.query.section === 'engines' ? 'page' : undefined"><AppIcon name="play" :size="16" /><span>本机引擎</span></RouterLink>
          <RouterLink :to="{ path: '/settings', query: { section: 'backup' } }" :class="{ active: route.query.section === 'backup' }" :aria-current="route.query.section === 'backup' ? 'page' : undefined"><AppIcon name="inbox" :size="16" /><span>数据与备份</span></RouterLink>
          <RouterLink :to="{ path: '/settings', query: { section: 'update' } }" :class="{ active: route.query.section === 'update' }" :aria-current="route.query.section === 'update' ? 'page' : undefined"><AppIcon name="clock" :size="16" /><span>版本更新</span></RouterLink>
        </nav>
        <div class="settings-local-note"><AppIcon name="shield" :size="16" /><span><b>本地优先</b><small>没有遥测，不会静默上传</small></span></div>
      </aside>

      <main class="settings-content">
        <header class="settings-intro">
          <div><p class="eyebrow">桌面偏好</p><h2>让 Knitspace 按你的方式工作</h2><p>调整桌面行为、隐私边界、服务连接和工作区数据。</p></div>
          <span class="settings-save-state"><i></i>更改自动保存</span>
        </header>

        <section id="config" class="settings-section">
          <header><span><AppIcon name="settings" :size="18" /></span><div><h3>常规</h3><p>桌面窗口、导出与系统通知</p></div></header>
          <div class="settings-panel">
            <div class="setting-control"><span><b>默认输出目录</b><small>{{store.settings.outputDirectory||'尚未设置，首次导出时选择'}}</small></span><button class="quiet-button" :disabled="!desktop" @click="pickOutputDirectory">选择目录</button></div>
            <div class="setting-control"><span><b>关闭窗口时</b><small>托盘菜单始终可以彻底退出</small></span><select :value="store.settings.closeBehavior" @change="store.updateSettings({closeBehavior:($event.target as HTMLSelectElement).value as any})"><option value="ask">每次询问</option><option value="tray">隐藏到托盘</option><option value="quit">彻底退出</option></select></div>
            <label class="setting-toggle"><span><b>Markdown 自动保存</b><small>停笔后写入本地；大文档会自动延长间隔，Ctrl+S 始终可用</small></span><input type="checkbox" :checked="store.settings.documentAutoSave" @change="store.updateSettings({documentAutoSave:!store.settings.documentAutoSave})"/></label>
            <label class="setting-toggle"><span><b>系统通知</b><small>长任务完成、失败、备份和更新时提醒</small></span><input type="checkbox" :checked="store.settings.notificationsEnabled" @change="store.updateSettings({notificationsEnabled:!store.settings.notificationsEnabled})"/></label>
          </div>
        </section>

        <section id="appearance" class="settings-section appearance-settings">
          <header><span><AppIcon name="palette" :size="18" /></span><div><h3>阅读与外观</h3><p>统一 Markdown 阅读、源码编辑与纸张对比度</p></div></header>
          <div class="settings-panel appearance-panel">
            <div class="appearance-controls">
              <fieldset>
                <legend><b>正文字号</b><small>同步调整源码编辑器，保持阅读与书写比例</small></legend>
                <div class="appearance-segments">
                  <button v-for="option in readingScaleOptions" :key="option.id" type="button" :class="{ active: store.settings.readingScale === option.id }" :aria-pressed="store.settings.readingScale === option.id" @click="store.updateSettings({ readingScale: option.id })"><b>{{ option.label }}</b><small>{{ option.detail }}</small></button>
                </div>
              </fieldset>
              <fieldset>
                <legend><b>行间距</b><small>长文、公式和代码块较多时仍保留呼吸感</small></legend>
                <div class="appearance-segments">
                  <button v-for="option in readingDensityOptions" :key="option.id" type="button" :class="{ active: store.settings.readingDensity === option.id }" :aria-pressed="store.settings.readingDensity === option.id" @click="store.updateSettings({ readingDensity: option.id })"><b>{{ option.label }}</b><small>{{ option.detail }}</small></button>
                </div>
              </fieldset>
              <fieldset>
                <legend><b>阅读宽度</b><small>限制单行长度，宽屏下也不让视线走得太远</small></legend>
                <div class="appearance-segments">
                  <button v-for="option in readingWidthOptions" :key="option.id" type="button" :class="{ active: store.settings.readingWidth === option.id }" :aria-pressed="store.settings.readingWidth === option.id" @click="store.updateSettings({ readingWidth: option.id })"><b>{{ option.label }}</b><small>{{ option.detail }}</small></button>
                </div>
              </fieldset>
              <fieldset>
                <legend><b>纸张底色</b><small>底色只作用于阅读与编辑表面，不改变工具界面</small></legend>
                <div class="paper-tone-picker">
                  <button v-for="option in paperToneOptions" :key="option.id" type="button" :class="{ active: store.settings.readingPaperTone === option.id }" :aria-pressed="store.settings.readingPaperTone === option.id" @click="store.updateSettings({ readingPaperTone: option.id })"><i :style="{ background: option.color }"></i><span>{{ option.label }}</span></button>
                </div>
              </fieldset>
              <label class="setting-toggle appearance-motion"><span><b>减少动态效果</b><small>关闭页面入场、菜单缩放和非必要过渡，低性能设备更稳定</small></span><input type="checkbox" :checked="store.settings.reduceMotion" @change="store.updateSettings({ reduceMotion: !store.settings.reduceMotion })" /></label>
            </div>
            <aside class="reading-preview" aria-label="阅读外观实时预览">
              <header><span>实时预览</span><small>MARKDOWN</small></header>
              <article>
                <p class="reading-preview-kicker">本地数字工作台</p>
                <h4>让记录回到思考本身</h4>
                <p>清晰的层级、合适的行长和克制的纸张色，能让长时间阅读更轻松。</p>
                <pre><code>const idea = notes.link(context)</code></pre>
                <blockquote>设置会自动保存，并立即应用到文档。</blockquote>
              </article>
            </aside>
          </div>
        </section>

        <section id="clipboard" class="settings-section">
          <header><span><AppIcon name="file-text" :size="18" /></span><div><h3>剪贴板</h3><p>控制是否记录，以及本地保留多久</p></div><RouterLink class="section-link" to="/clipboard">查看历史 →</RouterLink></header>
          <div class="settings-panel">
            <label class="setting-toggle"><span><b>后台监听</b><small>{{store.settings.clipboardEnabled?'正在本机保存复制的文本、代码和图片':'关闭时不会读取系统剪贴板'}}</small></span><input type="checkbox" :checked="store.settings.clipboardEnabled" @change="changeClipboardEnabled"/></label>
            <div class="setting-retention">
              <label><span>最多保留</span><div><input type="number" min="10" max="500" :value="store.settings.clipboardLimit" @change="store.updateSettings({clipboardLimit:Number(($event.target as HTMLInputElement).value)});store.pruneClipboard()"/><small>条</small></div></label>
              <label><span>最长保留</span><div><input type="number" min="1" max="365" :value="store.settings.clipboardRetentionDays" @change="store.updateSettings({clipboardRetentionDays:Number(($event.target as HTMLInputElement).value)});store.pruneClipboard()"/><small>天</small></div></label>
            </div>
            <p class="settings-caution"><AppIcon name="warning" :size="15" />监听不会过滤密码或敏感信息，请只保留你愿意存放在本机的内容。</p>
          </div>
        </section>

        <section id="ai" class="settings-section">
          <header><span><AppIcon name="sparkle" :size="18" /></span><div><h3>AI 服务</h3><p>连接你自己的 OpenAI 兼容接口</p></div></header>
          <div class="settings-panel ai-settings-panel">
            <p class="settings-explainer">只有在你主动执行 AI 操作时，确认过的文本才会发送到此服务。Knitspace 不提供内置额度。</p>
            <div class="ai-preset-picker">
              <label><span><b>服务预设</b><small>自动填写兼容地址和推荐模型</small></span><select v-model="selectedPresetId" @change="applyProviderPreset"><option v-for="preset in aiProviderPresets" :key="preset.id" :value="preset.id">{{ preset.name }}</option></select></label>
              <p>{{ selectedPreset?.description }}</p>
            </div>
            <div class="ai-settings-form">
              <label><span>配置名称</span><input v-model="label" placeholder="例如：我的 API" /></label>
              <label><span>模型名称</span><input v-model="model" list="ai-preset-models" :placeholder="selectedPreset?.modelPlaceholder || '选择或填写模型 ID'" /><datalist id="ai-preset-models"><option v-for="item in selectedPreset?.models" :key="item" :value="item" /></datalist></label>
              <label class="wide"><span>Base URL</span><input v-model="baseUrl" :placeholder="selectedPreset?.baseUrlPlaceholder || 'https://.../v1'" /></label>
              <label class="wide"><span>API Key</span><input v-model="apiKey" type="password" :placeholder="desktop ? '安全写入 Windows 凭据库' : '浏览器模式仅保留当前会话'" /></label>
            </div>
            <div class="settings-form-footer"><span><AppIcon name="shield" :size="15" />密钥不会进入备份或 Markdown</span><button class="primary-button" @click="saveProfile">保存配置</button></div>
            <p v-if="profileMessage" class="notice">{{ profileMessage }}</p>
            <div v-if="store.aiProfiles.length" class="profile-list"><div v-for="profile in store.aiProfiles" :key="profile.id" tabindex="0" :class="{ editing: editingProfileId === profile.id }" aria-haspopup="menu" :aria-expanded="aiProfileMenu?.profile.id === profile.id" :aria-label="`${profile.label}；右键或 Shift 加 F10 打开连接操作`" @contextmenu="openAiProfileMenu($event, profile)" @keydown="openAiProfileMenu($event, profile)"><span><b>{{ profile.label }}</b><small>{{ profile.model }} · {{ profile.hasKey ? '系统凭据已保存' : '未持久化 Key' }}</small><em v-if="aiConnectionStates[profile.id]" :class="`is-${aiConnectionStates[profile.id].tone}`" :role="aiConnectionStates[profile.id].tone === 'error' ? 'alert' : 'status'" aria-live="polite"><i></i>{{ aiConnectionStates[profile.id].message }}</em></span><div class="profile-actions"><button class="profile-test" :class="{ running: aiTestControllers.has(profile.id) }" @click.stop="testAiProfile(profile)">{{ aiTestControllers.has(profile.id) ? '停止' : '测试连接' }}</button><button class="profile-edit" @click.stop="editProfile(profile)">{{ editingProfileId === profile.id ? '编辑中' : '编辑' }}</button><button class="profile-delete" :class="{ pending: pendingProfileDelete === profile.id }" @click.stop="deleteProfile(profile.id, profile.label, profile.hasKey)">{{ pendingProfileDelete === profile.id ? '确认删除' : '删除' }}</button></div></div></div>
          </div>
        </section>

        <section id="engines" class="settings-section">
          <header><span><AppIcon name="play" :size="18" /></span><div><h3>本机引擎</h3><p>连接你自己安装的 CLI 与模型</p></div><RouterLink class="section-link" to="/subtitles?transcribe=1">打开字幕台 →</RouterLink></header>
          <div class="settings-panel local-engine-panel">
            <p class="settings-explainer"><AppIcon name="shield" :size="16" />Knitspace 不捆绑模型，也不会上传媒体。只有点击验证或开始转写后，才会在本机启动你选定的 whisper.cpp 兼容 CLI；转写还需要系统可用的 FFmpeg。</p>
            <div class="setting-control local-engine-path"><span><b>Whisper CLI</b><small :title="store.settings.transcriptionExecutablePath">{{ store.settings.transcriptionExecutablePath || '尚未选择，例如 whisper-cli.exe' }}</small></span><button class="quiet-button" :disabled="!desktop || transcriptionChecking" @click="pickTranscriptionExecutable">选择程序</button></div>
            <div class="setting-control local-engine-path"><span><b>本机模型</b><small :title="store.settings.transcriptionModelPath">{{ store.settings.transcriptionModelPath || '尚未选择 .bin 或 .gguf 模型' }}</small></span><button class="quiet-button" :disabled="!desktop || transcriptionChecking" @click="pickTranscriptionModel">选择模型</button></div>
            <div class="setting-control"><span><b>默认识别语言</b><small>自动检测更通用；确定语言通常更稳定</small></span><select :value="store.settings.transcriptionLanguage" @change="store.updateSettings({ transcriptionLanguage: ($event.target as HTMLSelectElement).value as any })"><option value="auto">自动检测</option><option value="zh">中文</option><option value="en">英语</option><option value="ja">日语</option><option value="ko">韩语</option></select></div>
            <div class="local-engine-actions"><p v-if="transcriptionMessage" :class="{ ready: transcriptionReady }" :role="transcriptionReady ? 'status' : 'alert'" aria-live="polite"><i></i>{{ transcriptionMessage }}</p><span v-else>路径会自动保存，但不会自动执行外部程序。</span><button class="primary-button" :disabled="!desktop || transcriptionChecking" @click="verifyTranscriptionEngine">{{ transcriptionChecking ? '验证中…' : '验证本机引擎' }}</button></div>
          </div>
        </section>

        <section id="backup" class="settings-section">
          <header><span><AppIcon name="inbox" :size="18" /></span><div><h3>数据与备份</h3><p>把工作区数据和受管原始文件分开保护</p></div></header>
          <div class="settings-panel backup-panel">
            <section v-if="desktop" class="vault-health-card" :class="{ 'vault-health-card--attention': !vaultHealthLoading && !vaultHealthy, 'vault-health-card--critical': vaultStorageLevel === 'critical' }" tabindex="0" role="group" title="右键查看资料库路径、磁盘空间、完整性与归档操作" aria-label="本地资料库健康状态；右键或 Shift 加 F10 打开操作菜单" aria-haspopup="menu" :aria-expanded="Boolean(vaultMenu)" @contextmenu="openVaultMenu" @keydown="openVaultMenuFromKeyboard">
              <header><div><span>资料库健康度</span><b>本地数据健康</b></div><p :class="{ ready: vaultHealthy }" role="status" aria-live="polite"><i></i>{{ vaultStatusLabel }}</p></header>
              <div v-if="vaultHealth" class="vault-health-grid">
                <article><span>结构</span><b>v{{ vaultHealth.schemaVersion }}</b><small>{{ vaultHealth.schemaVersion === vaultHealth.latestSchemaVersion ? '迁移已是最新' : `应升级至 v${vaultHealth.latestSchemaVersion}` }}</small></article>
                <article><span>内容</span><b>{{ vaultHealth.documentCount }}</b><small>{{ vaultHealth.noteCount }} 笔记 · {{ vaultHealth.questionCount }} 题目</small></article>
                <article><span>结构化</span><b>{{ vaultHealth.vocabularyCount + vaultHealth.sourceCount }}</b><small>{{ vaultHealth.vocabularyCount }} 单词 · {{ vaultHealth.sourceCount }} 资料</small></article>
                <article><span>搜索索引</span><b>{{ vaultHealth.ftsEntryCount }}</b><small>{{ vaultHealth.missingMarkdownCount ? `${vaultHealth.missingMarkdownCount} 个正文缺失` : '全文索引与正文可用' }}</small></article>
              </div>
              <div v-else-if="vaultHealthLoading" class="vault-health-loading" role="status"><span></span><span></span><span></span><p>正在执行 SQLite 快速检查…</p></div>
              <div v-if="vaultStorage || vaultStorageError" class="vault-storage-status" :class="`is-${vaultStorageLevel}`" :role="vaultStorageLevel === 'critical' ? 'alert' : 'status'" :aria-live="vaultStorageLevel === 'critical' ? 'assertive' : 'polite'">
                <AppIcon :name="vaultStorageLevel === 'ready' ? 'shield' : 'warning'" :size="17" />
                <div><b>{{ vaultStorageLevel === 'critical' ? 'Vault 所在磁盘空间严重不足' : vaultStorageLevel === 'low' ? 'Vault 所在磁盘空间偏低' : vaultStorageLevel === 'ready' ? 'Vault 磁盘空间可用' : '未能读取磁盘空间' }}</b><small>{{ vaultStorageLabel }}</small></div>
                <strong v-if="vaultStorage">剩余 {{ formatBytes(vaultStorage.availableBytes) }}<small>共 {{ formatBytes(vaultStorage.totalBytes) }}</small></strong>
                <progress v-if="vaultStorage" :value="vaultStorage.availableBytes" :max="vaultStorage.totalBytes" :aria-label="`资料库磁盘可用 ${vaultStoragePercent.toFixed(2)}%`"></progress>
              </div>
              <p v-if="vaultHealthError" class="vault-health-error" role="alert"><AppIcon name="warning" :size="14" />{{ vaultHealthError }}<button @click.stop="loadVaultHealth">重试</button></p>
              <footer><div><span>{{ vaultHealth?.root || store.vaultRoot || '正在读取资料库位置…' }}</span><small>{{ formatBytes(vaultHealth?.databaseSize) }}<template v-if="automaticBackupAt"> · 最近每日归档 {{ new Date(automaticBackupAt).toLocaleString('zh-CN') }}</template><template v-else> · 尚无每日归档</template></small></div><div><button class="quiet-button" :disabled="vaultHealthLoading" @click.stop="loadVaultHealth">{{ vaultHealthLoading ? '检查中…' : '重新检查' }}</button><button class="quiet-button" @click.stop="revealVault">打开位置</button></div></footer>
            </section>
            <div class="backup-summary"><div class="vault-path"><span>当前资料库</span><b>{{ vaultName }}</b><small>Markdown · SQLite 索引 · 受管原始文件</small></div><p>JSON 快照用于恢复笔记、任务、收藏和设置；它不包含受管原始文件。完整 Vault 归档会连同这些原件保存。<br><small v-if="manualBackupAt">最近手动导出 / 归档：{{ new Date(manualBackupAt).toLocaleString('zh-CN') }}</small><small v-else-if="legacyBackupAt">旧版最近备份记录：{{ new Date(legacyBackupAt).toLocaleString('zh-CN') }}</small><small v-if="automaticBackupAt">最近每日归档：{{ new Date(automaticBackupAt).toLocaleString('zh-CN') }}</small></p></div>
            <div class="backup-options">
              <article v-if="desktop" class="backup-option backup-option--vault"><div class="backup-option__icon"><AppIcon name="shield" :size="17" /></div><div><b>完整 Vault 归档</b><small>包含 SQLite、Markdown 与导入到资料库的原始文件</small></div><div class="backup-option__actions backup-option__actions--vault"><button class="primary-button" :disabled="vaultBackupCreating || vaultBackupRestoring || vaultBackupInspecting" @click="createVaultBackup">{{ vaultBackupCreating ? '正在打包…' : '选择位置并归档' }}</button><button class="quiet-button" :disabled="vaultBackupCreating || vaultBackupRestoring || vaultBackupInspecting" @click="restoreVaultBackup">{{ vaultBackupInspecting ? '正在检查归档…' : vaultBackupRestoring ? '正在恢复…' : '从完整归档恢复' }}</button></div></article>
              <article class="backup-option"><div class="backup-option__icon"><AppIcon name="file-text" :size="17" /></div><div><b>工作区 JSON 快照</b><small>可直接恢复资料索引、笔记、任务、收藏和设置</small></div><div class="backup-option__actions"><button class="quiet-button" :disabled="backupExporting" @click="downloadBackup">{{ backupExporting ? '正在整理正文…' : '导出 JSON' }}</button><button class="quiet-button" :disabled="backupExporting" @click="backupInput?.click()">从 JSON 恢复</button></div><input ref="backupInput" class="visually-hidden" type="file" accept=".json,.knitspace-backup.json,.toolknit-backup.json" @change="restoreBackup" /></article>
            </div>
            <section v-if="vaultRestorePhase === 'working' || vaultRestorePhase === 'reloading'" class="vault-restore-progress" role="status" aria-live="polite" aria-atomic="true">
              <header><span><i></i>{{ vaultRestorePhase === 'reloading' ? '恢复完成，准备重新载入' : '正在执行安全恢复' }}</span><small>请保持 Knitspace 打开</small></header>
              <ol>
                <li class="done"><i></i><span><b>已选择归档</b><small>不会直接覆盖当前资料库</small></span></li>
                <li :class="vaultRestorePhase === 'working' ? 'active' : 'done'"><i></i><span><b>验证并保护当前数据</b><small>检查 SQLite 与 Markdown，再创建恢复前归档</small></span></li>
                <li :class="vaultRestorePhase === 'reloading' ? 'active' : ''"><i></i><span><b>替换并重新载入</b><small>完成后由新的 Vault 重建当前界面</small></span></li>
              </ol>
            </section>
            <section v-if="desktop" class="backup-retention" aria-label="每日 Vault 归档"><AppIcon name="clock" :size="14" /><span>启动后的空闲时间会检查每日 Vault 归档，本机只保留最近 7 份；API Key 和剪贴板历史不会进入归档。</span><div><button class="quiet-button" :disabled="vaultAutoBackupCreating || vaultBackupCreating || vaultBackupRestoring || vaultBackupInspecting" @click="runAutomaticVaultBackup">{{ vaultAutoBackupCreating ? '正在检查…' : '立即检查今日归档' }}</button><button v-if="vaultHealth?.lastAutomaticBackup" class="quiet-button" @click="revealAutomaticBackup">查看最近归档</button></div></section>
            <p v-if="backupMessage" class="notice backup-notice" :class="`is-${backupNoticeTone}`" :role="backupNoticeTone === 'error' ? 'alert' : 'status'" :aria-live="backupNoticeTone === 'error' ? 'assertive' : 'polite'">{{ backupMessage }}</p>
          </div>
        </section>

        <section id="update" class="settings-section">
          <header><span><AppIcon name="clock" :size="18" /></span><div><h3>版本与实验功能</h3><p>检查更新，了解正在开发的本地能力</p></div></header>
          <div class="settings-panel">
            <article class="build-profile-card" :class="`is-${buildProfile.id}`" tabindex="0" role="group" :aria-label="`${buildProfile.label}；右键或 Shift 加 F10 查看版本操作`" aria-haspopup="menu" :aria-expanded="Boolean(buildMenu)" title="右键查看版本信息与构建命令" @contextmenu="openBuildMenu" @keydown="openBuildMenuFromKeyboard">
              <header><span><AppIcon :name="personalPackEnabled ? 'terminal' : 'shield'" :size="17" /></span><div><small>CURRENT BUILD · {{ buildProfile.badge }}</small><h4>{{ buildProfile.title }}</h4></div><b>{{ buildProfile.label }}</b></header>
              <p>{{ buildProfile.summary }}</p>
              <footer><span><i></i>{{ buildProfile.capability }}</span><button class="quiet-button" type="button" @click.stop="openBuildPrimaryAction">{{ buildProfile.primaryAction }}</button></footer>
            </article>
            <div class="setting-control"><span><b>Knitspace v{{appVersion}}</b><small>{{store.settings.lastUpdateCheck?`上次检查 ${new Date(store.settings.lastUpdateCheck).toLocaleString('zh-CN')}`:'尚未检查更新'}}</small></span><button class="quiet-button" :disabled="checkingUpdate||!desktop" @click="checkUpdate">{{checkingUpdate?'检查中…':'检查更新'}}</button></div>
            <label class="setting-toggle"><span><b>每日自动检查</b><small>离线时会静默跳过，不自动下载安装</small></span><input type="checkbox" :checked="store.settings.autoCheckUpdates" @change="store.updateSettings({autoCheckUpdates:!store.settings.autoCheckUpdates})"/></label>
            <div class="setting-control"><span><b>Windows 离线 OCR</b><small>已作为正式本机能力接入；实际语言包状态会在工具页检查</small></span><RouterLink class="quiet-button" to="/ocr">打开 OCR</RouterLink></div>
            <div class="setting-control"><span><b>公式图片识别</b><small>已接入可校对草稿流程；图片只会在明确确认后发送到选定服务</small></span><RouterLink class="quiet-button" to="/documents?kind=note&create=note&mode=split&insert=formula&recognize=formula">打开识别</RouterLink></div>
            <p v-if="updateMessage" class="notice">{{updateMessage}}</p><button v-if="updateResult && updateResult.tag_name.replace(/^v/,'')!==appVersion" class="new-task" @click="openExternalUrl(updateResult.html_url)">打开 GitHub Release →</button>
          </div>
        </section>
      </main>
    </div>
    <VaultRestorePreviewDialog v-if="vaultRestoreReview" :inspection="vaultRestoreReview.inspection" :current="vaultHealth" :busy="vaultBackupRestoring" :error="vaultRestoreError" @cancel="cancelVaultRestoreReview" @confirm="confirmVaultRestore" />
    <section v-if="vaultMenu" ref="vaultMenuElement" class="settings-vault-menu" role="menu" aria-label="资料库快捷操作" :style="{ left: `${vaultMenu.x}px`, top: `${vaultMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleVaultMenuKeydown">
      <header><span>本地资料库</span><b>{{ vaultName }}</b></header>
      <button role="menuitem" @click="closeVaultMenu(); loadVaultHealth()"><AppIcon name="shield" :size="15" />重新检查完整性</button>
      <button role="menuitem" @click="revealVault"><AppIcon name="inbox" :size="15" />在资源管理器中查看</button>
      <button role="menuitem" @click="copyVaultPath"><AppIcon name="duplicate" :size="15" />复制资料库路径</button>
      <button role="menuitem" @click="copyStorageDiagnosis"><AppIcon name="warning" :size="15" />复制磁盘空间诊断</button>
      <button role="menuitem" :disabled="vaultAutoBackupCreating || vaultBackupCreating || vaultBackupRestoring || vaultBackupInspecting" @click="runAutomaticVaultBackup"><AppIcon name="clock" :size="15" />检查今日每日归档</button>
      <button v-if="vaultHealth?.lastAutomaticBackup" role="menuitem" @click="revealAutomaticBackup"><AppIcon name="archive" :size="15" />查看最近每日归档</button>
      <button role="menuitem" @click="closeVaultMenu(); createVaultBackup()"><AppIcon name="archive" :size="15" />创建完整归档</button>
      <button class="danger" role="menuitem" @click="closeVaultMenu(); restoreVaultBackup()"><AppIcon name="refresh" :size="15" />从完整归档恢复…</button>
    </section>
    <section v-if="buildMenu" ref="buildMenuElement" class="settings-vault-menu build-profile-menu" role="menu" aria-label="当前构建版本操作" :style="{ left: `${buildMenu.x}px`, top: `${buildMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleBuildMenuKeydown">
      <header><span>BUILD · {{ buildProfile.badge }}</span><b>{{ buildProfile.title }}</b></header>
      <button role="menuitem" @click="openBuildPrimaryAction"><AppIcon :name="personalPackEnabled ? 'terminal' : 'toolbox'" :size="15" />{{ buildProfile.primaryAction }}</button>
      <button role="menuitem" @click="copyBuildDetails"><AppIcon name="duplicate" :size="15" />复制当前版本信息</button>
      <button role="menuitem" @click="copyBuildCommand"><AppIcon name="code" :size="15" />复制对应构建命令</button>
    </section>
    <section v-if="aiProfileMenu" ref="aiProfileMenuElement" class="settings-vault-menu ai-profile-menu" role="menu" aria-label="AI 配置连接操作" :style="{ left: `${aiProfileMenu.x}px`, top: `${aiProfileMenu.y}px` }" @click.stop @contextmenu.prevent @keydown.stop="handleAiProfileMenuKeydown">
      <header><span>自带模型 · 密钥不外传</span><b>{{ aiProfileMenu.profile.label }}</b></header>
      <button role="menuitem" @click="testAiProfile(aiProfileMenu.profile)"><AppIcon :name="aiTestControllers.has(aiProfileMenu.profile.id) ? 'close' : 'play'" :size="15" />{{ aiTestControllers.has(aiProfileMenu.profile.id) ? '停止连接检查' : '测试连接' }}</button>
      <button role="menuitem" @click="editAiProfileFromMenu(aiProfileMenu.profile)"><AppIcon name="settings" :size="15" />编辑配置</button>
      <button role="menuitem" @click="copyAiProfileDiagnosis(aiProfileMenu.profile)"><AppIcon name="duplicate" :size="15" />复制连接诊断</button>
      <button role="menuitem" @click="openAiWorkbench(aiProfileMenu.profile)"><AppIcon name="sparkle" :size="15" />使用此配置打开 AI 工作台</button>
    </section>
  </div>
</template>

<style scoped>
.profile-list > div.editing {
  border-color: color-mix(in srgb, var(--green) 38%, var(--line));
  background: var(--green-bg);
}
.profile-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
}
.profile-list > div:focus-visible { outline: 2px solid color-mix(in srgb, var(--green) 45%, transparent); outline-offset: 2px; }
.profile-list > div > span { min-width: 0; }
.profile-list em { display: flex; align-items: center; gap: 5px; margin-top: 5px; color: var(--muted); font: 9px/1.4 var(--font-ui); font-style: normal; }
.profile-list em i { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--muted); }
.profile-list em.is-working i { background: var(--warn); box-shadow: 0 0 0 3px var(--warn-soft); }
.profile-list em.is-success { color: var(--green-strong); }.profile-list em.is-success i { background: var(--green); }
.profile-list em.is-error { color: var(--danger); }.profile-list em.is-error i { background: var(--danger); }
.profile-test { padding: 5px 7px; border: 1px solid color-mix(in srgb, var(--green) 25%, var(--line)); border-radius: 5px; color: var(--green-strong); background: var(--green-bg); font-size: 9px; }
.profile-test.running { color: var(--danger); border-color: var(--danger-soft); background: var(--danger-soft); }
.ai-profile-menu { z-index: var(--z-context-menu); }
.profile-edit {
  padding: 5px 7px;
  border: 1px solid var(--line);
  border-radius: 5px;
  color: var(--text-secondary);
  background: var(--surface);
  font-size: 9px;
}
.profile-edit:hover {
  border-color: color-mix(in srgb, var(--green) 36%, var(--line));
  color: var(--green-strong);
  background: var(--green-bg);
}
.backup-summary > p > small {
  display: block;
  margin-top: 4px;
}
.backup-retention {
  align-items: center;
}
.backup-retention > span {
  min-width: 0;
  flex: 1;
}
.backup-retention > div {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
}
.backup-retention .quiet-button {
  min-height: 30px;
  padding-inline: 9px;
  font-size: 9px;
}
@media (max-width: 760px) {
  .backup-retention {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .backup-retention > div {
    width: 100%;
  }
  .backup-retention .quiet-button {
    flex: 1;
  }
}
</style>
