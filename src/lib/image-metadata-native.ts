import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from './native'

export interface ImageMetadataField {
  key: string
  group: string
  name: string
  value: string
}

export interface ImageMetadataReport {
  name: string
  fields: ImageMetadataField[]
  truncated: boolean
  elapsedMs: number
}

export async function inspectDesktopImageMetadata(path: string) {
  if (!isDesktop()) throw new Error('图片元数据读取需要桌面版 ExifTool。')
  return invoke<ImageMetadataReport>('inspect_image_metadata', { path })
}
