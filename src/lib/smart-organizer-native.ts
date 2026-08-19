import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from '@/lib/native'
import type {
  OrganizerCandidate,
  OrganizerExecuteRequest,
  OrganizerReceiptSummary,
  OrganizerRule,
} from '@/types'
import type { OrganizerLocalExcerpt } from '@/lib/smart-organizer'

export interface OrganizerScanResult {
  scanId: string
  scannedCount: number
  duplicateCount: number
  skippedLinkCount: number
  unreadableCount: number
  truncated: boolean
  sameVolume: boolean
  durationMs: number
  warnings: string[]
  candidates: OrganizerCandidate[]
}

export interface OrganizerExecutionReport {
  receiptId: string
  movedCount: number
  copiedCount: number
  processedBytes: number
  outputs: Array<{ fileId: string; name: string; relativePath: string; operation: 'move' | 'copy' }>
}

export interface OrganizerUndoReport {
  receiptId: string
  restoredCount: number
  removedCopyCount: number
}

export interface OrganizerRuleBinding {
  ruleId: string
  sourceRoot: string
  archiveRoot: string
  updatedAt: string
}

export interface OrganizerAuditInput {
  ruleId?: string
  inputKinds: string[]
  operationSequence: string[]
  targetTemplate: string
  fileCount: number
  movedCount: number
  copiedCount: number
  failedCount: number
  status: 'succeeded' | 'failed' | 'cancelled'
  errorCode?: string
}

export interface OrganizerWorkflowSuggestion {
  workflowSignature: string
  inputKinds: string[]
  operationSequence: string[]
  targetTemplate: string
  confirmations: number
  lastConfirmedAt: string
}

export interface OrganizerReviewSummary {
  runs30Days: number
  files30Days: number
  savedOperations30Days: number
  failedRuns30Days: number
  repeatedWorkflows: OrganizerWorkflowSuggestion[]
  topWorkflows: Array<{ operationSequence: string[]; runs: number; files: number }>
}

function requireDesktop() {
  if (!isDesktop()) throw new Error('AI 智能文件收件箱需要 Knitspace Windows 桌面端文件权限。')
}

export async function scanDesktopSmartOrganizer(sourceRoot: string, archiveRoot: string) {
  requireDesktop()
  return invoke<OrganizerScanResult>('scan_smart_organizer', { request: { sourceRoot, archiveRoot } })
}

export async function readDesktopSmartOrganizerExcerpts(scanId: string, fileIds: string[]) {
  requireDesktop()
  return invoke<OrganizerLocalExcerpt[]>('read_smart_organizer_excerpts', { request: { scanId, fileIds } })
}

export async function readDesktopSmartOrganizerAnalysisFile(scanId: string, fileId: string) {
  requireDesktop()
  return invoke<ArrayBuffer>('read_smart_organizer_analysis_file', { request: { scanId, fileId } })
}

export async function executeDesktopSmartOrganizer(request: OrganizerExecuteRequest, runId: string) {
  requireDesktop()
  return invoke<OrganizerExecutionReport>('execute_smart_organizer', { request, runId })
}

export async function cancelDesktopSmartOrganizer(runId: string) {
  requireDesktop()
  return invoke<boolean>('cancel_smart_organizer', { runId })
}

export async function listDesktopSmartOrganizerReceipts() {
  requireDesktop()
  return invoke<OrganizerReceiptSummary[]>('list_smart_organizer_receipts')
}

export async function undoDesktopSmartOrganizer(receiptId: string) {
  requireDesktop()
  return invoke<OrganizerUndoReport>('undo_smart_organizer', { receiptId })
}

export async function listDesktopOrganizerRules() {
  requireDesktop()
  return invoke<OrganizerRule[]>('list_default_organizer_rules')
}

export async function saveDesktopOrganizerRule(rule: OrganizerRule) {
  requireDesktop()
  return invoke<OrganizerRule>('save_default_organizer_rule', { rule })
}

export async function deleteDesktopOrganizerRule(id: string) {
  requireDesktop()
  await invoke('delete_default_organizer_rule', { id })
}

export async function saveDesktopOrganizerAudit(input: OrganizerAuditInput) {
  requireDesktop()
  return invoke<string>('save_default_organizer_audit', { input })
}

export async function listDesktopOrganizerWorkflowSuggestions() {
  requireDesktop()
  return invoke<OrganizerWorkflowSuggestion[]>('list_default_organizer_workflow_suggestions')
}

export async function getDesktopOrganizerReview() {
  requireDesktop()
  return invoke<OrganizerReviewSummary>('get_default_organizer_review')
}

export async function listDesktopOrganizerRuleBindings() {
  requireDesktop()
  return invoke<OrganizerRuleBinding[]>('list_smart_organizer_rule_bindings')
}

export async function bindDesktopOrganizerRule(ruleId: string, sourceRoot: string, archiveRoot: string) {
  requireDesktop()
  return invoke<OrganizerRuleBinding>('bind_smart_organizer_rule', { ruleId, sourceRoot, archiveRoot })
}

export async function unbindDesktopOrganizerRule(ruleId: string) {
  requireDesktop()
  return invoke<boolean>('unbind_smart_organizer_rule', { ruleId })
}
