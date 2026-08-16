import { describe, expect, it } from 'vitest'
import { assertPdfImageFits, buildRenamePreview, cleanOutputName, parsePageIndexes, pdfImageOutputName, pdfImageScaleForDpi, transformText, PDF_IMAGE_MAX_DIMENSION, PDF_IMAGE_MAX_PIXELS } from './file-tools'

describe('parsePageIndexes', () => {
  it('parses pages and ranges in the requested order', () => {
    expect(parsePageIndexes('3,1-2,5', 5)).toEqual([2, 0, 1, 4])
  })

  it.each(['0', '4-2', '1,abc', '6'])('rejects invalid range %s', (value) => {
    expect(() => parsePageIndexes(value, 5)).toThrow()
  })
})

describe('text transforms', () => {
  it('formats JSON', () => {
    expect(transformText('{"ok":true}', 'json')).toEqual({ content: '{\n  "ok": true\n}', extension: 'json' })
  })

  it('reports invalid JSON with an actionable Chinese message', () => {
    expect(() => transformText('{bad}', 'json')).toThrow(/JSON 格式错误.*请检查引号、逗号和括号/)
  })

  it('normalizes markdown blank lines', () => {
    expect(transformText('# 标题\r\n\r\n\r\n正文', 'markdown').content).toBe('# 标题\n\n正文\n')
  })

  it('deduplicates lines while preserving their first occurrence', () => {
    expect(transformText('苹果\n香蕉\n苹果\n\n香蕉', 'dedupe-lines').content).toBe('苹果\n香蕉\n')
  })

  it('sorts lines naturally', () => {
    expect(transformText('项目10\n项目2\n项目1', 'sort-lines').content).toBe('项目1\n项目2\n项目10\n')
  })

  it('extracts unique links and email addresses', () => {
    const result = transformText('联系 a@example.com，访问 https://example.com/a，再次访问 https://example.com/a', 'extract-contacts').content
    expect(result).toContain('链接（1）\nhttps://example.com/a')
    expect(result).toContain('邮箱（1）\na@example.com')
  })

  it('creates a local text statistics report', () => {
    const result = transformText('你好 world\n\n第二段', 'statistics').content
    expect(result).toContain('中文字符：5')
    expect(result).toContain('英文/数字词：1')
    expect(result).toContain('段落：2')
  })
})

describe('pdf image export helpers', () => {
  it('converts DPI to a viewport scale and clamps it', () => {
    expect(pdfImageScaleForDpi(72)).toBe(1)
    expect(pdfImageScaleForDpi(150)).toBeCloseTo(150 / 72)
    expect(pdfImageScaleForDpi(300)).toBeCloseTo(300 / 72)
    expect(pdfImageScaleForDpi(1200)).toBeCloseTo(300 / 72)
    expect(pdfImageScaleForDpi(0)).toBe(1)
  })

  it('names page outputs with zero-padded page numbers', () => {
    expect(pdfImageOutputName('课程 资料.pdf', 0, 12, 'png')).toBe('课程-资料-p01.png')
    expect(pdfImageOutputName('论文.pdf', 11, 12, 'webp')).toBe('论文-p12.webp')
    expect(pdfImageOutputName('报告.pdf', 0, 3, 'jpeg')).toBe('报告-p1.jpg')
  })

  it('accepts an A4 page at 300 DPI', () => {
    const size = assertPdfImageFits(595.28 * (300 / 72), 841.89 * (300 / 72), 3, 20)
    expect(size.width * size.height).toBeLessThan(PDF_IMAGE_MAX_PIXELS)
  })

  it('rejects pages over the single-page pixel budget with a hint to lower DPI', () => {
    expect(() => assertPdfImageFits(7000, 7000, 1, 2)).toThrow(/超过单页上限.*降低分辨率/)
    expect(() => assertPdfImageFits(PDF_IMAGE_MAX_DIMENSION + 1, 100, 1, 2)).toThrow(/降低分辨率/)
  })
})

describe('file naming', () => {
  it('keeps Chinese characters in output names', () => {
    expect(cleanOutputName('课程 资料.pdf')).toBe('课程-资料')
  })

  it('creates stable rename previews', () => {
    expect(buildRenamePreview(['a.txt', '无扩展名'], '归档')).toEqual([
      'a.txt  →  归档-001.txt',
      '无扩展名  →  归档-002'
    ])
  })

  it('supports rename numbering, suffixes and original names', () => {
    expect(buildRenamePreview(['课程 资料.pdf'], { prefix: '归档', suffix: '完成', start: 8, digits: 2 })).toEqual([
      '课程 资料.pdf  →  归档-08-完成.pdf'
    ])
    expect(buildRenamePreview(['课程 资料.pdf'], { prefix: '归档', suffix: '副本', keepOriginalName: true })).toEqual([
      '课程 资料.pdf  →  归档-课程-资料-副本.pdf'
    ])
  })
})
