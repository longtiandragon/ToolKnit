import { describe, expect, it } from 'vitest'
import { collectPrivateToolOutputPaths } from './private-tool-output'

describe('private tool output paths', () => {
  it('recognizes common output payload shapes without tying scripts to one schema', () => {
    expect(collectPrivateToolOutputPaths({
      ok: true,
      outputPath: 'C:\\Work\\report.json',
      outputs: ['C:\\Work\\first.txt', 'C:/Work/second.txt'],
      summary: { files: [{ path: '/tmp/export.csv' }, { outputFile: '\\\\server\\share\\done.pdf' }] },
    })).toEqual([
      'C:\\Work\\report.json',
      'C:\\Work\\first.txt',
      'C:/Work/second.txt',
      '/tmp/export.csv',
      '\\\\server\\share\\done.pdf',
    ])
  })

  it('ignores relative names, ordinary text and URLs even under output-like keys', () => {
    expect(collectPrivateToolOutputPaths({
      output: 'report.json',
      files: ['https://example.com/report.json', '已完成'],
      detail: 'C:\\Work\\not-an-output.txt',
      outputPath: 'C:\\Work\\kept.txt',
      nested: { result: 'C:\\Work\\kept.txt' },
    })).toEqual(['C:\\Work\\kept.txt'])
  })
})
