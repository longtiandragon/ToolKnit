import jsQR from 'jsqr'
import QRCode from 'qrcode'

export interface QrGenerateOptions {
  size?: number
  dark?: string
  light?: string
}

export function validateQrText(value: string) {
  const text = value.trim()
  if (!text) throw new Error('请输入需要生成二维码的文字或网址。')
  if (text.length > 2000) throw new Error('二维码内容最多支持 2000 个字符。')
  return text
}

export async function generateQrCode(value: string, options: QrGenerateOptions = {}) {
  const text = validateQrText(value)
  const size = Math.max(160, Math.min(1200, Math.round(options.size ?? 360)))
  return QRCode.toDataURL(text, {
    width: size,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: options.dark ?? '#172321', light: options.light ?? '#ffffff' }
  })
}

export async function decodeQrImage(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('请选择 PNG、JPG 或 WebP 图片。')
  if (file.size > 30 * 1024 * 1024) throw new Error('图片不能超过 30 MB。')
  const bitmap = await createImageBitmap(file)
  try {
    const maxSide = 1800
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('当前窗口无法读取图片像素。')
    context.drawImage(bitmap, 0, 0, width, height)
    const pixels = context.getImageData(0, 0, width, height)
    const result = jsQR(pixels.data, width, height, { inversionAttempts: 'attemptBoth' })
    if (!result?.data) throw new Error('没有识别到二维码，请尝试更清晰、完整且正对镜头的图片。')
    return result.data
  } finally {
    bitmap.close()
  }
}
