import { describe, expect, it } from 'vitest'
import type { PrivateToolField } from '@/lib/private-tools-native'
import { privateToolDisplayText, privateToolFieldError, privateToolFieldErrors, privateToolFieldValue, privateToolManifestTemplate, privateToolReplay, privateToolRouteAction } from './private-tool-workflows'

const integerField: PrivateToolField = { key: 'count', label: '数量', kind: 'integer', placeholder: '', help: '', required: true, defaultValue: '', options: [], min: 1, max: 20 }
const selectField: PrivateToolField = { key: 'mode', label: '模式', kind: 'select', placeholder: '', help: '', required: true, defaultValue: 'safe', options: [{ label: '安全', value: 'safe' }] }

describe('private tool workflow model', () => {
  it('validates required, integer range and manifest-owned selections before running', () => {
    expect(privateToolFieldError(integerField, '')).toBe('请填写数量')
    expect(privateToolFieldError(integerField, '1.5')).toBe('数量必须是整数')
    expect(privateToolFieldError(integerField, '0')).toBe('数量不能小于 1')
    expect(privateToolFieldError(integerField, '21')).toBe('数量不能大于 20')
    expect(privateToolFieldError(integerField, '12')).toBe('')
    expect(privateToolFieldError(integerField, 12)).toBe('')
    expect(privateToolFieldValue(0)).toBe('0')
    expect(privateToolFieldError(selectField, 'unsafe')).toBe('模式的选项无效')
    expect(privateToolFieldErrors([integerField, selectField], { count: '12', mode: 'safe' })).toEqual({})
  })

  it('bounds rendered logs without changing the full copy source', () => {
    const value = 'x'.repeat(24)
    expect(privateToolDisplayText(value, 12)).toEqual({ text: `${'x'.repeat(12)}\n\n…界面预览已截断；复制操作仍会使用完整内容。`, truncated: true, hiddenCharacters: 12 })
    expect(privateToolDisplayText('short', 12)).toEqual({ text: 'short', truncated: false, hiddenCharacters: 0 })
  })

  it('normalizes route actions and ships a valid generic changes-files template', () => {
    expect(privateToolRouteAction('choose-manifest')).toBe('choose-manifest')
    expect(privateToolRouteAction('copy-template')).toBe('copy-template')
    expect(privateToolRouteAction(['reload'])).toBeUndefined()
    const template = JSON.parse(privateToolManifestTemplate)
    expect(template.version).toBe(1)
    expect(template.tools[0].operations[0]).toMatchObject({ risk: 'changesFiles' })
    expect(template.tools[0].operations[0].previewArguments).toContain('--dry-run')
  })

  it('restores only private script form parameters without executing the job', () => {
    expect(privateToolReplay({
      id: 'run-1', kind: 'script', label: '整理文件', status: 'failed', progress: 100, createdAt: '2026-08-11T10:00:00.000Z',
      toolId: 'private:file-kit:rename', parameters: { mode: 'apply', prefix: '课程', start: 8, unsafe: true },
    })).toEqual({ toolId: 'file-kit', operationId: 'rename', mode: 'apply', values: { prefix: '课程', start: 8 } })
    expect(privateToolReplay({ id: 'bad', kind: 'media', label: '媒体', status: 'failed', progress: 100, createdAt: '2026-08-11T10:00:00.000Z' })).toBeUndefined()
  })
})
