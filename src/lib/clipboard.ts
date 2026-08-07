import type { SourceKind } from '@/types'

export async function readClipboardPayload(): Promise<{ kind: SourceKind; name: string; content?: string; preview?: string } | null> {
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith('image/'))
      if (imageType) {
        const blob = await item.getType(imageType)
        return { kind: 'image', name: '剪贴板图片.png', preview: await blobToDataUrl(blob) }
      }
    }
  } catch {
    // Some WebViews only expose readText; the text fallback below remains useful.
  }
  try {
    const text = await navigator.clipboard.readText()
    if (!text.trim()) return null
    const codeLike = /\n|\{|;|#include|def |function |class /.test(text)
    return { kind: codeLike ? 'code' : 'text', name: codeLike ? '剪贴板代码.txt' : '剪贴板文本.md', content: text }
  } catch {
    return null
  }
}

export function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}
