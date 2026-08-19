import { describe, expect, it } from 'vitest'
import { consumeArtifactHandoff, createDirectoryArtifactHandoff, createOrganizerArtifactHandoff } from './artifact-handoff'

describe('transient artifact handoff', () => {
  it('keeps absolute paths out of tickets and consumes organizer files once', () => {
    const ticket = createOrganizerArtifactHandoff('C:\\Archive', [{
      name: '课程报告.pdf', relativePath: '课程/课程报告.pdf', size: 2048, mime: 'application/pdf',
    }], 1_000)
    expect(JSON.stringify(ticket)).not.toContain('Archive')
    const payload = consumeArtifactHandoff(ticket.id, 1_001)
    expect(payload?.kind).toBe('files')
    if (payload?.kind !== 'files') throw new Error('expected a file handoff')
    expect(payload.artifacts[0]).toMatchObject({ kind: 'pdf', name: '课程报告.pdf', size: 2048 })
    expect(payload.artifacts[0].locator?.value).toBe('C:\\Archive\\课程\\课程报告.pdf')
    expect(consumeArtifactHandoff(ticket.id, 1_002)).toBeUndefined()
  })

  it('expires directory handoffs and rejects path traversal', () => {
    const ticket = createDirectoryArtifactHandoff('D:\\Outputs', '流水线输出', 10_000)
    expect(consumeArtifactHandoff(ticket.id, 10_000 + 15 * 60 * 1000)).toBeUndefined()
    expect(() => createOrganizerArtifactHandoff('C:\\Archive', [{ name: 'bad.txt', relativePath: '../bad.txt' }])).toThrow('相对路径')
    expect(() => createDirectoryArtifactHandoff('relative/output', '输出')).toThrow('绝对路径')
  })
})
