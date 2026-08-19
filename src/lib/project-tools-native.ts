import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from '@/lib/native'

export interface DeliveryPackFilePreview {
  relativePath: string
  size: number
  sha256: string
}

export interface DeliveryPackPlan {
  planId: string
  projectName: string
  fileCount: number
  totalBytes: number
  excludedCount: number
  skippedLinkCount: number
  fingerprint: string
  truncated: boolean
  previewTruncated: boolean
  extensionCounts: Record<string, number>
  files: DeliveryPackFilePreview[]
  warnings: string[]
}

export interface DeliveryPackReport {
  outputPath: string
  archiveName: string
  archiveSize: number
  fileCount: number
  totalBytes: number
  fingerprint: string
}

export interface FolderSnapshotSummary {
  snapshotId: string
  label: string
  rootName: string
  createdAt: string
  fileCount: number
  totalBytes: number
}

export interface FolderSnapshotDiffItem {
  relativePath: string
  status: 'added' | 'modified' | 'missing' | 'anomalous'
  beforeSize?: number
  afterSize?: number
}

export interface FolderSnapshotDiff {
  snapshotId: string
  label: string
  comparedAt: string
  addedCount: number
  modifiedCount: number
  missingCount: number
  anomalousCount: number
  unchangedCount: number
  truncated: boolean
  items: FolderSnapshotDiffItem[]
}

function requireDesktop() {
  if (!isDesktop()) throw new Error('此功能需要 Knitspace Windows 桌面端的本地文件权限。')
}

export async function scanDesktopDeliveryPack(sourceRoot: string) {
  requireDesktop()
  return invoke<DeliveryPackPlan>('scan_project_delivery_pack', { request: { sourceRoot } })
}

export async function createDesktopDeliveryPack(input: {
  sourceRoot: string
  outputPath: string
  projectName: string
  expectedFingerprint: string
}) {
  requireDesktop()
  return invoke<DeliveryPackReport>('create_project_delivery_pack', { request: input })
}

export async function createDesktopFolderSnapshot(sourceRoot: string, label: string) {
  requireDesktop()
  return invoke<FolderSnapshotSummary>('create_folder_snapshot', { request: { sourceRoot, label } })
}

export async function listDesktopFolderSnapshots() {
  requireDesktop()
  return invoke<FolderSnapshotSummary[]>('list_folder_snapshots')
}

export async function compareDesktopFolderSnapshot(snapshotId: string) {
  requireDesktop()
  return invoke<FolderSnapshotDiff>('compare_folder_snapshot', { snapshotId })
}

export async function deleteDesktopFolderSnapshot(snapshotId: string) {
  requireDesktop()
  return invoke<boolean>('delete_folder_snapshot', { snapshotId })
}
