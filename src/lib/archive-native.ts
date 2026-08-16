import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from '@/lib/native'

export interface DesktopArchiveEntry {
  name: string
  compressedSize: number
  uncompressedSize: number
  isDirectory: boolean
}

export interface DesktopArchiveListing {
  archiveName: string
  archiveSize: number
  entries: DesktopArchiveEntry[]
  uncompressedSize: number
}

export interface DesktopArchiveOperationSummary {
  archiveName: string
  archiveSize: number
  entryCount: number
  fileCount: number
  directoryCount: number
  uncompressedSize: number
  outputPath: string
}

export async function createDesktopZipArchive(inputPaths: string[], outputPath: string) {
  if (!isDesktop()) throw new Error('ZIP 创建仅支持桌面模式。')
  return invoke<DesktopArchiveOperationSummary>('create_zip_archive', { inputPaths, outputPath })
}

export async function listDesktopZipArchive(archivePath: string) {
  if (!isDesktop()) throw new Error('ZIP 检查仅支持桌面模式。')
  return invoke<DesktopArchiveListing>('list_zip_archive', { archivePath })
}

export async function extractDesktopZipArchive(archivePath: string, outputDirectory: string) {
  if (!isDesktop()) throw new Error('ZIP 解压仅支持桌面模式。')
  return invoke<DesktopArchiveOperationSummary>('extract_zip_archive', { archivePath, outputDirectory })
}

export async function createDesktopTarArchive(inputPaths: string[], outputPath: string, gzip: boolean) {
  if (!isDesktop()) throw new Error('TAR 创建仅支持桌面模式。')
  return invoke<DesktopArchiveOperationSummary>('create_tar_archive', { inputPaths, outputPath, gzip })
}

export async function listDesktopTarArchive(archivePath: string) {
  if (!isDesktop()) throw new Error('TAR 检查仅支持桌面模式。')
  return invoke<DesktopArchiveListing>('list_tar_archive', { archivePath })
}

export async function extractDesktopTarArchive(archivePath: string, outputDirectory: string) {
  if (!isDesktop()) throw new Error('TAR 解压仅支持桌面模式。')
  return invoke<DesktopArchiveOperationSummary>('extract_tar_archive', { archivePath, outputDirectory })
}
