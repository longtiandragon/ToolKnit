import { describe, expect, it } from 'vitest'
import type { OrganizerCandidate, OrganizerRule } from '@/types'
import {
  applyOrganizerRule,
  buildOrganizerAiEnvelope,
  detectOrganizerVersionFamilies,
  normalizeOrganizerRelativeDirectory,
  normalizeOrganizerTargetName,
  parseOrganizerSuggestions,
  truncateOrganizerExcerpt,
} from './smart-organizer'

function candidate(overrides: Partial<OrganizerCandidate> = {}): OrganizerCandidate {
  return {
    fileId: 'file-0123456789abcdef0123456789abcdef',
    name: '课程报告.pdf',
    relativePath: '下载/课程报告.pdf',
    extension: 'pdf',
    mime: 'application/pdf',
    kind: 'pdf',
    size: 2048,
    modifiedMs: Date.UTC(2026, 7, 19),
    signature: 'PDF',
    duplicateCount: 0,
    excerptMode: 'pdf',
    ...overrides,
  }
}

describe('smart organizer privacy and AI contract', () => {
  it('serializes exactly the messages that are sent and omits absolute roots', () => {
    const item = candidate()
    const excerpt = truncateOrganizerExcerpt('正文 '.repeat(3000))
    const envelope = buildOrganizerAiEnvelope([item], new Map([[item.fileId, {
      fileId: item.fileId,
      excerpt: excerpt.value,
      source: 'pdf-worker' as const,
      truncated: excerpt.truncated,
      byteCount: new TextEncoder().encode(excerpt.value).byteLength,
    }]]))
    expect(JSON.parse(envelope.serializedMessages)).toEqual(envelope.messages)
    expect(envelope.serializedMessages).not.toContain('C:\\Users')
    expect(envelope.files[0].excerpt && new TextEncoder().encode(envelope.files[0].excerpt).byteLength).toBeLessThanOrEqual(4096)
    expect(envelope.byteCount).toBeLessThan(512 * 1024)
  })

  it('rejects absolute paths, traversal, extension changes, duplicate ids and commands-as-fields', () => {
    expect(() => normalizeOrganizerRelativeDirectory('../outside')).toThrow(/路径|目录/)
    expect(() => normalizeOrganizerRelativeDirectory('C:\\Users\\me')).toThrow(/相对目录/)
    const item = candidate()
    expect(() => parseOrganizerSuggestions(JSON.stringify({ suggestions: [{
      fileId: item.fileId,
      category: '课程',
      targetRelativeDir: '课程',
      targetBaseName: 'run.exe',
      confidence: .9,
      reason: '分类',
    }] }), [item])).toThrow(/扩展名/)
    expect(() => parseOrganizerSuggestions(JSON.stringify({ suggestions: [{
      fileId: item.fileId,
      category: '课程',
      targetRelativeDir: '课程',
      targetBaseName: '课程报告.pdf',
      confidence: .9,
      reason: '分类',
      command: 'del /s',
    }] }), [item])).toThrow(/未授权字段/)
    expect(() => parseOrganizerSuggestions(JSON.stringify({ suggestions: [], command: 'del /s' }), [])).toThrow(/未授权字段/)
  })

  it('accepts long valid Chinese Windows names and rejects overlong components', () => {
    const item = candidate()
    expect(normalizeOrganizerTargetName(`${'课程资料'.repeat(30)}.pdf`, item)).toMatch(/\.pdf$/)
    expect(() => normalizeOrganizerTargetName(`${'a'.repeat(256)}.pdf`, item)).toThrow(/255/)
  })

  it('accepts one bounded structured suggestion per selected file', () => {
    const item = candidate()
    expect(parseOrganizerSuggestions(JSON.stringify({ suggestions: [{
      fileId: item.fileId,
      category: '课程作业',
      targetRelativeDir: '课程/2026',
      targetBaseName: '课程报告',
      confidence: .93,
      reason: '文件名和 PDF 摘要都指向课程报告',
    }] }), [item])).toEqual([{
      fileId: item.fileId,
      category: '课程作业',
      targetRelativeDir: '课程/2026',
      targetBaseName: '课程报告.pdf',
      confidence: .93,
      reason: '文件名和 PDF 摘要都指向课程报告',
    }])
  })
})

describe('smart organizer local automation', () => {
  it('applies portable rules without owning machine paths', () => {
    const rule: OrganizerRule = {
      id: '018fdc73-0000-7000-8000-000000000001',
      title: '课程 PDF',
      trustLevel: 'confirmed',
      enabled: true,
      matcher: { extensions: ['pdf'], kinds: ['pdf'], namePatterns: ['课程'] },
      action: {
        category: '课程',
        targetRelativeDirTemplate: '课程/{year}/{month}',
        targetBaseNameTemplate: '{stem}.{extension}',
        conflictPolicy: 'block',
      },
      createdAt: '2026-08-19T00:00:00Z',
      updatedAt: '2026-08-19T00:00:00Z',
    }
    const plan = applyOrganizerRule(rule, [candidate()])
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ targetRelativeDir: '课程/2026/08', targetBaseName: '课程报告.pdf', confidence: 1 })
    expect(JSON.stringify(rule)).not.toMatch(/[A-Z]:\\/)
  })

  it('finds final/copy variants as a review-only version family', () => {
    const members = [
      candidate({ fileId: 'file-a', name: '课程报告.pdf', modifiedMs: 1 }),
      candidate({ fileId: 'file-b', name: '课程报告最终版.pdf', modifiedMs: 3 }),
      candidate({ fileId: 'file-c', name: '课程报告修改版.pdf', modifiedMs: 2 }),
    ]
    const families = detectOrganizerVersionFamilies(members)
    expect(families).toHaveLength(1)
    expect(families[0].members).toHaveLength(3)
    expect(families[0].recommendedFileId).toBe('file-b')
  })
})
