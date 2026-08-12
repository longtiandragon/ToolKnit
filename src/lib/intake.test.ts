import { describe, expect, it } from 'vitest'
import { detectIntake, intakeSummary, isQuickIntakeShortcut, normalizeQuickIntakeDraft, QUICK_INTAKE_DRAFT_LIMIT } from './intake'

describe('universal intake detection', () => {
  it('detects file groups and mixed input', () => {
    expect(detectIntake([{ name: 'a.pdf', type: 'application/pdf' }], '')).toBe('pdf')
    expect(detectIntake([{ name: 'a.png', type: 'image/png' }, { name: 'b.jpg', type: 'image/jpeg' }], '')).toBe('image')
    expect(detectIntake([{ name: 'a.pdf' }, { name: 'b.png' }], '')).toBe('mixed')
  })

  it('detects structured pasted content', () => {
    expect(detectIntake([], '{"ok":true}')).toBe('json')
    expect(detectIntake([], 'https://example.com/path?q=1')).toBe('url')
    expect(detectIntake([], 'const answer = 42;')).toBe('code')
    expect(detectIntake([], '今天整理课程笔记')).toBe('text')
  })

  it('creates a concise summary', () => {
    expect(intakeSummary('image', 3)).toBe('3 张图片')
  })

  it('keeps recovery drafts bounded and ignores invalid persisted values', () => {
    expect(normalizeQuickIntakeDraft('待整理的课堂记录')).toBe('待整理的课堂记录')
    expect(normalizeQuickIntakeDraft({ text: 'wrong shape' })).toBe('')
    expect(normalizeQuickIntakeDraft('x'.repeat(QUICK_INTAKE_DRAFT_LIMIT + 5))).toHaveLength(QUICK_INTAKE_DRAFT_LIMIT)
  })

  it('recognizes only the dedicated global capture shortcut', () => {
    expect(isQuickIntakeShortcut({ ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, key: 'N' })).toBe(true)
    expect(isQuickIntakeShortcut({ ctrlKey: false, metaKey: true, shiftKey: true, altKey: false, key: 'n' })).toBe(true)
    expect(isQuickIntakeShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: 'n' })).toBe(false)
    expect(isQuickIntakeShortcut({ ctrlKey: true, metaKey: false, shiftKey: true, altKey: true, key: 'n' })).toBe(false)
  })
})
