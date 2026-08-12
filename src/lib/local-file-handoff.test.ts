import { beforeEach, describe, expect, it } from 'vitest'
import { clearLocalFileHandoff, consumeLocalFileHandoff, stageLocalFileHandoff } from './local-file-handoff'

describe('local file handoff', () => {
  beforeEach(() => {
    clearLocalFileHandoff('ocr')
    clearLocalFileHandoff('markdown')
  })

  it('is consumed exactly once without exposing paths in a route', () => {
    stageLocalFileHandoff('ocr', ['F:\\Vault\\scan.png'], '资料库', 1000)
    expect(consumeLocalFileHandoff('ocr', 1500)).toMatchObject({ paths: ['F:\\Vault\\scan.png'], sourceLabel: '资料库' })
    expect(consumeLocalFileHandoff('ocr', 1500)).toBeUndefined()
  })

  it('deduplicates and bounds incoming paths', () => {
    const paths = Array.from({ length: 12 }, (_, index) => `F:\\images\\${index}.png`)
    const staged = stageLocalFileHandoff('ocr', [paths[0]!, ...paths, '  '], undefined, 1000)
    expect(staged?.paths).toHaveLength(8)
    expect(staged?.paths[0]).toBe(paths[0])
  })

  it('drops expired or time-invalid payloads', () => {
    stageLocalFileHandoff('ocr', ['F:\\old.png'], undefined, 1000)
    expect(consumeLocalFileHandoff('ocr', 121001)).toBeUndefined()
    stageLocalFileHandoff('ocr', ['F:\\future.png'], undefined, 5000)
    expect(consumeLocalFileHandoff('ocr', 4999)).toBeUndefined()
  })

  it('keeps desktop Markdown paths in a one-shot handoff', () => {
    stageLocalFileHandoff('markdown', ['F:\\Notes\\algorithm.md'], 'Windows 文件关联', 1000)
    expect(consumeLocalFileHandoff('markdown', 1200)).toMatchObject({
      paths: ['F:\\Notes\\algorithm.md'],
      sourceLabel: 'Windows 文件关联',
    })
    expect(consumeLocalFileHandoff('markdown', 1200)).toBeUndefined()
  })
})
