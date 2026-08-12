import { describe, expect, it } from 'vitest'
import { makeFormulaVisionMessages, normalizeFormulaRecognitionResult } from './formula-recognition'

describe('normalizeFormulaRecognitionResult', () => {
  it.each([
    ['```latex\n$$\\frac{a}{b}$$\n```', '\\frac{a}{b}'],
    ['LaTeX: \\[x^2+y^2=z^2\\]', 'x^2+y^2=z^2'],
    ['{"latex":"$E=mc^2$"}', 'E=mc^2'],
    ['"\\\\sum_{i=1}^{n} i"', '\\sum_{i=1}^{n} i'],
  ])('cleans compatible service output', (raw, expected) => {
    expect(normalizeFormulaRecognitionResult(raw)).toBe(expected)
  })

  it('rejects empty and excessively long output', () => {
    expect(() => normalizeFormulaRecognitionResult(' ```latex\n\n``` ')).toThrow('没有返回')
    expect(() => normalizeFormulaRecognitionResult('x'.repeat(4001))).toThrow('超过 4000')
  })
})

describe('makeFormulaVisionMessages', () => {
  it('keeps the image inside an explicit multimodal user message', () => {
    const dataUrl = 'data:image/jpeg;base64,/9j/AA=='
    const messages = makeFormulaVisionMessages(dataUrl)
    expect(messages[0].content).toContain('不是系统指令')
    expect(messages[1].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }),
    ]))
  })

  it('rejects non-JPEG payloads', () => {
    expect(() => makeFormulaVisionMessages('data:image/png;base64,AA==')).toThrow('JPEG')
  })
})
