import { open } from '@tauri-apps/plugin-dialog'
import { isDesktop, saveDesktopOutput } from '@/lib/native'
import type { FileReference } from '@/types'

export async function chooseOutputDirectory() {
  if (!isDesktop()) return undefined
  const selected = await open({ directory: true, multiple: false, title: '选择 Knitspace 默认输出目录' })
  return typeof selected === 'string' ? selected : undefined
}

export function browserDownload(filename: string, data: BlobPart, mime: string): FileReference {
  const url = URL.createObjectURL(new Blob([data], { type: mime }))
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 500)
  return { name: filename, mime } satisfies FileReference
}

export async function exportOutput(outputDirectory: string, filename: string, data: Blob | ArrayBuffer | Uint8Array | string, mime: string): Promise<FileReference> {
  if (isDesktop() && outputDirectory) {
    const path = await saveDesktopOutput(outputDirectory, filename, data)
    const size = typeof data === 'string' ? new Blob([data]).size : data instanceof Blob ? data.size : data.byteLength
    return { name: filename, path, size, mime } satisfies FileReference
  }
  const part: BlobPart = typeof data === 'string' || data instanceof Blob ? data : new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
  return browserDownload(filename, part, mime)
}
