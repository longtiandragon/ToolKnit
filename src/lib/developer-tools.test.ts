import { describe, expect, it } from 'vitest'
import { convertNumberBase, convertTimestamp, decodeBase64, decodeJwt, decodeUrl, diffLines, encodeBase64, encodeUrl, generateUuids, sha256, testRegex, transformJson } from './developer-tools'

describe('Base64 and URL transforms', () => {
  it('round-trips Unicode Base64 text', () => {
    expect(decodeBase64(encodeBase64('你好，ToolKnit 👋'))).toBe('你好，ToolKnit 👋')
  })

  it('round-trips a URL component', () => {
    expect(decodeUrl(encodeUrl('https://example.com/搜索?q=工具 箱'))).toBe('https://example.com/搜索?q=工具 箱')
  })
})

describe('hash and time utilities', () => {
  it('calculates SHA-256', async () => {
    await expect(sha256('abc')).resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('recognizes second timestamps', () => {
    expect(convertTimestamp('0', 'en-US').iso).toBe('1970-01-01T00:00:00.000Z')
  })

  it('rejects invalid dates', () => {
    expect(() => convertTimestamp('not-a-date')).toThrow('无法识别')
  })
})

describe('regex tester', () => {
  it('returns all matches and capture groups', () => {
    expect(testRegex('(T\\w+)', 'i', 'ToolKnit and toolbox')).toEqual([
      { index: 0, value: 'ToolKnit', groups: ['ToolKnit'] },
      { index: 13, value: 'toolbox', groups: ['toolbox'] }
    ])
  })

  it('rejects invalid expressions', () => {
    expect(() => testRegex('[', '', 'text')).toThrow()
  })
})

describe('line diff', () => {
  it('marks added and removed lines', () => {
    expect(diffLines('第一行\n旧内容', '第一行\n新内容')).toEqual([
      { kind: 'same', text: '第一行', leftLine: 1, rightLine: 1 },
      { kind: 'removed', text: '旧内容', leftLine: 2 },
      { kind: 'added', text: '新内容', rightLine: 2 }
    ])
  })

  it('caps inputs that would create an oversized matrix', () => {
    const longText = Array.from({ length: 5 }, (_, index) => String(index)).join('\n')
    expect(() => diffLines(longText, longText, 4)).toThrow('最多支持')
  })
})

describe('structured data utilities', () => {
  it('formats and compacts JSON', () => {
    expect(transformJson('{"name":"工具箱"}')).toBe('{\n  "name": "工具箱"\n}')
    expect(transformJson('{\n  "ok": true\n}', true)).toBe('{"ok":true}')
  })

  it('reports invalid JSON clearly', () => {
    expect(() => transformJson('{broken}')).toThrow('JSON 解析失败')
  })

  it('decodes JWT claims without verifying the signature', () => {
    const token = `${encodeBase64('{"alg":"none"}').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.${encodeBase64('{"sub":"42","exp":1700000000}').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`
    expect(decodeJwt(token, 1_800_000_000_000)).toMatchObject({ payload: { sub: '42', exp: 1700000000 }, expired: true })
  })

  it('rejects malformed JWT input', () => {
    expect(() => decodeJwt('not-a-token')).toThrow('三部分')
  })
})

describe('generators and number conversion', () => {
  it('generates the requested number of UUIDs', () => {
    const values = generateUuids(3).split('\n')
    expect(values).toHaveLength(3)
    values.forEach((value) => expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i))
  })

  it('caps UUID batch size', () => {
    expect(() => generateUuids(101)).toThrow('1 到 100')
  })

  it('converts large signed integers between bases', () => {
    expect(convertNumberBase('FF_FF', 16, 10)).toBe('65535')
    expect(convertNumberBase('-1010', 2, 16)).toBe('-A')
  })

  it('rejects digits outside the source base', () => {
    expect(() => convertNumberBase('102', 2, 10)).toThrow('不属于')
  })
})
