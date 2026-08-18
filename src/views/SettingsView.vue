<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowReactive, shallowRef, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { open, save } from '@tauri-apps/plugin-dialog'
import { checkDesktopUpdate, createDesktopAutoBackup, createDesktopVaultBackup, getDesktopVaultHealth, getDesktopVaultStorageSpace, hasStoredApiKey, inspectDesktopVaultBackup, isDesktop, openExternalUrl, probeDesktopTranscriptionEngine, removeApiKey, restoreDesktopVaultBackup, revealDesktopFile, setClipboardMonitor, storeApiKey, type DesktopStorageSpace, type DesktopVaultBackupInspection, type DesktopVaultHealth, type GitHubRelease } from '@/lib/native'
import { cancelDictionaryInstall, installDictionary, listenDictionaryProgress, readDictionaryStatus, removeDictionary, type DictionaryStatus } from '@/lib/dictionary-native'
import { chooseOutputDirectory } from '@/lib/output'
import { newId } from '@/lib/id'
import { aiErrorMessage, getSessionApiKey, removeSessionApiKey, setSessionApiKey, testAiConnection } from '@/lib/ai'
import { downloadText } from '@/lib/code-image'
import { aiProviderPresets, findAiProviderPreset } from '@/lib/ai-presets'
import { useWorkbenchStore } from '@/stores/workbench'
import { useUiStore } from '@/stores/ui'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import FieldRow from '@/components/FieldRow.vue'
import SettingRow from '@/components/SettingRow.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import ToggleSwitch from '@/components/ToggleSwitch.vue'
import { applyTheme, themePreference, type ThemePreference } from '@/lib/theme'
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
const dictionary = ref<DictionaryStatus>({ installed: false, path: '', version: '', entryCount: 0, sizeBytes: 0, downloadBytes: 0 })
const dictionaryRunId = ref('')
const dictionaryProgress = ref({ progress: 0, detail: '' })
let dictionaryUnlisten: (() => void) | undefined
const dictionaryBusy = computed(() => Boolean(dictionaryRunId.value))
const dictionarySizeLabel = computed(() => `${Math.round((dictionary.value.sizeBytes || dictionary.value.downloadBytes) / (1024 * 1024))} MB`)
const dictionaryDescription = computed(() => dictionary.value.installed
  ? `已就绪 · ${dictionary.value.entryCount.toLocaleString('en-US')} 个词条 · ${dictionarySizeLabel.value}`
  : dictionaryBusy.value ? dictionaryProgress.value.detail || '正在准备…' : `尚未安装，需要下载约 ${dictionarySizeLabel.value}`)

async function refreshDictionary() {
  try { dictionary.value = await readDictionaryStatus() }
  catch { /* 未安装或读取失败时保持未安装态，设置页不该因此报错 */ }
}

async function enableDictionary() {
  if (dictionaryBusy.value) return
  const runId = crypto.randomUUID()
  dictionaryRunId.value = runId
  dictionaryProgress.value = { progress: 0, detail: '正在连接下载地址' }
  try {
    dictionary.value = await installDictionary(runId)
    ui.toast('词库已就绪', `共 ${dictionary.value.entryCount.toLocaleString('en-US')} 个词条，现在输入单词即可自动补全。`, 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('已取消')) ui.toast('已取消下载', '词库没有安装，随时可以重来。', 'info')
    else ui.toast('词库安装失败', message, 'error')
    await refreshDictionary()
  } finally {
    dictionaryRunId.value = ''
    dictionaryProgress.value = { progress: 0, detail: '' }
  }
}

async function stopDictionaryInstall() {
  if (!dictionaryRunId.value) return
  await cancelDictionaryInstall(dictionaryRunId.value)
}

async function deleteDictionary() {
  try {
    dictionary.value = await removeDictionary()
    ui.toast('词库已删除', '磁盘空间已释放；随时可以重新下载。', 'success')
  } catch (error) {
    ui.toast('无法删除词库', error instanceof Error ? error.message : '删除失败。', 'error')
  }
}

onMounted(async () => {
  void refreshDictionary()
  dictionaryUnlisten = await listenDictionaryProgress((payload) => {
    if (payload.runId !== dictionaryRunId.value) return
    dictionaryProgress.value = { progress: payload.progress, detail: payload.detail }
  })
})

onBeforeUnmount(() => dictionaryUnlisten?.())
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
// The swatch reads the same variable the reading surface paints with, so a
// sample cannot drift from its paper. It used to carry the light-theme hex
// literal, which meant every swatch lied in the dark theme.
const paperToneOptions = [
  { id: 'warm', label: '暖纸', color: 'var(--paper-warm)' },
  { id: 'neutral', label: '清白', color: 'var(--paper-neutral)' },
  { id: 'mist', label: '雾绿', color: 'var(--paper-mist)' },
  { id: 'night', label: '夜墨', color: 'var(--paper-night)' },
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
function desktopErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error.trim()
  return fallback
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
    backupMessage.value = `完整归档未完成：${desktopErrorMessage(error, '完整归档暂时无法创建。')}`
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
  void router.push(personalPackEnabled ? '/private-tools' : '/')
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
    backupMessage.value = `归档不可恢复：${desktopErrorMessage(error, '无法检查所选完整 Vault 归档。')}`
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
    vaultRestoreError.value = `完整恢复未完成：${desktopErrorMessage(error, '完整 Vault 暂时无法恢复。')}`
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


/** The index down the left. Kept as data so the nav and the anchors cannot
 *  drift apart the way seven hand-written RouterLinks did. */
const sections = [
  { id: 'config', label: '常规', icon: 'settings' },
  { id: 'appearance', label: '阅读与外观', icon: 'palette' },
  { id: 'clipboard', label: '剪贴板', icon: 'file-text' },
  { id: 'ai', label: 'AI 服务', icon: 'sparkle' },
  { id: 'engines', label: '本机引擎', icon: 'play' },
  { id: 'dictionary', label: '离线词库', icon: 'book' },
  { id: 'backup', label: '数据与备份', icon: 'inbox' },
  { id: 'update', label: '版本更新', icon: 'clock' },
] as const
const activeSection = computed(() => {
  const requested = route.query.section
  return typeof requested === 'string' && sections.some((item) => item.id === requested) ? requested : 'config'
})

const themeOptions = [
  { id: 'system', label: '跟随系统' },
  { id: 'dark', label: '深色' },
  { id: 'light', label: '浅色' },
] as const

/** Restoring a vault is three distinct operations, and which one is running
 *  is the only thing that distinguishes "working" from "hung". */
const restoreSteps = computed(() => [
  { title: '已选择归档', detail: '不会直接覆盖当前资料库', state: 'done' as const },
  {
    title: '验证并保护当前数据',
    detail: '检查 SQLite 与 Markdown，再创建恢复前归档',
    state: vaultRestorePhase.value === 'working' ? ('active' as const) : ('done' as const),
  },
  {
    title: '替换并重新载入',
    detail: '完成后由新的 Vault 重建当前界面',
    state: vaultRestorePhase.value === 'reloading' ? ('active' as const) : ('pending' as const),
  },
])
</script>

<template>
  <div class="page-enter page-shell px-8 py-6" @click="closeVaultMenu(); closeBuildMenu(); closeAiProfileMenu()">
    <PageHeader title="设置" subtitle="桌面行为、隐私边界、服务连接与工作区数据，改动即时生效">
      <template #actions>
        <span class="row gap-1.5 h-9 px-3 rounded-sm bg-success-soft text-[12px] text-success">
          <AppIcon name="check" :size="14" />更改自动保存
        </span>
      </template>
    </PageHeader>

    <div class="grid gap-6 grid-cols-1 xl:grid-cols-[200px_minmax(0,1fr)] items-start">
      <!-- The index scrolls with the page until it reaches the top, then
           stays. Settings is long enough that losing the map costs more than
           the 200px it takes up. -->
      <nav class="stack gap-0.5 xl:sticky xl:top-6" aria-label="设置分类">
        <RouterLink
          v-for="item in sections"
          :key="item.id"
          :to="{ path: '/settings', query: { section: item.id } }"
          class="nav-item"
          :class="activeSection === item.id ? 'nav-item-active' : ''"
          :aria-current="activeSection === item.id ? 'page' : undefined"
        >
          <AppIcon :name="item.icon" :size="15" class="shrink-0" />
          <span>{{ item.label }}</span>
        </RouterLink>

        <p class="row gap-2 mt-3 px-2.5 py-2.5 rounded-sm bg-surface-2 text-[11px] leading-snug text-fg-3">
          <AppIcon name="shield" :size="15" class="shrink-0 text-success" />
          没有遥测，不会静默上传
        </p>
      </nav>

      <div class="stack gap-6 min-w-0">
        <!-- ── 常规 ──────────────────────────────────────────────────────── -->
        <section id="config" class="panel px-5 py-4 stack gap-1 scroll-mt-6">
          <header class="stack gap-0.5 pb-2">
            <h3 class="text-[15px] font-semibold text-fg">常规</h3>
            <p class="text-[12px] text-fg-3">桌面窗口、导出位置与系统通知</p>
          </header>

          <SettingRow
            interactive
            title="默认输出目录"
            :description="store.settings.outputDirectory || '尚未设置，首次导出时会问你要放在哪里'"
            :disabled-note="desktop ? undefined : '浏览器模式下由下载目录接管'"
          >
            <button class="btn-default btn-sm" :disabled="!desktop" @click="pickOutputDirectory">选择目录</button>
          </SettingRow>

          <SettingRow interactive title="关闭窗口时" description="托盘菜单里始终可以彻底退出">
            <select
              class="field w-36"
              :value="store.settings.closeBehavior"
              aria-label="关闭窗口时的行为"
              @change="store.updateSettings({ closeBehavior: ($event.target as HTMLSelectElement).value as any })"
            >
              <option value="ask">每次询问</option>
              <option value="tray">隐藏到托盘</option>
              <option value="quit">彻底退出</option>
            </select>
          </SettingRow>

          <SettingRow title="Markdown 自动保存" description="停笔后写入本地；大文档会自动延长间隔，Ctrl+S 始终可用">
            <ToggleSwitch
              :model-value="store.settings.documentAutoSave"
              label="Markdown 自动保存"
              @update:model-value="store.updateSettings({ documentAutoSave: $event })"
            />
          </SettingRow>

          <SettingRow title="系统通知" description="长任务完成、失败、备份和更新时提醒">
            <ToggleSwitch
              :model-value="store.settings.notificationsEnabled"
              label="系统通知"
              @update:model-value="store.updateSettings({ notificationsEnabled: $event })"
            />
          </SettingRow>
        </section>

        <!-- ── 阅读与外观 ────────────────────────────────────────────────── -->
        <section id="appearance" class="panel px-5 py-4 stack gap-4 scroll-mt-6">
          <header class="stack gap-0.5">
            <h3 class="text-[15px] font-semibold text-fg">阅读与外观</h3>
            <p class="text-[12px] text-fg-3">界面主题，以及 Markdown 阅读与源码编辑的排版</p>
          </header>

          <div class="grid gap-5 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div class="stack gap-4 min-w-0">
              <!-- The theme lived only in the rail as a two-state flip, so
                   "follow the system" was unreachable from anywhere. -->
              <FieldRow label="界面主题" hint="跟随系统时会随 Windows 的深浅色设置切换">
                <SegmentedControl
                  :options="themeOptions"
                  :model-value="themePreference"
                  label="界面主题"
                  @update:model-value="applyTheme($event as ThemePreference)"
                />
              </FieldRow>

              <FieldRow label="正文字号" hint="同步调整源码编辑器，保持阅读与书写的比例">
                <SegmentedControl
                  :options="readingScaleOptions"
                  :model-value="store.settings.readingScale"
                  label="正文字号"
                  @update:model-value="store.updateSettings({ readingScale: $event as any })"
                />
              </FieldRow>

              <FieldRow label="行间距" hint="公式和代码块较多的长文也留得住呼吸感">
                <SegmentedControl
                  :options="readingDensityOptions"
                  :model-value="store.settings.readingDensity"
                  label="行间距"
                  @update:model-value="store.updateSettings({ readingDensity: $event as any })"
                />
              </FieldRow>

              <FieldRow label="阅读宽度" hint="限制单行长度，宽屏下视线不至于走得太远">
                <SegmentedControl
                  :options="readingWidthOptions"
                  :model-value="store.settings.readingWidth"
                  label="阅读宽度"
                  @update:model-value="store.updateSettings({ readingWidth: $event as any })"
                />
              </FieldRow>

              <FieldRow label="纸张底色" hint="只作用于阅读与编辑表面，不改变工具界面">
                <div class="row gap-1.5 flex-wrap">
                  <button
                    v-for="option in paperToneOptions"
                    :key="option.id"
                    type="button"
                    :aria-pressed="store.settings.readingPaperTone === option.id"
                    class="row gap-1.5 h-8 pl-1.5 pr-2.5 rounded-sm border text-[12px] transition-colors"
                    :class="store.settings.readingPaperTone === option.id
                      ? 'border-accent bg-accent-soft text-fg'
                      : 'border-line text-fg-2 hover:border-line-strong'"
                    @click="store.updateSettings({ readingPaperTone: option.id })"
                  >
                    <i class="block w-5 h-5 rounded-[4px] border border-line" :style="{ background: option.color }" />
                    {{ option.label }}
                  </button>
                </div>
              </FieldRow>

              <SettingRow title="减少动态效果" description="关闭入场动画与非必要过渡，低性能设备更稳定">
                <ToggleSwitch
                  :model-value="store.settings.reduceMotion"
                  label="减少动态效果"
                  @update:model-value="store.updateSettings({ reduceMotion: $event })"
                />
              </SettingRow>
            </div>

            <!-- Typography settings are unreadable as numbers. This is the
                 same text the reader will see, under the current values. -->
            <!-- On `well` rather than `surface`: it stands for the reading
                 paper, and against the panel it sits in, a same-value plane
                 would have no edge at all. -->
            <aside class="pane self-start bg-well" aria-label="阅读外观实时预览">
              <header class="pane-head"><p class="pane-title">实时预览</p><small class="text-[11px] text-fg-3">MARKDOWN</small></header>
              <article class="stack gap-2 p-4">
                <p class="text-[11px] font-semibold tracking-wide text-fg-3">本地数字工作台</p>
                <h4 class="text-[16px] font-semibold text-fg">让记录回到思考本身</h4>
                <p class="text-[13px] leading-relaxed text-fg-2">清晰的层级、合适的行长和克制的纸张色，能让长时间阅读更轻松。</p>
                <pre class="m-0 px-2.5 py-2 rounded-sm bg-well overflow-x-auto"><code class="text-[12px] text-fg-2">const idea = notes.link(context)</code></pre>
                <blockquote class="pl-3 border-l-2 border-accent text-[12px] text-fg-3">设置会自动保存，并立即应用到文档。</blockquote>
              </article>
            </aside>
          </div>
        </section>

        <!-- ── 剪贴板 ────────────────────────────────────────────────────── -->
        <section id="clipboard" class="panel px-5 py-4 stack gap-1 scroll-mt-6">
          <header class="row-between gap-3 pb-2">
            <div class="stack gap-0.5">
              <h3 class="text-[15px] font-semibold text-fg">剪贴板</h3>
              <p class="text-[12px] text-fg-3">是否记录，以及在本机保留多久</p>
            </div>
            <RouterLink class="btn-ghost btn-sm shrink-0" to="/clipboard">查看历史</RouterLink>
          </header>

          <SettingRow
            title="后台监听"
            :description="store.settings.clipboardEnabled ? '正在本机保存你复制的文本、代码和图片' : '关闭时完全不读取系统剪贴板'"
          >
            <ToggleSwitch :model-value="store.settings.clipboardEnabled" label="后台监听剪贴板" @update:model-value="changeClipboardEnabled" />
          </SettingRow>

          <SettingRow interactive title="最多保留" description="超出条数后，最旧的记录会被删除">
            <span class="row gap-2">
              <input
                type="number" min="10" max="500" class="field w-24 text-right tabular-nums" aria-label="最多保留条数"
                :value="store.settings.clipboardLimit"
                @change="store.updateSettings({ clipboardLimit: Number(($event.target as HTMLInputElement).value) }); store.pruneClipboard()"
              />
              <small class="text-[12px] text-fg-3">条</small>
            </span>
          </SettingRow>

          <SettingRow interactive title="最长保留" description="超过天数的记录会在下次清理时移除">
            <span class="row gap-2">
              <input
                type="number" min="1" max="365" class="field w-24 text-right tabular-nums" aria-label="最长保留天数"
                :value="store.settings.clipboardRetentionDays"
                @change="store.updateSettings({ clipboardRetentionDays: Number(($event.target as HTMLInputElement).value) }); store.pruneClipboard()"
              />
              <small class="text-[12px] text-fg-3">天</small>
            </span>
          </SettingRow>

          <p class="row gap-2 mt-2 px-3 py-2.5 rounded-sm bg-warn-soft text-[12px] leading-snug text-warn">
            <AppIcon name="warning" :size="15" class="shrink-0" />
            监听不会过滤密码或敏感信息，请只保留你愿意存放在本机的内容。
          </p>
        </section>

        <!-- ── AI 服务 ───────────────────────────────────────────────────── -->
        <section id="ai" class="panel px-5 py-4 stack gap-4 scroll-mt-6">
          <header class="stack gap-0.5">
            <h3 class="text-[15px] font-semibold text-fg">AI 服务</h3>
            <p class="text-[12px] text-fg-3">连接你自己的 OpenAI 兼容接口，Knitspace 不提供内置额度</p>
          </header>

          <p class="px-3 py-2.5 rounded-sm bg-surface-2 text-[12px] leading-snug text-fg-2">
            只有在你主动执行 AI 操作、并确认过要发送的文本之后，内容才会离开这台机器。
          </p>

          <FieldRow label="服务预设" :hint="selectedPreset?.description">
            <select v-model="selectedPresetId" class="field w-full" @change="applyProviderPreset">
              <option v-for="preset in aiProviderPresets" :key="preset.id" :value="preset.id">{{ preset.name }}</option>
            </select>
          </FieldRow>

          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <FieldRow label="配置名称"><input v-model="label" class="field w-full" placeholder="例如：我的 API" /></FieldRow>
            <FieldRow label="模型名称">
              <input v-model="model" list="ai-preset-models" class="field w-full" :placeholder="selectedPreset?.modelPlaceholder || '选择或填写模型 ID'" />
              <datalist id="ai-preset-models"><option v-for="item in selectedPreset?.models" :key="item" :value="item" /></datalist>
            </FieldRow>
          </div>
          <FieldRow label="Base URL"><input v-model="baseUrl" class="field w-full font-mono" :placeholder="selectedPreset?.baseUrlPlaceholder || 'https://.../v1'" /></FieldRow>
          <FieldRow label="API Key" :hint="desktop ? '安全写入 Windows 凭据库，不进入备份或 Markdown' : '浏览器模式下只保留在当前会话'">
            <input v-model="apiKey" type="password" class="field w-full" :placeholder="desktop ? '安全写入 Windows 凭据库' : '仅保留当前会话'" />
          </FieldRow>

          <div class="row justify-end">
            <button class="btn-primary" @click="saveProfile">{{ editingProfileId ? '更新配置' : '保存配置' }}</button>
          </div>
          <p v-if="profileMessage" class="px-3 py-2.5 rounded-sm bg-accent-soft text-[12px] text-accent" role="status">{{ profileMessage }}</p>

          <ul v-if="store.aiProfiles.length" class="stack gap-2">
            <li
              v-for="profile in store.aiProfiles"
              :key="profile.id"
              tabindex="0"
              class="row-between gap-3 px-3 py-2.5 rounded-md border transition-colors"
              :class="editingProfileId === profile.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface-2'"
              aria-haspopup="menu"
              :aria-expanded="aiProfileMenu?.profile.id === profile.id"
              :aria-label="`${profile.label}；右键或 Shift 加 F10 打开连接操作`"
              @contextmenu="openAiProfileMenu($event, profile)"
              @keydown="openAiProfileMenu($event, profile)"
            >
              <span class="stack gap-0.5 min-w-0">
                <b class="text-[13px] font-medium text-fg truncate">{{ profile.label }}</b>
                <small class="text-[12px] text-fg-3 truncate">{{ profile.model }} · {{ profile.hasKey ? '密钥已存入系统凭据库' : '密钥未持久化' }}</small>
                <em
                  v-if="aiConnectionStates[profile.id]"
                  class="row gap-1.5 mt-1 text-[12px] not-italic"
                  :class="{ 'text-warn': aiConnectionStates[profile.id].tone === 'working',
                            'text-success': aiConnectionStates[profile.id].tone === 'success',
                            'text-danger': aiConnectionStates[profile.id].tone === 'error',
                            'text-fg-3': aiConnectionStates[profile.id].tone === 'neutral' }"
                  :role="aiConnectionStates[profile.id].tone === 'error' ? 'alert' : 'status'"
                  aria-live="polite"
                >
                  <i class="w-1.5 h-1.5 rounded-full bg-current shrink-0" />{{ aiConnectionStates[profile.id].message }}
                </em>
              </span>
              <span class="row gap-1 shrink-0">
                <button class="btn-ghost btn-sm" :class="aiTestControllers.has(profile.id) ? 'text-danger' : ''" @click.stop="testAiProfile(profile)">
                  {{ aiTestControllers.has(profile.id) ? '停止' : '测试连接' }}
                </button>
                <button class="btn-ghost btn-sm" @click.stop="editProfile(profile)">{{ editingProfileId === profile.id ? '编辑中' : '编辑' }}</button>
                <button
                  class="btn-ghost btn-sm"
                  :class="pendingProfileDelete === profile.id ? 'bg-danger text-white' : 'text-fg-3 hover:text-danger'"
                  @click.stop="deleteProfile(profile.id, profile.label, profile.hasKey)"
                >
                  {{ pendingProfileDelete === profile.id ? '确认删除' : '删除' }}
                </button>
              </span>
            </li>
          </ul>
        </section>

        <!-- ── 离线词库 ──────────────────────────────────────────────────────
             The vocabulary tool asks for a word and fills in the rest, which
             only works if a dictionary is on the machine. Downloading it is a
             deliberate click, never automatic: it is a large third-party file. -->
        <section id="dictionary" class="panel px-5 py-4 stack gap-1 scroll-mt-6">
          <header class="row-between gap-3 pb-2">
            <div class="stack gap-0.5">
              <h3 class="text-[15px] font-semibold text-fg">离线词库</h3>
              <p class="text-[12px] text-fg-3">装好之后，生词本只要一个单词</p>
            </div>
            <RouterLink class="btn-ghost btn-sm shrink-0" to="/words">打开单词库</RouterLink>
          </header>

          <p class="row items-start gap-2 mb-1 text-[12px] leading-relaxed text-fg-2">
            <AppIcon name="shield" :size="15" class="shrink-0 text-success" />
            词库是 ECDICT（MIT 许可，约 77 万词条）。只有点击下面的按钮才会向 GitHub 发起一次下载；装好后查词全程离线，文件不进资料库、不进备份。
          </p>

          <SettingRow interactive title="ECDICT 英汉词库" :description="dictionaryDescription">
            <span class="row gap-2">
              <button v-if="dictionaryBusy" class="btn-default btn-sm" @click="stopDictionaryInstall">停止</button>
              <button v-else-if="dictionary.installed" class="btn-default btn-sm" :disabled="!desktop" @click="deleteDictionary">删除</button>
              <button v-else class="btn-primary btn-sm" :disabled="!desktop" @click="enableDictionary">启用词库</button>
            </span>
          </SettingRow>

          <div v-if="dictionaryBusy" class="stack gap-1.5 px-1 py-2" role="status" aria-live="polite">
            <div class="h-1.5 w-full rounded-full bg-well overflow-hidden">
              <i class="block h-full rounded-full bg-accent transition-[width] duration-200" :style="{ width: `${dictionaryProgress.progress}%` }" />
            </div>
            <small class="text-[11px] tabular-nums text-fg-3">{{ dictionaryProgress.progress }}% · {{ dictionaryProgress.detail }}</small>
          </div>

          <p v-if="!desktop" class="px-1 text-[11px] leading-relaxed text-fg-3">离线词库只在桌面版可用。</p>
        </section>

        <!-- ── 本机引擎 ──────────────────────────────────────────────────── -->
        <section id="engines" class="panel px-5 py-4 stack gap-1 scroll-mt-6">
          <header class="row-between gap-3 pb-2">
            <div class="stack gap-0.5">
              <h3 class="text-[15px] font-semibold text-fg">本机引擎</h3>
              <p class="text-[12px] text-fg-3">连接你自己安装的 CLI 与模型</p>
            </div>
            <RouterLink class="btn-ghost btn-sm shrink-0" to="/subtitles?transcribe=1">打开字幕台</RouterLink>
          </header>

          <p class="row gap-2 mb-2 px-3 py-2.5 rounded-sm bg-surface-2 text-[12px] leading-snug text-fg-2">
            <AppIcon name="shield" :size="15" class="shrink-0 text-success" />
            Knitspace 不捆绑模型，也不会上传媒体。只有点击验证或开始转写后，才会在本机启动你选定的 whisper.cpp 兼容 CLI；转写还需要系统可用的 FFmpeg。
          </p>

          <SettingRow interactive title="Whisper CLI" :description="store.settings.transcriptionExecutablePath || '尚未选择，例如 whisper-cli.exe'">
            <button class="btn-default btn-sm" :disabled="!desktop || transcriptionChecking" @click="pickTranscriptionExecutable">选择程序</button>
          </SettingRow>

          <SettingRow interactive title="本机模型" :description="store.settings.transcriptionModelPath || '尚未选择 .bin 或 .gguf 模型'">
            <button class="btn-default btn-sm" :disabled="!desktop || transcriptionChecking" @click="pickTranscriptionModel">选择模型</button>
          </SettingRow>

          <SettingRow interactive title="默认识别语言" description="自动检测更通用；确定语言时通常更稳定">
            <select
              class="field w-32"
              aria-label="默认识别语言"
              :value="store.settings.transcriptionLanguage"
              @change="store.updateSettings({ transcriptionLanguage: ($event.target as HTMLSelectElement).value as any })"
            >
              <option value="auto">自动检测</option>
              <option value="zh">中文</option>
              <option value="en">英语</option>
              <option value="ja">日语</option>
              <option value="ko">韩语</option>
            </select>
          </SettingRow>

          <div class="row-between gap-3 pt-3">
            <p
              v-if="transcriptionMessage"
              class="row gap-1.5 text-[12px]"
              :class="transcriptionReady ? 'text-success' : 'text-danger'"
              :role="transcriptionReady ? 'status' : 'alert'"
              aria-live="polite"
            >
              <i class="w-1.5 h-1.5 rounded-full bg-current shrink-0" />{{ transcriptionMessage }}
            </p>
            <p v-else class="text-[12px] text-fg-3">路径会自动保存，但不会自动执行外部程序。</p>
            <button class="btn-primary btn-sm shrink-0" :disabled="!desktop || transcriptionChecking" @click="verifyTranscriptionEngine">
              {{ transcriptionChecking ? '验证中…' : '验证本机引擎' }}
            </button>
          </div>
        </section>

        <!-- ── 数据与备份 ────────────────────────────────────────────────── -->
        <section id="backup" class="panel px-5 py-4 stack gap-4 scroll-mt-6">
          <header class="stack gap-0.5">
            <h3 class="text-[15px] font-semibold text-fg">数据与备份</h3>
            <p class="text-[12px] text-fg-3">工作区数据和受管原始文件分开保护</p>
          </header>

          <section
            v-if="desktop"
            class="stack gap-3 p-4 rounded-md border"
            :class="vaultStorageLevel === 'critical' ? 'border-danger bg-danger-soft'
              : !vaultHealthLoading && !vaultHealthy ? 'border-warn bg-warn-soft' : 'border-line bg-surface-2'"
            tabindex="0"
            role="group"
            title="右键查看资料库路径、磁盘空间、完整性与归档操作"
            aria-label="本地资料库健康状态；右键或 Shift 加 F10 打开操作菜单"
            aria-haspopup="menu"
            :aria-expanded="Boolean(vaultMenu)"
            @contextmenu="openVaultMenu"
            @keydown="openVaultMenuFromKeyboard"
          >
            <header class="row-between gap-3">
              <b class="text-[13px] font-semibold text-fg">资料库健康度</b>
              <p class="row gap-1.5 text-[12px]" :class="vaultHealthy ? 'text-success' : 'text-warn'" role="status" aria-live="polite">
                <i class="w-1.5 h-1.5 rounded-full bg-current shrink-0" />{{ vaultStatusLabel }}
              </p>
            </header>

            <div v-if="vaultHealth" class="grid gap-px grid-cols-2 sm:grid-cols-4 rounded-md bg-line border border-line overflow-hidden">
              <article class="stack gap-0.5 px-3 py-2.5 bg-surface">
                <span class="text-[11px] text-fg-3">结构</span>
                <b class="text-[16px] font-semibold tabular-nums text-fg">v{{ vaultHealth.schemaVersion }}</b>
                <small class="text-[11px] text-fg-3">{{ vaultHealth.schemaVersion === vaultHealth.latestSchemaVersion ? '迁移已是最新' : `应升级至 v${vaultHealth.latestSchemaVersion}` }}</small>
              </article>
              <article class="stack gap-0.5 px-3 py-2.5 bg-surface">
                <span class="text-[11px] text-fg-3">内容</span>
                <b class="text-[16px] font-semibold tabular-nums text-fg">{{ vaultHealth.documentCount }}</b>
                <small class="text-[11px] text-fg-3">{{ vaultHealth.noteCount }} 笔记 · {{ vaultHealth.questionCount }} 题目</small>
              </article>
              <article class="stack gap-0.5 px-3 py-2.5 bg-surface">
                <span class="text-[11px] text-fg-3">结构化</span>
                <b class="text-[16px] font-semibold tabular-nums text-fg">{{ vaultHealth.vocabularyCount + vaultHealth.sourceCount }}</b>
                <small class="text-[11px] text-fg-3">{{ vaultHealth.vocabularyCount }} 单词 · {{ vaultHealth.sourceCount }} 资料</small>
              </article>
              <article class="stack gap-0.5 px-3 py-2.5 bg-surface">
                <span class="text-[11px] text-fg-3">搜索索引</span>
                <b class="text-[16px] font-semibold tabular-nums text-fg">{{ vaultHealth.ftsEntryCount }}</b>
                <small class="text-[11px] text-fg-3">{{ vaultHealth.missingMarkdownCount ? `${vaultHealth.missingMarkdownCount} 个正文缺失` : '全文索引与正文可用' }}</small>
              </article>
            </div>

            <p v-else-if="vaultHealthLoading" class="row gap-2 text-[12px] text-fg-3" role="status">
              <span class="w-3.5 h-3.5 rounded-full border-2 border-line-strong border-t-accent animate-spin" />
              正在执行 SQLite 快速检查…
            </p>

            <div
              v-if="vaultStorage || vaultStorageError"
              class="stack gap-2 px-3 py-2.5 rounded-sm bg-surface"
              :role="vaultStorageLevel === 'critical' ? 'alert' : 'status'"
              :aria-live="vaultStorageLevel === 'critical' ? 'assertive' : 'polite'"
            >
              <div class="row-between gap-3">
                <span class="row gap-2 min-w-0">
                  <AppIcon
                    :name="vaultStorageLevel === 'ready' ? 'shield' : 'warning'"
                    :size="16"
                    class="shrink-0"
                    :class="vaultStorageLevel === 'critical' ? 'text-danger' : vaultStorageLevel === 'low' ? 'text-warn' : 'text-success'"
                  />
                  <span class="stack gap-0.5 min-w-0">
                    <b class="text-[12px] font-medium text-fg">
                      {{ vaultStorageLevel === 'critical' ? '磁盘空间严重不足'
                        : vaultStorageLevel === 'low' ? '磁盘空间偏低'
                          : vaultStorageLevel === 'ready' ? '磁盘空间可用' : '未能读取磁盘空间' }}
                    </b>
                    <small class="text-[11px] text-fg-3 truncate">{{ vaultStorageLabel }}</small>
                  </span>
                </span>
                <strong v-if="vaultStorage" class="text-[12px] tabular-nums text-fg-2 shrink-0">
                  剩余 {{ formatBytes(vaultStorage.availableBytes) }} / {{ formatBytes(vaultStorage.totalBytes) }}
                </strong>
              </div>
              <div v-if="vaultStorage" class="h-1.5 rounded-full bg-surface-3 overflow-hidden" role="progressbar" :aria-valuenow="Math.round(vaultStoragePercent)" aria-valuemin="0" aria-valuemax="100" :aria-label="`资料库磁盘可用 ${vaultStoragePercent.toFixed(2)}%`">
                <span
                  class="block h-full rounded-full"
                  :class="vaultStorageLevel === 'critical' ? 'bg-danger' : vaultStorageLevel === 'low' ? 'bg-warn' : 'bg-success'"
                  :style="{ width: `${Math.max(2, Math.min(100, vaultStoragePercent))}%` }"
                />
              </div>
            </div>

            <p v-if="vaultHealthError" class="row gap-2 text-[12px] text-danger" role="alert">
              <AppIcon name="warning" :size="14" class="shrink-0" />{{ vaultHealthError }}
              <button class="underline" @click.stop="loadVaultHealth">重试</button>
            </p>

            <footer class="row-between gap-3 pt-2 border-t border-line">
              <div class="stack gap-0.5 min-w-0">
                <span class="text-[12px] text-fg-2 truncate">{{ vaultHealth?.root || store.vaultRoot || '正在读取资料库位置…' }}</span>
                <small class="text-[11px] text-fg-3">
                  {{ formatBytes(vaultHealth?.databaseSize) }}
                  <template v-if="automaticBackupAt"> · 最近每日归档 {{ new Date(automaticBackupAt).toLocaleString('zh-CN') }}</template>
                  <template v-else> · 尚无每日归档</template>
                </small>
              </div>
              <div class="row gap-1 shrink-0">
                <button class="btn-default btn-sm" :disabled="vaultHealthLoading" @click.stop="loadVaultHealth">{{ vaultHealthLoading ? '检查中…' : '重新检查' }}</button>
                <button class="btn-ghost btn-sm" @click.stop="revealVault">打开位置</button>
              </div>
            </footer>
          </section>

          <div class="stack gap-2 px-3 py-3 rounded-md bg-surface-2">
            <div class="row gap-2">
              <AppIcon name="archive" :size="16" class="shrink-0 text-fg-3" />
              <span class="stack gap-0.5 min-w-0">
                <b class="text-[13px] font-medium text-fg">{{ vaultName }}</b>
                <small class="text-[11px] text-fg-3">Markdown · SQLite 索引 · 受管原始文件</small>
              </span>
            </div>
            <p class="text-[12px] leading-snug text-fg-3">
              JSON 快照用于恢复笔记、任务、收藏和设置，它<b class="font-medium text-fg-2">不包含</b>受管原始文件；完整 Vault 归档会连同这些原件一起保存。
            </p>
            <p v-if="manualBackupAt" class="text-[11px] text-fg-3">最近手动导出 / 归档：{{ new Date(manualBackupAt).toLocaleString('zh-CN') }}</p>
            <p v-else-if="legacyBackupAt" class="text-[11px] text-fg-3">旧版最近备份记录：{{ new Date(legacyBackupAt).toLocaleString('zh-CN') }}</p>
          </div>

          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <article v-if="desktop" class="stack gap-3 p-3 rounded-md border border-line">
              <div class="row gap-2">
                <span class="center w-8 h-8 rounded-sm bg-accent-soft text-accent shrink-0"><AppIcon name="shield" :size="17" /></span>
                <span class="stack gap-0.5 min-w-0">
                  <b class="text-[13px] font-medium text-fg">完整 Vault 归档</b>
                  <small class="text-[11px] leading-snug text-fg-3">SQLite、Markdown 与导入资料库的原始文件</small>
                </span>
              </div>
              <div class="row gap-1.5 flex-wrap [&>*]:flex-1 [&>*]:min-w-32">
                <button class="btn-primary btn-sm w-full" :disabled="vaultBackupCreating || vaultBackupRestoring || vaultBackupInspecting" @click="createVaultBackup">
                  {{ vaultBackupCreating ? '正在打包…' : '选择位置并归档' }}
                </button>
                <button class="btn-default btn-sm w-full" :disabled="vaultBackupCreating || vaultBackupRestoring || vaultBackupInspecting" @click="restoreVaultBackup">
                  {{ vaultBackupInspecting ? '正在检查归档…' : vaultBackupRestoring ? '正在恢复…' : '从完整归档恢复' }}
                </button>
              </div>
            </article>

            <article class="stack gap-3 p-3 rounded-md border border-line">
              <div class="row gap-2">
                <span class="center w-8 h-8 rounded-sm bg-surface-3 text-fg-2 shrink-0"><AppIcon name="file-text" :size="17" /></span>
                <span class="stack gap-0.5 min-w-0">
                  <b class="text-[13px] font-medium text-fg">工作区 JSON 快照</b>
                  <small class="text-[11px] leading-snug text-fg-3">资料索引、笔记、任务、收藏与设置</small>
                </span>
              </div>
              <div class="row gap-1.5 flex-wrap [&>*]:flex-1 [&>*]:min-w-32">
                <button class="btn-default btn-sm w-full" :disabled="backupExporting" @click="downloadBackup">{{ backupExporting ? '正在整理正文…' : '导出 JSON' }}</button>
                <button class="btn-default btn-sm w-full" :disabled="backupExporting" @click="backupInput?.click()">从 JSON 恢复</button>
              </div>
              <input ref="backupInput" class="hidden" type="file" accept=".json,.knitspace-backup.json,.toolknit-backup.json" @change="restoreBackup" />
            </article>
          </div>

          <!-- Restoring replaces the whole vault. Showing which of the three
               steps is running is the difference between "wait" and "did it
               hang". -->
          <section v-if="vaultRestorePhase === 'working' || vaultRestorePhase === 'reloading'" class="stack gap-3 p-4 rounded-md border border-accent bg-accent-soft" role="status" aria-live="polite" aria-atomic="true">
            <header class="row-between gap-3">
              <span class="row gap-2 text-[13px] font-medium text-fg">
                <span class="w-3.5 h-3.5 rounded-full border-2 border-line-strong border-t-accent animate-spin shrink-0" />
                {{ vaultRestorePhase === 'reloading' ? '恢复完成，准备重新载入' : '正在执行安全恢复' }}
              </span>
              <small class="text-[11px] text-fg-3">请保持 Knitspace 打开</small>
            </header>
            <ol class="stack gap-2">
              <li
                v-for="step in restoreSteps"
                :key="step.title"
                class="row gap-2.5"
                :class="step.state === 'pending' ? 'opacity-45' : ''"
              >
                <span
                  class="center w-4 h-4 mt-0.5 rounded-full shrink-0 text-[10px]"
                  :class="step.state === 'done' ? 'bg-success text-white' : step.state === 'active' ? 'bg-accent text-white' : 'bg-surface-3 text-fg-3'"
                >
                  <AppIcon v-if="step.state === 'done'" name="check" :size="10" />
                </span>
                <span class="stack gap-0.5">
                  <b class="text-[12px] font-medium text-fg">{{ step.title }}</b>
                  <small class="text-[11px] text-fg-3">{{ step.detail }}</small>
                </span>
              </li>
            </ol>
          </section>

          <div v-if="desktop" class="row-between gap-3 flex-wrap px-3 py-2.5 rounded-sm bg-surface-2" aria-label="每日 Vault 归档">
            <p class="row gap-2 flex-1 min-w-60 text-[12px] leading-snug text-fg-3">
              <AppIcon name="clock" :size="15" class="shrink-0" />
              启动后的空闲时间会检查每日 Vault 归档，本机只保留最近 7 份。API Key 和剪贴板历史不会进入归档。
            </p>
            <div class="row gap-1 shrink-0">
              <button class="btn-ghost btn-sm" :disabled="vaultAutoBackupCreating || vaultBackupCreating || vaultBackupRestoring || vaultBackupInspecting" @click="runAutomaticVaultBackup">
                {{ vaultAutoBackupCreating ? '正在检查…' : '立即检查今日归档' }}
              </button>
              <button v-if="vaultHealth?.lastAutomaticBackup" class="btn-ghost btn-sm" @click="revealAutomaticBackup">查看最近归档</button>
            </div>
          </div>

          <p
            v-if="backupMessage"
            class="px-3 py-2.5 rounded-sm text-[12px] leading-snug"
            :class="backupNoticeTone === 'error' ? 'bg-danger-soft text-danger'
              : backupNoticeTone === 'success' ? 'bg-success-soft text-success'
                : backupNoticeTone === 'working' ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-fg-2'"
            :role="backupNoticeTone === 'error' ? 'alert' : 'status'"
            :aria-live="backupNoticeTone === 'error' ? 'assertive' : 'polite'"
          >
            {{ backupMessage }}
          </p>
        </section>

        <!-- ── 版本更新 ──────────────────────────────────────────────────── -->
        <section id="update" class="panel px-5 py-4 stack gap-1 scroll-mt-6">
          <header class="stack gap-0.5 pb-2">
            <h3 class="text-[15px] font-semibold text-fg">版本与实验功能</h3>
            <p class="text-[12px] text-fg-3">检查更新，了解正在开发的本地能力</p>
          </header>

          <article
            class="stack gap-2.5 mb-3 p-4 rounded-md border border-line bg-surface-2"
            tabindex="0"
            role="group"
            :aria-label="`${buildProfile.label}；右键或 Shift 加 F10 查看版本操作`"
            aria-haspopup="menu"
            :aria-expanded="Boolean(buildMenu)"
            title="右键查看版本信息与构建命令"
            @contextmenu="openBuildMenu"
            @keydown="openBuildMenuFromKeyboard"
          >
            <header class="row-between gap-3">
              <span class="row gap-2.5 min-w-0">
                <span class="center w-8 h-8 rounded-sm bg-surface-3 text-fg-2 shrink-0">
                  <AppIcon :name="personalPackEnabled ? 'terminal' : 'shield'" :size="17" />
                </span>
                <span class="stack gap-0.5 min-w-0">
                  <small class="text-[11px] tracking-wide text-fg-3">当前构建 · {{ buildProfile.badge }}</small>
                  <h4 class="text-[14px] font-semibold text-fg truncate">{{ buildProfile.title }}</h4>
                </span>
              </span>
              <b class="chip-accent shrink-0">{{ buildProfile.label }}</b>
            </header>
            <p class="text-[12px] leading-snug text-fg-2">{{ buildProfile.summary }}</p>
            <footer class="row-between gap-3 pt-2 border-t border-line">
              <span class="row gap-1.5 text-[12px] text-fg-3">
                <i class="w-1.5 h-1.5 rounded-full bg-success shrink-0" />{{ buildProfile.capability }}
              </span>
              <button class="btn-ghost btn-sm shrink-0" type="button" @click.stop="openBuildPrimaryAction">{{ buildProfile.primaryAction }}</button>
            </footer>
          </article>

          <SettingRow
            interactive
            :title="`Knitspace v${appVersion}`"
            :description="store.settings.lastUpdateCheck ? `上次检查 ${new Date(store.settings.lastUpdateCheck).toLocaleString('zh-CN')}` : '尚未检查更新'"
          >
            <button class="btn-default btn-sm" :disabled="checkingUpdate || !desktop" @click="checkUpdate">{{ checkingUpdate ? '检查中…' : '检查更新' }}</button>
          </SettingRow>

          <SettingRow title="每日自动检查" description="离线时会静默跳过，不会自动下载或安装">
            <ToggleSwitch
              :model-value="store.settings.autoCheckUpdates"
              label="每日自动检查更新"
              @update:model-value="store.updateSettings({ autoCheckUpdates: $event })"
            />
          </SettingRow>

          <SettingRow interactive title="Windows 离线 OCR" description="已作为正式本机能力接入，语言包状态在工具页检查">
            <RouterLink class="btn-default btn-sm" to="/ocr">打开 OCR</RouterLink>
          </SettingRow>

          <SettingRow interactive title="公式图片识别" description="已接入可校对草稿流程，图片只在明确确认后发送到选定服务">
            <RouterLink class="btn-default btn-sm" to="/documents?kind=note&create=note&mode=split&insert=formula&recognize=formula">打开识别</RouterLink>
          </SettingRow>

          <p v-if="updateMessage" class="mt-3 px-3 py-2.5 rounded-sm bg-accent-soft text-[12px] text-accent" role="status">{{ updateMessage }}</p>
          <button
            v-if="updateResult && updateResult.tag_name.replace(/^v/, '') !== appVersion"
            class="btn-primary mt-2 self-start"
            @click="openExternalUrl(updateResult.html_url)"
          >
            打开 GitHub Release
          </button>
        </section>
      </div>
    </div>

    <VaultRestorePreviewDialog
      v-if="vaultRestoreReview"
      :inspection="vaultRestoreReview.inspection"
      :current="vaultHealth"
      :busy="vaultBackupRestoring"
      :error="vaultRestoreError"
      @cancel="cancelVaultRestoreReview"
      @confirm="confirmVaultRestore"
    />

    <Teleport to="body">
      <div
        v-if="vaultMenu"
        ref="vaultMenuElement"
        class="fixed z-[120] w-60 p-1 rounded-md bg-surface border border-line-strong shadow-lg"
        role="menu"
        aria-label="资料库快捷操作"
        :style="{ left: `${vaultMenu.x}px`, top: `${vaultMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleVaultMenuKeydown"
      >
        <p class="px-2.5 py-1.5 text-[11px] text-fg-3 truncate">本地资料库 · {{ vaultName }}</p>
        <button class="nav-item w-full" role="menuitem" @click="closeVaultMenu(); loadVaultHealth()"><AppIcon name="shield" :size="15" />重新检查完整性</button>
        <button class="nav-item w-full" role="menuitem" @click="revealVault"><AppIcon name="inbox" :size="15" />在资源管理器中查看</button>
        <button class="nav-item w-full" role="menuitem" @click="copyVaultPath"><AppIcon name="duplicate" :size="15" />复制资料库路径</button>
        <button class="nav-item w-full" role="menuitem" @click="copyStorageDiagnosis"><AppIcon name="warning" :size="15" />复制磁盘空间诊断</button>
        <button class="nav-item w-full" role="menuitem" :disabled="vaultAutoBackupCreating || vaultBackupCreating || vaultBackupRestoring || vaultBackupInspecting" @click="runAutomaticVaultBackup"><AppIcon name="clock" :size="15" />检查今日每日归档</button>
        <button v-if="vaultHealth?.lastAutomaticBackup" class="nav-item w-full" role="menuitem" @click="revealAutomaticBackup"><AppIcon name="archive" :size="15" />查看最近每日归档</button>
        <button class="nav-item w-full" role="menuitem" @click="closeVaultMenu(); createVaultBackup()"><AppIcon name="archive" :size="15" />创建完整归档</button>
        <button class="nav-item w-full hover:bg-danger-soft hover:text-danger" role="menuitem" @click="closeVaultMenu(); restoreVaultBackup()"><AppIcon name="refresh" :size="15" />从完整归档恢复…</button>
      </div>

      <div
        v-if="buildMenu"
        ref="buildMenuElement"
        class="fixed z-[120] w-60 p-1 rounded-md bg-surface border border-line-strong shadow-lg"
        role="menu"
        aria-label="当前构建版本操作"
        :style="{ left: `${buildMenu.x}px`, top: `${buildMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleBuildMenuKeydown"
      >
        <p class="px-2.5 py-1.5 text-[11px] text-fg-3 truncate">{{ buildProfile.badge }} · {{ buildProfile.title }}</p>
        <button class="nav-item w-full" role="menuitem" @click="openBuildPrimaryAction"><AppIcon :name="personalPackEnabled ? 'terminal' : 'toolbox'" :size="15" />{{ buildProfile.primaryAction }}</button>
        <button class="nav-item w-full" role="menuitem" @click="copyBuildDetails"><AppIcon name="duplicate" :size="15" />复制当前版本信息</button>
        <button class="nav-item w-full" role="menuitem" @click="copyBuildCommand"><AppIcon name="code" :size="15" />复制对应构建命令</button>
      </div>

      <div
        v-if="aiProfileMenu"
        ref="aiProfileMenuElement"
        class="fixed z-[120] w-64 p-1 rounded-md bg-surface border border-line-strong shadow-lg"
        role="menu"
        aria-label="AI 配置连接操作"
        :style="{ left: `${aiProfileMenu.x}px`, top: `${aiProfileMenu.y}px` }"
        @click.stop
        @contextmenu.prevent
        @keydown.stop="handleAiProfileMenuKeydown"
      >
        <p class="px-2.5 py-1.5 text-[11px] text-fg-3 truncate">{{ aiProfileMenu.profile.label }} · 密钥不外传</p>
        <button class="nav-item w-full" role="menuitem" @click="testAiProfile(aiProfileMenu.profile)">
          <AppIcon :name="aiTestControllers.has(aiProfileMenu.profile.id) ? 'close' : 'play'" :size="15" />
          {{ aiTestControllers.has(aiProfileMenu.profile.id) ? '停止连接检查' : '测试连接' }}
        </button>
        <button class="nav-item w-full" role="menuitem" @click="editAiProfileFromMenu(aiProfileMenu.profile)"><AppIcon name="settings" :size="15" />编辑配置</button>
        <button class="nav-item w-full" role="menuitem" @click="copyAiProfileDiagnosis(aiProfileMenu.profile)"><AppIcon name="duplicate" :size="15" />复制连接诊断</button>
        <button class="nav-item w-full" role="menuitem" @click="openAiWorkbench(aiProfileMenu.profile)"><AppIcon name="sparkle" :size="15" />用此配置打开 AI 工作台</button>
      </div>
    </Teleport>
  </div>
</template>
