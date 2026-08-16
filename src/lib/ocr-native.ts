import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from '@/lib/native'

export async function recognizeDesktopImageBytes(data: ArrayBuffer | Uint8Array, languageTag?: string) {
  if (!isDesktop()) throw new Error('离线 OCR 需要 Knitspace Windows 桌面开发版。')
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
  return invoke<{
    text: string
    language: { tag: string; displayName: string }
    sourceWidth: number
    sourceHeight: number
    processedWidth: number
    processedHeight: number
    lineCount: number
    downscaled: boolean
  }>('recognize_image_bytes', bytes, { headers: { 'x-toolknit-language': languageTag || '' } })
}

export async function readDesktopOcrFont() {
  if (!isDesktop()) throw new Error('离线 OCR 需要 Knitspace Windows 桌面开发版。')
  return invoke<ArrayBuffer>('read_ocr_font')
}
