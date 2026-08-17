import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from './native'

export async function optimizeDesktopPdf(data: ArrayBuffer | Uint8Array) {
  if (!isDesktop()) throw new Error('PDF 优化需要桌面版 qpdf。')
  return invoke<ArrayBuffer>('optimize_pdf_bytes', data instanceof ArrayBuffer ? new Uint8Array(data) : data)
}

export async function protectDesktopPdf(data: ArrayBuffer | Uint8Array, options: { password: string; allowPrinting: boolean; allowCopying: boolean; allowModification: boolean }) {
  if (!isDesktop()) throw new Error('PDF 加密需要桌面版 qpdf。')
  return invoke<ArrayBuffer>('protect_pdf_bytes', {
    request: {
      bytes: data instanceof ArrayBuffer ? new Uint8Array(data) : data,
      password: options.password,
      allowPrinting: options.allowPrinting,
      allowCopying: options.allowCopying,
      allowModification: options.allowModification,
    },
  })
}

export async function decryptDesktopPdf(data: ArrayBuffer | Uint8Array, password: string) {
  if (!isDesktop()) throw new Error('PDF 解密需要桌面版 qpdf。')
  return invoke<ArrayBuffer>('decrypt_pdf_bytes', {
    request: {
      bytes: data instanceof ArrayBuffer ? new Uint8Array(data) : data,
      password,
    },
  })
}
