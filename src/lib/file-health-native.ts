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
  largestDirectories: FileHealthDirectory[]
}

export async function scanDesktopFileHealth(root: string, largeFileBytes?: number) {
  if (!isDesktop()) throw new Error('文件健康扫描需要桌面端文件权限。')
  return invoke<FileHealthReport>('scan_file_health', { root, largeFileBytes })
}

export async function recycleDesktopFileHealthPaths(root: string, paths: string[]) {
  if (!isDesktop()) throw new Error('移入回收站需要桌面端。')
  return invoke<number>('recycle_file_health_paths', { root, paths })
}
