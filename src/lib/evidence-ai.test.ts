import { describe, expect, it } from 'vitest'
import { buildEvidenceAiEnvelope, parseEvidenceAiResult } from './evidence-ai'

describe('evidence AI', () => {
  it('builds an exact bounded payload only from selected local sources', () => {
    const envelope = buildEvidenceAiEnvelope('两份资料的结论是什么？', [
      { sourceId: 'note-1', title: '课程笔记', kind: 'note', text: '第一行\n第二行：结论 A' },
      { sourceId: 'pdf-1', title: '报告.pdf', kind: 'pdf', text: '--- 第 1 页 ---\n结论 B\n\n--- 第 2 页 ---\n风险 C' },
    ])
    expect(JSON.parse(envelope.serializedMessages)).toEqual(envelope.messages)
    expect(envelope.chunks.map(item => item.locator)).toEqual(['行 1-2', '第 1 页', '第 2 页'])
    expect(envelope.byteCount).toBeLessThan(256 * 1024)
    expect(envelope.serializedMessages).not.toMatch(/[A-Z]:\\Users/i)
  })

  it('accepts citations only when source and locator exactly match the preview', () => {
    const envelope = buildEvidenceAiEnvelope('结论？', [{ sourceId: 'note-1', title: '笔记', kind: 'note', text: '证据内容' }])
    const valid = parseEvidenceAiResult(JSON.stringify({
      answer: '依据笔记，结论成立。',
      citations: [{ sourceId: 'note-1', locator: '行 1-1', claim: '结论依据' }],
      cards: [{ front: '结论是什么？', back: '成立', sourceId: 'note-1', locator: '行 1-1' }],
      terms: [],
    }), envelope)
    expect(valid.citations).toHaveLength(1)
    expect(() => parseEvidenceAiResult(JSON.stringify({
      answer: '伪造来源',
      citations: [{ sourceId: 'note-2', locator: '行 1-1', claim: '不存在' }],
      cards: [], terms: [],
    }), envelope)).toThrow(/未选择|不存在/)
  })
})
