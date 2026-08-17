import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from './native'

export type PhotoOrganizationNaming = 'keep' | 'datetime' | 'datetime-original'
export type PhotoOrganizationStatus = 'move' | 'same' | 'conflict' | 'skipped'

export interface PhotoOrganizationScanRequest {
  sourceRoot: string
  destinationRoot: string
  naming: PhotoOrganizationNaming
  fallbackToFileModified: boolean
}

export interface PhotoOrganizationPlanItem {
  sourcePath: string
  sourceRelativePath: string
  targetPath?: string
  targetRelativePath?: string
  capturedAt?: string
  dateSource?: string
  size: number
  modifiedMs: number
  status: PhotoOrganizationStatus
  detail: string
}

export interface PhotoOrganizationPlan {
  planId: string
  sourceRoot: string
  destinationRoot: string
  scannedCount: number
  moveCount: number
  sameCount: number
  conflictCount: number
  skippedCount: number
  fallbackCount: number
  truncated: boolean
  warnings: string[]
  items: PhotoOrganizationPlanItem[]
}

export interface PhotoOrganizationExecutionReport {
  receiptId: string
  movedCount: number
  movedBytes: number
  outputPaths: string[]
}

export interface PhotoOrganizationReceiptSummary {
  receiptId: string
  createdAt: string
  sourceRoot: string
  destinationRoot: string
  movedCount: number
}

export interface PhotoOrganizationUndoReport {
  receiptId: string
  restoredCount: number
}

function requireDesktop() {
  if (!isDesktop()) throw new Error('照片按日期整理需要 Windows 桌面端文件权限。')
}

export async function scanDesktopPhotoOrganization(request: PhotoOrganizationScanRequest) {
  requireDesktop()
  return invoke<PhotoOrganizationPlan>('scan_photo_organization', { request })
}

export async function executeDesktopPhotoOrganization(plan: PhotoOrganizationPlan, selected: PhotoOrganizationPlanItem[], runId: string) {
  requireDesktop()
  return invoke<PhotoOrganizationExecutionReport>('execute_photo_organization', {
    runId,
    request: {
      planId: plan.planId,
      sourceRoot: plan.sourceRoot,
      destinationRoot: plan.destinationRoot,
      moves: selected.map(item => ({
        sourceRelativePath: item.sourceRelativePath,
        targetRelativePath: item.targetRelativePath,
        expectedSize: item.size,
        expectedModifiedMs: item.modifiedMs,
      })),
    },
  })
}

export async function cancelDesktopPhotoOrganization(runId: string) {
  requireDesktop()
  return invoke<boolean>('cancel_photo_organization', { runId })
}

export async function undoDesktopPhotoOrganization(receiptId: string) {
  requireDesktop()
  return invoke<PhotoOrganizationUndoReport>('undo_photo_organization', { receiptId })
}

export async function listDesktopPhotoOrganizationReceipts() {
  requireDesktop()
  return invoke<PhotoOrganizationReceiptSummary[]>('list_photo_organization_receipts')
}
