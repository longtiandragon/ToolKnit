<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import ToolLayout from '@/components/ToolLayout.vue'
import { getSessionApiKey, runOrganizerAi } from '@/lib/ai'
import { newId } from '@/lib/id'
import { isDesktop } from '@/lib/native'
import { recognizeDesktopImageBytes } from '@/lib/ocr-native'
import {
  applyOrganizerRule,
  buildOrganizerAiEnvelope,
  detectOrganizerVersionFamilies,
  extractOrganizerPdfExcerpt,
  normalizeOrganizerRelativeDirectory,
  normalizeOrganizerTargetName,
  parseOrganizerSuggestions,
  suggestionsToPlan,
  truncateOrganizerExcerpt,
  type OrganizerAiEnvelope,
  type OrganizerLocalExcerpt,
} from '@/lib/smart-organizer'
import {
  bindDesktopOrganizerRule,
  cancelDesktopSmartOrganizer,
  deleteDesktopOrganizerRule,
  executeDesktopSmartOrganizer,
  getDesktopOrganizerReview,
  listDesktopOrganizerRuleBindings,
  listDesktopOrganizerRules,
  listDesktopSmartOrganizerReceipts,
  listDesktopOrganizerWorkflowSuggestions,
  readDesktopSmartOrganizerAnalysisFile,
  readDesktopSmartOrganizerExcerpts,
  saveDesktopOrganizerAudit,
  saveDesktopOrganizerRule,
  scanDesktopSmartOrganizer,
  unbindDesktopOrganizerRule,
  undoDesktopSmartOrganizer,
  type OrganizerReviewSummary,
  type OrganizerRuleBinding,
  type OrganizerScanResult,
  type OrganizerWorkflowSuggestion,
} from '@/lib/smart-organizer-native'
import { useUiStore } from '@/stores/ui'
import { useWorkbenchStore } from '@/stores/workbench'
import type {
  OrganizerCandidate,
  OrganizerPlanItem,
  OrganizerReceiptSummary,
  OrganizerRule,
  OrganizerTrustLevel,
} from '@/types'

const desktop = isDesktop()
const router = useRouter()
const ui = useUiStore()
const store = useWorkbenchStore()
const sourceRoot = ref('')
const archiveRoot = ref('')
const scanResult = ref<OrganizerScanResult>()
const selectedIds = ref(new Set<string>())
const page = ref(0)
const pageSize = 100
const scanning = ref(false)
const preparing = ref(false)
const askingAi = ref(false)
const executing = ref(false)
const cancelling = ref(false)
const activeRunId = ref('')
const includeImageOcr = ref(false)
const profileId = ref(store.aiProfiles[0]?.id ?? '')
const localExcerpts = ref(new Map<string, OrganizerLocalExcerpt>())
const payloadPreview = ref<OrganizerAiEnvelope>()
const plan = ref<OrganizerPlanItem[]>([])
const activeRuleId = ref('')
const ruleTitle = ref('我的整理规则')
const ruleTrust = ref<OrganizerTrustLevel>('confirmed')
const rules = ref<OrganizerRule[]>([])
const bindings = ref<OrganizerRuleBinding[]>([])
const workflowSuggestions = ref<OrganizerWorkflowSuggestion[]>([])
const review = ref<OrganizerReviewSummary>()
const receipts = ref<OrganizerReceiptSummary[]>([])
const undoingId = ref('')
const message = ref(desktop
  ? '先选择来源目录和归档根。扫描只读，确认前不会发生任何文件变更。'
  : 'AI 智能文件收件箱需要 Windows 桌面端。')

const profile = computed(() => store.aiProfiles.find(item => item.id === profileId.value))
const selectableCandidates = computed(() => scanResult.value?.candidates.filter(item => item.duplicateCount < 2) ?? [])
const selectedCandidates = computed(() => selectableCandidates.value.filter(item => selectedIds.value.has(item.fileId)))
const pageCount = computed(() => Math.max(1, Math.ceil((scanResult.value?.candidates.length ?? 0) / pageSize)))
const visibleCandidates = computed(() => (scanResult.value?.candidates ?? []).slice(page.value * pageSize, (page.value + 1) * pageSize))
const selectedPlan = computed(() => plan.value.filter(item => item.selected))
const activeRule = computed(() => rules.value.find(item => item.id === activeRuleId.value))
const versionFamilies = computed(() => detectOrganizerVersionFamilies(scanResult.value?.candidates ?? []))
const canScan = computed(() => desktop && !scanning.value && !executing.value && Boolean(sourceRoot.value && archiveRoot.value))
const canPrepare = computed(() => !preparing.value && !askingAi.value && selectedCandidates.value.length > 0 && selectedCandidates.value.length <= 100)
const canExecute = computed(() => !executing.value
  && selectedPlan.value.length > 0
  && activeRule.value?.trustLevel !== 'preview'
  && selectedPlan.value.every(item => item.targetBaseName.trim()))
const allVisibleSelected = computed(() => {
  const values = visibleCandidates.value.filter(item => item.duplicateCount < 2)
  return values.length > 0 && values.every(item => selectedIds.value.has(item.fileId))
})
const currentStage = computed(() => {
  if (executing.value || receipts.value.length && !scanResult.value) return 6
  if (plan.value.length) return 5
  if (askingAi.value || payloadPreview.value) return 4
  if (selectedIds.value.size) return 3
  if (scanResult.value) return 2
  return 1
})
const steps = ['选择目录', '本地扫描', '选择文件', '载荷预览', '编辑计划', '执行 / 撤销']

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function excerptBytes(value?: string) {
  return value ? new TextEncoder().encode(value).byteLength : 0
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

function resetAfterScan() {
  selectedIds.value = new Set()
  localExcerpts.value = new Map()
  payloadPreview.value = undefined
  plan.value = []
  activeRuleId.value = ''
  page.value = 0
}

function invalidatePayload() {
  payloadPreview.value = undefined
  plan.value = []
  activeRuleId.value = ''
}

watch([sourceRoot, archiveRoot], () => {
  scanResult.value = undefined
  resetAfterScan()
})
watch(includeImageOcr, () => {
  payloadPreview.value = undefined
  plan.value = []
})
watch(() => store.aiProfiles.map(item => item.id), ids => {
  if (!ids.includes(profileId.value)) profileId.value = ids[0] ?? ''
})

async function chooseDirectory(target: 'source' | 'archive') {
  if (!desktop || scanning.value || executing.value) return
  const selected = await open({
    title: target === 'source' ? '选择待整理来源目录' : '选择归档根目录',
    directory: true,
    multiple: false,
  })
  if (typeof selected !== 'string') return
  if (target === 'source') sourceRoot.value = selected
  else archiveRoot.value = selected
}

async function runScan() {
  if (!canScan.value) return undefined
  scanning.value = true
  message.value = '正在本地扫描文件名、签名、时间与重复校验；最多 5,000 个普通文件。'
  try {
    const result = await scanDesktopSmartOrganizer(sourceRoot.value, archiveRoot.value)
    scanResult.value = result
    resetAfterScan()
    const firstPage = result.candidates.filter(item => item.duplicateCount < 2).slice(0, 100)
    selectedIds.value = new Set(firstPage.map(item => item.fileId))
    message.value = result.scannedCount
      ? `本地扫描完成：${result.scannedCount} 个文件，${result.duplicateCount} 个精确重复项；首批已选择 ${firstPage.length} 个。`
      : '来源目录中没有普通文件。'
    return result
  } catch (error) {
    message.value = errorMessage(error, '智能整理扫描失败。')
    ui.toast('本地扫描失败', message.value, 'error')
    return undefined
  } finally {
    scanning.value = false
  }
}

function toggleCandidate(candidate: OrganizerCandidate) {
  if (candidate.duplicateCount > 1 || preparing.value || askingAi.value || executing.value) return
  const next = new Set(selectedIds.value)
  if (next.has(candidate.fileId)) next.delete(candidate.fileId)
  else {
    if (next.size >= 100) {
      ui.toast('本批已满', '一次 AI 分析最多 100 个文件；请取消其他项目或切换批次。', 'warning')
      return
    }
    next.add(candidate.fileId)
  }
  selectedIds.value = next
  invalidatePayload()
}

function toggleVisible() {
  const values = visibleCandidates.value.filter(item => item.duplicateCount < 2)
  const next = new Set(selectedIds.value)
  if (allVisibleSelected.value) values.forEach(item => next.delete(item.fileId))
  else {
    next.clear()
    values.slice(0, 100).forEach(item => next.add(item.fileId))
  }
  selectedIds.value = next
  invalidatePayload()
}

function removeFromPayload(fileId: string) {
  const next = new Set(selectedIds.value)
  next.delete(fileId)
  selectedIds.value = next
  plan.value = []
  if (!selectedCandidates.value.length) payloadPreview.value = undefined
  else payloadPreview.value = buildOrganizerAiEnvelope(selectedCandidates.value, localExcerpts.value)
}

async function preparePayload() {
  const current = scanResult.value
  if (!current || !canPrepare.value) return
  preparing.value = true
  plan.value = []
  payloadPreview.value = undefined
  message.value = '正在本地生成有界摘要；PDF 使用现有 Worker，图片 OCR 只在你启用后运行。'
  try {
    const candidates = selectedCandidates.value
    const excerpts = new Map((await readDesktopSmartOrganizerExcerpts(current.scanId, candidates.map(item => item.fileId))).map(item => [item.fileId, item]))
    for (const [index, candidate] of candidates.entries()) {
      if (candidate.excerptMode === 'pdf') {
        message.value = `正在本地读取 PDF 文字层 ${index + 1}/${candidates.length}：${candidate.name}`
        try {
          const data = await readDesktopSmartOrganizerAnalysisFile(current.scanId, candidate.fileId)
          excerpts.set(candidate.fileId, await extractOrganizerPdfExcerpt(candidate.fileId, candidate.name, data))
        } catch {
          excerpts.set(candidate.fileId, { fileId: candidate.fileId, excerpt: '', source: 'metadata', truncated: false, byteCount: 0 })
        }
      } else if (candidate.excerptMode === 'ocr' && includeImageOcr.value) {
        message.value = `正在用 Windows OCR 本地识别 ${index + 1}/${candidates.length}：${candidate.name}`
        try {
          const data = await readDesktopSmartOrganizerAnalysisFile(current.scanId, candidate.fileId)
          const result = await recognizeDesktopImageBytes(data)
          const excerpt = truncateOrganizerExcerpt(result.text)
          excerpts.set(candidate.fileId, {
            fileId: candidate.fileId,
            excerpt: excerpt.value,
            source: 'windows-ocr',
            truncated: excerpt.truncated,
            byteCount: new TextEncoder().encode(excerpt.value).byteLength,
          })
        } catch {
          excerpts.set(candidate.fileId, { fileId: candidate.fileId, excerpt: '', source: 'metadata', truncated: false, byteCount: 0 })
        }
      }
    }
    localExcerpts.value = excerpts
    payloadPreview.value = buildOrganizerAiEnvelope(candidates, excerpts)
    message.value = `AI 载荷已就绪：${candidates.length} 个文件、${formatBytes(payloadPreview.value.byteCount)}。请逐项核对，点击后才会发送。`
  } catch (error) {
    message.value = errorMessage(error, '无法生成 AI 载荷预览。')
    ui.toast('载荷预览失败', message.value, 'error')
  } finally {
    preparing.value = false
  }
}

async function requestSuggestions() {
  const envelope = payloadPreview.value
  const currentProfile = profile.value
  if (!envelope || !currentProfile || askingAi.value) return
  const names = envelope.files.map(item => item.name)
  const job = store.addJob('ai', '智能整理 · 生成建议', names, {
    toolId: 'organize:smart-inbox',
    route: '/tools?mode=smart-organizer',
    parameters: { fileCount: names.length, payloadBytes: envelope.byteCount, imageOcr: includeImageOcr.value },
    inputs: envelope.files.map(item => ({ name: item.name, size: item.size, mime: item.mime })),
    retryable: true,
  })
  askingAi.value = true
  store.updateJob(job.id, { status: 'running', progress: 45, detail: '已按载荷预览发送结构化整理请求。' })
  message.value = '正在等待 AI 返回结构化建议；AI 不能执行文件操作。'
  try {
    const raw = await runOrganizerAi(currentProfile, getSessionApiKey(currentProfile.id), envelope.messages)
    const suggestions = parseOrganizerSuggestions(raw, selectedCandidates.value)
    plan.value = suggestionsToPlan(suggestions, selectedCandidates.value)
    activeRuleId.value = ''
    store.updateJob(job.id, { status: 'succeeded', progress: 100, detail: `已生成 ${suggestions.length} 条结构化建议；尚未改动文件。` })
    message.value = `已生成 ${suggestions.length} 条建议。低于 65% 置信度的项目默认不选中，请编辑并核对变更计划。`
  } catch (error) {
    const detail = errorMessage(error, 'AI 整理建议失败。')
    store.updateJob(job.id, { status: 'failed', progress: 100, errorCode: 'AI_ORGANIZER_INVALID_RESPONSE', detail })
    message.value = detail
    ui.toast('没有生成变更计划', detail, 'error')
  } finally {
    askingAi.value = false
  }
}

function validatePlanItems(items: readonly OrganizerPlanItem[]) {
  const candidates = new Map((scanResult.value?.candidates ?? []).map(item => [item.fileId, item]))
  const targets = new Set<string>()
  return items.map(item => {
    const candidate = candidates.get(item.fileId)
    if (!candidate) throw new Error('计划引用了已过期的扫描文件。')
    item.targetRelativeDir = normalizeOrganizerRelativeDirectory(item.targetRelativeDir)
    item.targetBaseName = normalizeOrganizerTargetName(item.targetBaseName, candidate)
    const target = `${item.targetRelativeDir}/${item.targetBaseName}`.toLocaleLowerCase('en-US')
    if (targets.has(target)) throw new Error('计划中存在重复目标；请修改名称或分批执行。')
    targets.add(target)
    return item
  })
}

async function audit(status: 'succeeded' | 'failed' | 'cancelled', movedCount: number, copiedCount: number, failedCount: number, errorCode?: string) {
  const items = selectedPlan.value
  const kinds = [...new Set(items.map(item => scanResult.value?.candidates.find(candidate => candidate.fileId === item.fileId)?.kind).filter((value): value is OrganizerCandidate['kind'] => Boolean(value)))]
  const directories = [...new Set(items.map(item => item.targetRelativeDir))]
  try {
    await saveDesktopOrganizerAudit({
      ruleId: activeRuleId.value || undefined,
      inputKinds: kinds.length ? kinds : ['mixed'],
      operationSequence: ['organizer.scan', activeRuleId.value ? 'organizer.rule' : 'organizer.ai-suggest', 'organizer.execute'],
      targetTemplate: directories.length === 1 ? directories[0] : '{mixed}',
      fileCount: items.length,
      movedCount,
      copiedCount,
      failedCount,
      status,
      errorCode,
    })
  } catch {
    // Audit is helpful but must never change the outcome of an already safe
    // file operation. It contains only counts and structural feature ids.
  }
}

async function executePlan() {
  const current = scanResult.value
  if (!current || !canExecute.value) return
  let items: OrganizerPlanItem[]
  try { items = validatePlanItems([...selectedPlan.value]) }
  catch (error) {
    ui.toast('变更计划无效', errorMessage(error, '请检查目标目录和文件名。'), 'error')
    return
  }
  const trustedManualRun = activeRule.value?.trustLevel === 'trusted'
  if (!trustedManualRun) {
    const approved = await ui.confirm({
      title: `执行 ${items.length} 项文件变更？`,
      message: current.sameVolume
        ? '同卷文件将移动或重命名。执行前会重新校验，先写恢复日志，绝不覆盖；成功后可撤销。'
        : '跨卷只会复制到归档并保留原件。执行前会重新校验，绝不覆盖；成功后可撤销生成的副本。',
      confirmLabel: current.sameVolume ? '确认移动' : '确认复制',
      danger: true,
    })
    if (!approved) return
  }
  const runId = newId()
  const job = store.addJob('archive', '智能整理 · 执行变更计划', items.map(item => item.sourceName), {
    toolId: 'organize:smart-inbox',
    route: '/tools?mode=smart-organizer',
    parameters: { fileCount: items.length, trustLevel: activeRule.value?.trustLevel ?? 'confirmed', crossVolumeCopy: !current.sameVolume },
    inputs: items.map(item => ({ name: item.sourceName, size: item.size })),
    retryable: false,
  })
  activeRunId.value = runId
  executing.value = true
  cancelling.value = false
  store.updateJob(job.id, { status: 'running', progress: 35, detail: '正在重新校验并执行；恢复日志已先写入本机。' })
  message.value = '正在重新校验文件并逐项执行；取消或失败会按相反顺序回滚。'
  try {
    const result = await executeDesktopSmartOrganizer({
      scanId: current.scanId,
      trustLevel: activeRule.value?.trustLevel ?? 'confirmed',
      ruleId: activeRuleId.value || undefined,
      items: items.map(item => ({
        fileId: item.fileId,
        category: item.category,
        targetRelativeDir: item.targetRelativeDir,
        targetBaseName: item.targetBaseName,
        confidence: item.confidence,
        conflictPolicy: item.conflictPolicy,
      })),
    }, runId)
    store.updateJob(job.id, {
      status: 'succeeded',
      progress: 100,
      outputNames: result.outputs.map(item => item.name),
      outputs: result.outputs.map(item => ({ name: item.name })),
      detail: `已移动 ${result.movedCount} 项、跨盘复制 ${result.copiedCount} 项；回滚凭据已保存在本机。`,
    })
    await audit('succeeded', result.movedCount, result.copiedCount, 0)
    message.value = `整理完成：移动 ${result.movedCount} 项、复制 ${result.copiedCount} 项（${formatBytes(result.processedBytes)}）。`
    ui.toast('智能整理完成', '本次运行已生成可撤销凭据。', 'success')
    scanResult.value = undefined
    resetAfterScan()
    await refreshSideData()
  } catch (error) {
    const detail = errorMessage(error, '智能整理执行失败。')
    const cancelled = cancelling.value || detail.includes('取消')
    const errorCode = cancelled ? 'ORGANIZER_CANCELLED' : detail.includes('人工复核') ? 'ORGANIZER_MANUAL_REVIEW' : 'ORGANIZER_EXECUTION_FAILED'
    store.updateJob(job.id, { status: cancelled ? 'cancelled' : 'failed', progress: 100, errorCode, detail })
    await audit(cancelled ? 'cancelled' : 'failed', 0, 0, items.length, errorCode)
    message.value = detail
    ui.toast(cancelled ? '智能整理已停止' : '智能整理失败', detail, cancelled ? 'warning' : 'error')
    await refreshSideData()
  } finally {
    activeRunId.value = ''
    executing.value = false
    cancelling.value = false
  }
}

async function cancelExecution() {
  if (!activeRunId.value || cancelling.value) return
  cancelling.value = true
  message.value = '正在停止并回滚；请保持应用运行到结果返回。'
  try { await cancelDesktopSmartOrganizer(activeRunId.value) } catch { /* execution reports final state */ }
}

async function saveRule() {
  const items = selectedPlan.value
  if (!scanResult.value || !items.length || !ruleTitle.value.trim()) return
  const candidates = items.flatMap(item => {
    const candidate = scanResult.value?.candidates.find(value => value.fileId === item.fileId)
    return candidate ? [candidate] : []
  })
  const dirs = [...new Set(items.map(item => item.targetRelativeDir))]
  const categories = [...new Set(items.map(item => item.category))]
  const now = new Date().toISOString()
  const repeated = workflowSuggestions.value.find(item => item.targetTemplate === (dirs.length === 1 ? dirs[0] : '{mixed}'))
  const rule: OrganizerRule = {
    id: newId(),
    title: ruleTitle.value.trim(),
    trustLevel: ruleTrust.value,
    enabled: true,
    matcher: {
      extensions: [...new Set(candidates.map(item => item.extension).filter(Boolean))],
      kinds: [...new Set(candidates.map(item => item.kind))],
      namePatterns: [],
    },
    action: {
      category: categories.length === 1 ? categories[0] : '智能归档',
      targetRelativeDirTemplate: dirs.length === 1 ? dirs[0] : '{kind}',
      targetBaseNameTemplate: '{stem}.{extension}',
      conflictPolicy: items.every(item => item.conflictPolicy === 'keep-both') ? 'keep-both' : 'block',
    },
    workflowSignature: repeated?.workflowSignature,
    createdAt: now,
    updatedAt: now,
  }
  try {
    const saved = await saveDesktopOrganizerRule(rule)
    await bindDesktopOrganizerRule(saved.id, sourceRoot.value, archiveRoot.value)
    ui.toast('整理规则已保存', ruleTrust.value === 'trusted' ? '可信规则仍需你手动选择并点击运行。' : '下次运行仍会按信任等级确认。', 'success')
    await refreshSideData()
  } catch (error) {
    ui.toast('规则保存失败', errorMessage(error, '无法保存整理规则。'), 'error')
  }
}

async function useRule(rule: OrganizerRule) {
  const binding = bindings.value.find(item => item.ruleId === rule.id)
  if (!binding) {
    ui.toast('规则尚未绑定本机目录', '先在本页选择来源与归档目录，再从一个计划保存或重新绑定规则。', 'warning')
    return
  }
  sourceRoot.value = binding.sourceRoot
  archiveRoot.value = binding.archiveRoot
  const result = await runScan()
  if (!result) return
  const nextPlan = applyOrganizerRule(rule, result.candidates)
  if (!nextPlan.length) {
    ui.toast('当前目录没有匹配项', `规则“${rule.title}”未匹配本次扫描文件。`, 'warning')
    return
  }
  plan.value = nextPlan
  selectedIds.value = new Set(nextPlan.map(item => item.fileId))
  activeRuleId.value = rule.id
  ruleTrust.value = rule.trustLevel
  message.value = rule.trustLevel === 'preview'
    ? `规则“${rule.title}”生成了 ${nextPlan.length} 项只读预览；该信任等级不能执行。`
    : `规则“${rule.title}”匹配 ${nextPlan.length} 项。${rule.trustLevel === 'trusted' ? '点击运行即可执行，仍会生成回滚凭据。' : '请核对后确认执行。'}`
}

async function removeRule(rule: OrganizerRule) {
  const approved = await ui.confirm({ title: `删除规则“${rule.title}”？`, message: '只删除规则语义和本机目录绑定，不会改动任何文件。', confirmLabel: '删除规则', danger: true })
  if (!approved) return
  try {
    await unbindDesktopOrganizerRule(rule.id)
    await deleteDesktopOrganizerRule(rule.id)
    await refreshSideData()
  } catch (error) {
    ui.toast('规则删除失败', errorMessage(error, '无法删除规则。'), 'error')
  }
}

async function undoReceipt(receipt: OrganizerReceiptSummary) {
  if (receipt.status !== 'ready' || executing.value) return
  const approved = await ui.confirm({
    title: `撤销这次 ${receipt.movedCount + receipt.copiedCount} 项整理？`,
    message: '移动项会恢复原位置；跨盘生成的副本只有在原件仍存在且两边内容未变化时才会移除。任何冲突都会停止，不会覆盖。',
    confirmLabel: '确认撤销',
    danger: true,
  })
  if (!approved) return
  undoingId.value = receipt.receiptId
  try {
    const result = await undoDesktopSmartOrganizer(receipt.receiptId)
    ui.toast('已撤销智能整理', `恢复 ${result.restoredCount} 项，移除 ${result.removedCopyCount} 个安全副本。`, 'success')
    await refreshSideData()
  } catch (error) {
    ui.toast('无法撤销', errorMessage(error, '文件可能已变化，请人工复核。'), 'error')
  } finally {
    undoingId.value = ''
  }
}

async function refreshSideData() {
  if (!desktop) return
  const results = await Promise.allSettled([
    listDesktopSmartOrganizerReceipts(),
    listDesktopOrganizerRules(),
    listDesktopOrganizerRuleBindings(),
    listDesktopOrganizerWorkflowSuggestions(),
    getDesktopOrganizerReview(),
  ])
  if (results[0].status === 'fulfilled') receipts.value = results[0].value
  if (results[1].status === 'fulfilled') rules.value = results[1].value
  if (results[2].status === 'fulfilled') bindings.value = results[2].value
  if (results[3].status === 'fulfilled') workflowSuggestions.value = results[3].value
  if (results[4].status === 'fulfilled') review.value = results[4].value
}

onMounted(() => { void refreshSideData() })
</script>

<template>
  <div class="page-enter page-shell px-8 py-6">
    <PageHeader title="AI 智能文件收件箱" subtitle="本地分析 → 精确载荷预览 → AI 建议 → 可编辑计划 → 可回滚执行。AI 永远拿不到操作权限。">
      <template #lead>
        <button class="btn-ghost btn-sm" @click="router.push({ path: '/c/organize' })"><AppIcon name="chevron-left" :size="14" />返回整理工作台</button>
      </template>
      <template #actions>
        <span class="row gap-1.5 h-9 px-3 rounded-sm bg-surface-2 text-[12px] text-fg-3"><AppIcon name="shield" :size="14" />{{ desktop ? '本地执行 · 明示发送 · 可撤销' : '需要桌面端' }}</span>
      </template>
    </PageHeader>

    <ol class="grid grid-cols-2 md:grid-cols-6 gap-1.5 mb-4" aria-label="智能整理流程">
      <li v-for="(step, index) in steps" :key="step" class="row gap-2 min-w-0 px-2.5 py-2 rounded-sm border" :class="index + 1 <= currentStage ? 'border-accent/35 bg-accent-soft text-accent' : 'border-line bg-surface text-fg-3'">
        <span class="center size-5 rounded-full text-[10px] font-semibold" :class="index + 1 <= currentStage ? 'bg-accent-solid text-accent-fg' : 'bg-surface-3'">{{ index + 1 }}</span>
        <span class="truncate text-[11px] font-medium">{{ step }}</span>
      </li>
    </ol>

    <ToolLayout>
      <section class="panel p-4 stack gap-3">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <button class="stack gap-1 p-3 rounded-md border border-line text-left hover:bg-surface-2 disabled:opacity-55" :disabled="!desktop || scanning || executing" @click="chooseDirectory('source')">
            <span class="row gap-2 text-[12px] font-medium text-fg"><AppIcon name="inbox" :size="15" />来源目录</span>
            <span class="text-[11px] text-fg-3 truncate" :title="sourceRoot">{{ sourceRoot || '下载、桌面或任意手动选择的文件夹' }}</span>
          </button>
          <button class="stack gap-1 p-3 rounded-md border border-line text-left hover:bg-surface-2 disabled:opacity-55" :disabled="!desktop || scanning || executing" @click="chooseDirectory('archive')">
            <span class="row gap-2 text-[12px] font-medium text-fg"><AppIcon name="archive" :size="15" />归档根目录</span>
            <span class="text-[11px] text-fg-3 truncate" :title="archiveRoot">{{ archiveRoot || '所有目标都被限制在这个根目录内' }}</span>
          </button>
        </div>
        <div class="row-between gap-3 flex-wrap">
          <p class="text-[12px] leading-relaxed text-fg-3" aria-live="polite">{{ message }}</p>
          <button class="btn-primary btn-sm shrink-0" :disabled="!canScan" @click="runScan"><AppIcon name="search" :size="14" />{{ scanning ? '本地扫描中…' : '开始只读扫描' }}</button>
        </div>
      </section>

      <template v-if="scanResult">
        <section class="grid grid-cols-2 md:grid-cols-5 gap-2" aria-label="本地扫描摘要">
          <article class="panel p-3"><p class="text-[11px] text-fg-3">普通文件</p><strong class="text-lg tabular-nums">{{ scanResult.scannedCount }}</strong></article>
          <article class="panel p-3"><p class="text-[11px] text-fg-3">本批选择</p><strong class="text-lg tabular-nums text-accent">{{ selectedCandidates.length }} / 100</strong></article>
          <article class="panel p-3"><p class="text-[11px] text-fg-3">精确重复</p><strong class="text-lg tabular-nums text-warn">{{ scanResult.duplicateCount }}</strong></article>
          <article class="panel p-3"><p class="text-[11px] text-fg-3">版本族</p><strong class="text-lg tabular-nums">{{ versionFamilies.length }}</strong></article>
          <article class="panel p-3"><p class="text-[11px] text-fg-3">执行方式</p><strong class="text-[13px]">{{ scanResult.sameVolume ? '移动 / 重命名' : '跨盘复制' }}</strong></article>
        </section>

        <section v-if="scanResult.warnings.length" class="panel p-3 stack gap-1">
          <p v-for="warning in scanResult.warnings" :key="warning" class="row gap-2 items-start text-[11px] text-fg-3"><AppIcon name="shield" :size="12" class="mt-0.5 shrink-0" />{{ warning }}</p>
        </section>

        <section class="panel overflow-hidden">
          <header class="row-between gap-3 px-3 py-2.5 border-b border-line flex-wrap">
            <span class="text-[12px] font-medium text-fg">选择待分析文件 <small class="font-normal text-fg-3">第 {{ page + 1 }} / {{ pageCount }} 页</small></span>
            <span class="row gap-1.5">
              <button class="btn-ghost btn-sm" :disabled="page === 0" @click="page--">上一页</button>
              <button class="btn-ghost btn-sm" :disabled="page + 1 >= pageCount" @click="page++">下一页</button>
              <button class="btn-default btn-sm" :disabled="preparing || askingAi" @click="toggleVisible">{{ allVisibleSelected ? '取消本页' : '选择本页' }}</button>
            </span>
          </header>
          <ul class="stack gap-0.5 p-1.5 max-h-96 overflow-y-auto">
            <li v-for="candidate in visibleCandidates" :key="candidate.fileId" class="row gap-2.5 px-2 py-2 rounded-sm hover:bg-surface-2">
              <input type="checkbox" class="accent-accent shrink-0" :checked="selectedIds.has(candidate.fileId)" :disabled="candidate.duplicateCount > 1 || preparing || askingAi || executing" :aria-label="`选择 ${candidate.name}`" @change="toggleCandidate(candidate)" />
              <span class="stack gap-0.5 min-w-0 flex-1">
                <span class="row gap-2 min-w-0"><strong class="text-[12px] font-medium text-fg truncate">{{ candidate.relativePath }}</strong><span class="px-1.5 py-0.5 rounded text-[10px] bg-surface-3 text-fg-3">{{ candidate.signature }}</span><span v-if="candidate.duplicateCount > 1" class="px-1.5 py-0.5 rounded text-[10px] bg-warn-soft text-warn">重复组 {{ candidate.duplicateCount }}</span></span>
                <span class="text-[10px] text-fg-3">{{ candidate.kind }} · {{ candidate.mime }} · {{ candidate.excerptMode === 'ocr' ? '可选 Windows OCR' : candidate.excerptMode === 'pdf' ? 'PDF 文字层' : candidate.excerptMode === 'archive' ? '压缩包目录' : candidate.excerptMode === 'text' ? '有界文本摘要' : '仅元数据' }}</span>
              </span>
              <span class="text-[10px] text-fg-3 tabular-nums shrink-0">{{ formatBytes(candidate.size) }}</span>
            </li>
          </ul>
          <footer class="row-between gap-3 px-3 py-2.5 border-t border-line flex-wrap">
            <button v-if="scanResult.duplicateCount" class="btn-ghost btn-sm" @click="router.push({ path: '/tools', query: { mode: 'file-health' } })"><AppIcon name="search" :size="13" />重复项转到文件健康</button>
            <span v-else class="text-[11px] text-fg-3">没有发现精确重复项</span>
            <button class="btn-primary btn-sm" :disabled="!canPrepare" @click="preparePayload"><AppIcon name="shield" :size="13" />{{ preparing ? '正在本地提取…' : `预览 ${selectedCandidates.length} 项 AI 载荷` }}</button>
          </footer>
        </section>
      </template>

      <section v-if="payloadPreview" class="panel overflow-hidden">
        <header class="row-between gap-3 px-4 py-3 border-b border-line flex-wrap">
          <span class="stack gap-0.5"><strong class="text-[13px] text-fg">确切 AI 载荷</strong><small class="text-[11px] text-fg-3">{{ payloadPreview.files.length }} 个文件 · {{ formatBytes(payloadPreview.byteCount) }} · 不含来源根绝对路径</small></span>
          <span class="row gap-2"><button class="btn-ghost btn-sm" @click="payloadPreview = undefined">返回选择</button><button class="btn-primary btn-sm" :disabled="askingAi || !profile" @click="requestSuggestions"><AppIcon name="sparkle" :size="13" />{{ askingAi ? '等待结构化建议…' : '确认载荷并发送' }}</button></span>
        </header>
        <ul class="grid grid-cols-1 md:grid-cols-2 gap-1.5 p-3 max-h-56 overflow-y-auto">
          <li v-for="file in payloadPreview.files" :key="file.fileId" class="row gap-2 p-2 rounded-sm bg-surface-2">
            <button class="center size-5 rounded hover:bg-danger-soft hover:text-danger" :aria-label="`从载荷移除 ${file.name}`" title="从本批载荷移除" @click="removeFromPayload(file.fileId)">×</button>
            <span class="stack gap-0.5 min-w-0 flex-1"><strong class="text-[11px] truncate">{{ file.name }}</strong><small class="text-[10px] text-fg-3">{{ file.excerptSource }} · 摘要 {{ formatBytes(excerptBytes(file.excerpt)) }}</small></span>
          </li>
        </ul>
        <details class="border-t border-line">
          <summary class="px-4 py-2.5 text-[11px] text-fg-3 cursor-pointer hover:bg-surface-2">查看实际发送的 messages JSON（{{ formatBytes(payloadPreview.byteCount) }}）</summary>
          <pre class="m-0 p-4 max-h-80 overflow-auto bg-surface-2 text-[10px] leading-relaxed whitespace-pre-wrap break-all">{{ payloadPreview.serializedMessages }}</pre>
        </details>
      </section>

      <section v-if="plan.length" class="panel overflow-hidden">
        <header class="row-between gap-3 px-4 py-3 border-b border-line flex-wrap">
          <span class="stack gap-0.5"><strong class="text-[13px] text-fg">可编辑变更计划</strong><small class="text-[11px] text-fg-3">已选择 {{ selectedPlan.length }} / {{ plan.length }}；低置信度默认关闭，执行时 Rust 会再次校验路径与文件状态。</small></span>
          <span v-if="activeRule" class="px-2 py-1 rounded-full text-[10px] bg-accent-soft text-accent">规则：{{ activeRule.title }} · {{ activeRule.trustLevel }}</span>
        </header>
        <div class="overflow-x-auto max-h-112 overflow-y-auto">
          <table class="w-full min-w-240 text-left">
            <thead class="sticky top-0 bg-surface border-b border-line text-[10px] uppercase tracking-wide text-fg-3"><tr><th class="p-2 w-8">用</th><th class="p-2">来源</th><th class="p-2">分类</th><th class="p-2">目标相对目录</th><th class="p-2">目标文件名</th><th class="p-2">置信度 / 理由</th><th class="p-2">重名</th></tr></thead>
            <tbody>
              <tr v-for="item in plan" :key="item.fileId" class="border-b border-line/70 align-top">
                <td class="p-2"><input v-model="item.selected" type="checkbox" class="accent-accent" :disabled="executing" /></td>
                <td class="p-2 max-w-48"><strong class="block text-[11px] truncate" :title="item.sourceRelativePath">{{ item.sourceName }}</strong><small class="text-[10px] text-fg-3">{{ formatBytes(item.size) }}</small></td>
                <td class="p-2"><input v-model="item.category" class="field w-32 text-[11px]" :disabled="executing" /></td>
                <td class="p-2"><input v-model="item.targetRelativeDir" class="field w-48 font-mono text-[10px]" :disabled="executing" placeholder="课程/2026" /></td>
                <td class="p-2"><input v-model="item.targetBaseName" class="field w-48 text-[11px]" :disabled="executing" /></td>
                <td class="p-2 max-w-60"><span class="row gap-1.5"><strong class="text-[11px] tabular-nums" :class="item.confidence < .65 ? 'text-warn' : 'text-success'">{{ Math.round(item.confidence * 100) }}%</strong><span v-if="item.confidence < .65" class="text-[9px] text-warn">需复核</span></span><small class="block mt-1 text-[10px] leading-relaxed text-fg-3">{{ item.reason }}</small></td>
                <td class="p-2"><select v-model="item.conflictPolicy" class="field w-28 text-[10px]" :disabled="executing"><option value="block">冲突即停</option><option value="keep-both">保留两者</option></select></td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="row-between gap-3 px-4 py-3 flex-wrap">
          <span class="text-[11px] text-fg-3">{{ activeRule?.trustLevel === 'preview' ? '此规则仅生成预览，不能执行。' : scanResult?.sameVolume ? '同卷：移动 / 重命名，不覆盖' : '跨卷：复制并保留原件，不覆盖' }}</span>
          <span class="row gap-2"><button v-if="executing" class="btn-default btn-sm" :disabled="cancelling" @click="cancelExecution">{{ cancelling ? '正在回滚…' : '停止并回滚' }}</button><button v-else class="btn-danger btn-sm" :disabled="!canExecute" @click="executePlan"><AppIcon name="sort" :size="14" />{{ activeRule?.trustLevel === 'trusted' ? `手动运行可信规则 · ${selectedPlan.length} 项` : `确认执行 ${selectedPlan.length} 项` }}</button></span>
        </footer>
      </section>

      <section v-if="versionFamilies.length" class="panel p-4 stack gap-2">
        <div class="row-between"><span class="stack gap-0.5"><strong class="text-[13px]">语义版本族</strong><small class="text-[11px] text-fg-3">只建议复核，不自动删除。</small></span><button class="btn-ghost btn-sm" @click="router.push({ path: '/tools', query: { mode: 'file-health' } })">打开文件健康</button></div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
          <article v-for="family in versionFamilies.slice(0, 6)" :key="family.key" class="p-3 rounded-sm bg-surface-2 stack gap-1"><strong class="text-[11px]">{{ family.label || '同名版本' }} · {{ family.members.length }} 份</strong><span class="text-[10px] text-fg-3 truncate">建议先看：{{ family.members.find(item => item.fileId === family.recommendedFileId)?.name }}</span><span class="text-[10px] text-fg-3 truncate">{{ family.members.map(item => item.name).join('、') }}</span></article>
        </div>
      </section>

      <section v-if="!desktop" class="panel p-8 stack items-center gap-2 text-center">
        <AppIcon name="warning" :size="24" class="text-warn" /><strong class="text-[14px]">浏览器不能安全执行本机文件计划</strong><p class="text-[12px] text-fg-3">请使用 Windows 桌面端；AI 配置仍沿用设置中的 OpenAI 兼容 BYOK。</p>
      </section>

      <template #aside>
        <section class="panel p-4 stack gap-3">
          <p class="eyebrow">AI 与隐私</p>
          <label class="stack gap-1 text-[11px] text-fg-3">AI 配置<select v-model="profileId" class="field w-full text-[11px]" :disabled="askingAi"><option v-if="!store.aiProfiles.length" value="">尚未配置</option><option v-for="item in store.aiProfiles" :key="item.id" :value="item.id">{{ item.label }} · {{ item.model }}</option></select></label>
          <button v-if="!store.aiProfiles.length" class="btn-default btn-sm w-full" @click="router.push('/settings')">前往设置 AI</button>
          <label class="row gap-2 text-[11px] text-fg-2"><input v-model="includeImageOcr" type="checkbox" class="accent-accent" :disabled="preparing || askingAi" />对本批图片使用 Windows OCR</label>
          <p class="text-[10px] leading-relaxed text-fg-3">OCR 和 PDF 文字层都在本机提取。只有载荷预览中列出的字段会发送；每个摘要最多 4 KB，总载荷最多 512 KB。</p>
        </section>

        <section v-if="plan.length" class="panel p-4 stack gap-3">
          <p class="eyebrow">沉淀为规则</p>
          <input v-model="ruleTitle" class="field w-full text-[11px]" maxlength="120" placeholder="规则名称" />
          <select v-model="ruleTrust" class="field w-full text-[11px]"><option value="preview">仅生成预览</option><option value="confirmed">需确认规则</option><option value="trusted">可信规则（仍手动运行）</option></select>
          <button class="btn-default btn-sm w-full" :disabled="!selectedPlan.length" @click="saveRule"><AppIcon name="task" :size="13" />保存规则并绑定当前目录</button>
          <p v-if="workflowSuggestions.length" class="text-[10px] text-accent">已发现 {{ workflowSuggestions.length }} 个 30 天内重复确认至少 3 次的流程。</p>
        </section>

        <section class="panel p-4 stack gap-3">
          <div class="row-between"><p class="eyebrow">手动规则</p><button class="btn-ghost btn-sm" @click="refreshSideData"><AppIcon name="refresh" :size="12" /></button></div>
          <p v-if="!rules.length" class="text-[11px] text-fg-3">尚未保存整理规则。</p>
          <ul v-else class="stack gap-2">
            <li v-for="rule in rules.slice(0, 6)" :key="rule.id" class="p-2.5 rounded-sm bg-surface-2 stack gap-1.5">
              <span class="row-between gap-2"><strong class="text-[11px] truncate">{{ rule.title }}</strong><span class="text-[9px] text-fg-3">{{ rule.trustLevel }}</span></span>
              <small class="text-[10px] text-fg-3 truncate">{{ rule.matcher.extensions.join(' · ') || rule.matcher.kinds.join(' · ') }} → {{ rule.action.targetRelativeDirTemplate || '归档根' }}</small>
              <span class="row gap-1"><button class="btn-default btn-sm flex-1" :disabled="scanning || executing" @click="useRule(rule)">选择绑定目录并运行</button><button class="btn-ghost btn-sm" aria-label="删除规则" @click="removeRule(rule)">×</button></span>
            </li>
          </ul>
        </section>

        <section class="panel p-4 stack gap-3">
          <p class="eyebrow">收件箱复盘 · 30 天</p>
          <div v-if="review" class="grid grid-cols-2 gap-2">
            <span class="p-2 rounded-sm bg-surface-2"><small class="block text-[10px] text-fg-3">运行</small><strong class="tabular-nums">{{ review.runs30Days }}</strong></span>
            <span class="p-2 rounded-sm bg-surface-2"><small class="block text-[10px] text-fg-3">文件</small><strong class="tabular-nums">{{ review.files30Days }}</strong></span>
            <span class="p-2 rounded-sm bg-surface-2"><small class="block text-[10px] text-fg-3">节省操作</small><strong class="tabular-nums text-accent">{{ review.savedOperations30Days }}</strong></span>
            <span class="p-2 rounded-sm bg-surface-2"><small class="block text-[10px] text-fg-3">失败运行</small><strong class="tabular-nums" :class="review.failedRuns30Days ? 'text-warn' : 'text-success'">{{ review.failedRuns30Days }}</strong></span>
          </div>
          <p v-else class="text-[11px] text-fg-3">完成首次运行后，这里会显示节省操作和重复流程。</p>
        </section>

        <section class="panel p-4 stack gap-3">
          <p class="eyebrow">回滚凭据</p>
          <p v-if="!receipts.length" class="text-[11px] text-fg-3">暂无智能整理凭据。</p>
          <ul v-else class="stack gap-2">
            <li v-for="receipt in receipts.slice(0, 6)" :key="receipt.receiptId" class="p-2.5 rounded-sm bg-surface-2 stack gap-1.5">
              <span class="row-between gap-2"><strong class="text-[11px]">移动 {{ receipt.movedCount }} · 复制 {{ receipt.copiedCount }}</strong><span class="text-[9px]" :class="receipt.status === 'ready' ? 'text-success' : 'text-warn'">{{ receipt.status === 'ready' ? '可撤销' : '需人工复核' }}</span></span>
              <small class="text-[10px] text-fg-3">{{ new Date(receipt.createdAt).toLocaleString('zh-CN') }}</small>
              <button class="btn-default btn-sm w-full" :disabled="receipt.status !== 'ready' || Boolean(undoingId)" @click="undoReceipt(receipt)">{{ undoingId === receipt.receiptId ? '正在撤销…' : '撤销本次整理' }}</button>
            </li>
          </ul>
        </section>
      </template>
    </ToolLayout>
  </div>
</template>
