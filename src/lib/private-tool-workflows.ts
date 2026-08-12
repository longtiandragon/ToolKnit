import type { PrivateToolField } from '@/lib/private-tools-native'
import type { Job } from '@/types'

export type PrivateToolRouteAction = 'choose-manifest' | 'copy-template' | 'reload'

export const PRIVATE_TOOL_DISPLAY_LIMIT = 120_000

export const privateToolManifestTemplate = JSON.stringify({
  version: 1,
  tools: [{
    id: 'my-file-tool',
    title: '我的文件整理工具',
    description: '脚本与真实路径保存在 Core 仓库之外。',
    icon: 'terminal',
    executable: 'python',
    operations: [{
      id: 'organize',
      title: '预览并整理',
      description: '先返回影响报告，确认后再修改文件。',
      risk: 'changesFiles',
      confirmationText: '确认预览结果与当前参数一致后，再修改本机文件。',
      fields: [
        { key: 'script', label: '脚本文件', kind: 'file', required: true, help: '选择你保存在仓库外的 Python 脚本。' },
        { key: 'inputDirectory', label: '输入目录', kind: 'directory', required: true, help: '脚本应向 stdout 返回单个 JSON 对象。' },
      ],
      arguments: ['${script}', '--input', '${inputDirectory}', '--apply'],
      previewArguments: ['${script}', '--input', '${inputDirectory}', '--dry-run'],
    }],
  }],
}, null, 2)

export function privateToolRouteAction(value: unknown): PrivateToolRouteAction | undefined {
  return value === 'choose-manifest' || value === 'copy-template' || value === 'reload' ? value : undefined
}

export function privateToolFieldValue(rawValue: unknown) {
  return rawValue === undefined || rawValue === null ? '' : String(rawValue).trim()
}

export function privateToolFieldError(field: PrivateToolField, rawValue: unknown) {
  const value = privateToolFieldValue(rawValue)
  if (field.required && !value) return `请填写${field.label}`
  if (!value) return ''
  if (field.kind === 'integer') {
    if (!/^-?\d+$/.test(value)) return `${field.label}必须是整数`
    const number = Number(value)
    if (field.min !== undefined && number < field.min) return `${field.label}不能小于 ${field.min}`
    if (field.max !== undefined && number > field.max) return `${field.label}不能大于 ${field.max}`
  }
  if (field.kind === 'select' && !field.options.some((option) => option.value === value)) return `${field.label}的选项无效`
  return ''
}

export function privateToolFieldErrors(fields: PrivateToolField[], values: Record<string, unknown>) {
  return Object.fromEntries(fields.flatMap((field) => {
    const error = privateToolFieldError(field, values[field.key])
    return error ? [[field.key, error]] : []
  }))
}

/** Extracts only form-safe values from a private-script history item. This
 * never authorizes execution and intentionally ignores booleans/arrays that
 * are not representable by the manifest field model. */
export function privateToolReplay(job: Job | undefined) {
  if (!job || job.kind !== 'script' || !job.toolId?.startsWith('private:') || !job.parameters) return undefined
  const [, toolId, operationId, ...extra] = job.toolId.split(':')
  if (!toolId || !operationId || extra.length) return undefined
  const mode = job.parameters.mode === 'apply' ? 'apply' : 'preview'
  const values = Object.fromEntries(Object.entries(job.parameters).filter(([key, value]) => key !== 'mode' && (typeof value === 'string' || typeof value === 'number')))
  return { toolId, operationId, mode, values }
}

export function privateToolDisplayText(value: string, limit = PRIVATE_TOOL_DISPLAY_LIMIT) {
  const safeLimit = Math.max(1, Math.trunc(limit))
  if (value.length <= safeLimit) return { text: value, truncated: false, hiddenCharacters: 0 }
  return {
    text: `${value.slice(0, safeLimit)}\n\n…界面预览已截断；复制操作仍会使用完整内容。`,
    truncated: true,
    hiddenCharacters: value.length - safeLimit,
  }
}
