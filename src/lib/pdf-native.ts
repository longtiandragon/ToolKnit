import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from './native'

export async function optimizeDesktopPdf(data: ArrayBuffer | Uint8Array) {
  if (!isDesktop()) throw new Error('PDF 优化需要桌面版 qpdf。')
  return invoke<ArrayBuffer>('optimize_pdf_bytes', data instanceof ArrayBuffer ? new Uint8Array(data) : data)
}
