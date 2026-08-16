import { looksLikeCode } from './workbench-utils'
export { isQuickIntakeShortcut } from './quick-intake-shortcut'

export type IntakeKind = 'empty' | 'pdf' | 'image' | 'code' | 'json' | 'jwt' | 'base64' | 'url' | 'text' | 'mixed' | 'files'

export interface IntakeFileLike {
  name: string
  type?: string
}

export const QUICK_INTAKE_DRAFT_LIMIT = 200_000

/** Keep the recovery draft bounded; files stay in the transient hand-off only. */
export function normalizeQuickIntakeDraft(value: unknown) {
  return typeof value === 'string' ? value.slice(0, QUICK_INTAKE_DRAFT_LIMIT) : ''
}

function fileKind(file: IntakeFileLike) {
  const name = file.name.toLowerCase()
  const type = file.type ?? ''
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(name)) return 'image'
  if (type.startsWith('text/') || /\.(c|cc|cpp|h|hpp|py|java|js|jsx|ts|tsx|rs|go|vue|svelte|html|css|scss|sql|sh|json|ya?ml|xml|md)$/i.test(name)) return 'code'
  return 'files'
}

function isUrl(value: string) {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isJwt(value: string) {
  const parts = value.split('.')
  return parts.length === 3 && parts.every((part) => part.length > 4 && /^[A-Za-z0-9_-]+$/.test(part))
}

function isBase64(value: string) {
  const compact = value.replace(/\s/g, '')
  return compact.length >= 16 && compact.length % 4 !== 1 && !compact.includes('.') && /^[A-Za-z0-9+/_=-]+$/.test(compact)
}

export function detectIntake(files: IntakeFileLike[], text: string): IntakeKind {
  if (files.length) {
    const kinds = new Set(files.map(fileKind))
    return kinds.size > 1 ? 'mixed' : [...kinds][0]
  }
  const value = text.trim()
  if (!value) return 'empty'
  try { JSON.parse(value); return 'json' } catch { /* continue */ }
  if (isJwt(value)) return 'jwt'
  if (isBase64(value)) return 'base64'
  if (isUrl(value)) return 'url'
  if (looksLikeCode(value)) return 'code'
  return 'text'
}

export function intakeSummary(kind: IntakeKind, count = 0) {
  const labels: Record<IntakeKind, string> = {
    empty: '等待内容', pdf: `${count} 份 PDF`, image: `${count} 张图片`, code: count ? `${count} 份代码文件` : '代码片段',
    json: 'JSON 数据', jwt: 'JWT 令牌', base64: 'Base64 数据', url: '网页链接', text: '文本内容', mixed: `${count} 个混合文件`, files: `${count} 个文件`
  }
  return labels[kind]
}
