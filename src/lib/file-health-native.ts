import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from '@/lib/native'

export interface FileHealthPath {
  path: string
  relativePath: string
  name: string
  size: number
}

export interface FileHealthFinding extends FileHealthPath {
  id: string
  kind: string
  detail: string
  safeToRecycle: boolean
}

export interface FileHealthDuplicateGroup {
  id: string
  hash: string
  size: number
  files: FileHealthPath[]
  suggestedKeep: string
}

export interface FileHealthSimilarImage {
  path: string
  relativePath: string
  name: string
  size: number
  width: number
  height: number
  difference: number
}

export interface FileHealthSimilarImageGroup {
  id: string
  files: FileHealthSimilarImage[]
  suggestedKeep: string
}

export interface FileHealthDirectory {
  path: string
  relativePath: string
  size: number
  fileCount: number
}

export interface FileHealthReport {
  root: string
  scannedEntries: number
  scannedFiles: number
  scannedDirectories: number
  totalBytes: number
  largeFileBytes: number
  hashBytes: number
  truncated: boolean
  warnings: string[]
  emptyFiles: FileHealthFinding[]
  emptyDirectories: FileHealthFinding[]
  largeFiles: FileHealthFinding[]
  extensionMismatches: FileHealthFinding[]
  duplicateGroups: FileHealthDuplicateGroup[]
  similarImageGroups: FileHealthSimilarImageGroup[]
  largestDirectories: FileHealthDirectory[]
}

export type DirectoryCompareStatus = 'same' | 'added' | 'removed' | 'changed' | 'unverified'

export interface DirectoryCompareItem {
  relativePath: string
  name: string
  status: DirectoryCompareStatus
  leftSize?: number
  rightSize?: number
  leftHash?: string
  rightHash?: string
  detail: string
}

export interface DirectoryCompareReport {
  leftRoot: string
  rightRoot: string
  scannedLeftFiles: number
  scannedRightFiles: number
  totalLeftBytes: number
  totalRightBytes: number
  hashedBytes: number
  sameCount: number
  addedCount: number
  removedCount: number
  changedCount: number
  unverifiedCount: number
  truncated: boolean
  warnings: string[]
  items: DirectoryCompareItem[]
}

export interface FileManifestEntry {
  relativePath: string
  name: string
  size: number
  sha256?: string
}

export interface FileManifestReport {
  root: string
  scannedEntries: number
  scannedFiles: number
  totalBytes: number
  hashBytes: number
  hashedFiles: number
  truncated: boolean
  warnings: string[]
  files: FileManifestEntry[]
}

export type FileManifestVerificationStatus = 'match' | 'missing' | 'size-mismatch' | 'hash-mismatch' | 'unverified' | 'unreadable' | 'extra'

export interface FileManifestVerificationItem {
  relativePath: string
  name: string
  status: FileManifestVerificationStatus
  expectedSize?: number
  actualSize?: number
  expectedHash?: string
  actualHash?: string
  detail: string
}

export interface FileManifestVerificationReport {
  root: string
  manifestPath: string
  scannedFiles: number
  hashedBytes: number
  matchCount: number
  missingCount: number
  sizeMismatchCount: number
  hashMismatchCount: number
  unverifiedCount: number
  unreadableCount: number
  extraCount: number
  truncated: boolean
  warnings: string[]
  items: FileManifestVerificationItem[]
}

export async function scanDesktopFileHealth(root: string, largeFileBytes?: number) {
  if (!isDesktop()) throw new Error('文件健康扫描需要桌面端文件权限。')
  return invoke<FileHealthReport>('scan_file_health', { root, largeFileBytes })
}

export async function compareDesktopDirectories(leftRoot: string, rightRoot: string) {
  if (!isDesktop()) throw new Error('目录对比需要桌面端文件权限。')
  return invoke<DirectoryCompareReport>('compare_directories', { leftRoot, rightRoot })
}

export async function createDesktopFileManifest(root: string, includeHash = true) {
  if (!isDesktop()) throw new Error('文件清单需要桌面端文件权限。')
  return invoke<FileManifestReport>('create_file_manifest', { root, includeHash })
}

export async function verifyDesktopFileManifest(root: string, manifestPath: string) {
  if (!isDesktop()) throw new Error('校验清单验证需要桌面端文件权限。')
  return invoke<FileManifestVerificationReport>('verify_file_manifest', { root, manifestPath })
}

export async function recycleDesktopFileHealthPaths(root: string, paths: string[]) {
  if (!isDesktop()) throw new Error('移入回收站需要桌面端。')
  return invoke<number>('recycle_file_health_paths', { root, paths })
}
