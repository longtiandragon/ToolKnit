import { describe, expect, it } from 'vitest'
import { calculateDateDifference, calculateDateOffset, convertNumberBase, convertTimestamp, decodeBase64, decodeHex, decodeJwt, decodeUrl, diffLines, encodeBase64, encodeHex, encodeUrl, formatXml, generateUuids, sha256, testRegex, transformCsvJson, transformHtmlEntities, transformJson, transformJsonPath, transformJsonSchema, transformJsonYaml } from './developer-tools'

describe('Base64 and URL transforms', () => {
  it('round-trips Unicode Base64 text', () => {
    expect(decodeBase64(encodeBase64('你好，ToolKnit 👋'))).toBe('你好，ToolKnit 👋')
  })

  it('accepts Base64URL and omitted padding', () => {
    expect(decodeBase64('5L2g5aW9LVRvb2xLbml0Xw')).toBe('你好-ToolKnit_')
  })

  it('explains invalid Base64 length without exposing a browser error', () => {
    expect(() => decodeBase64('dawas')).toThrow('Base64 长度无效')
  })

  it('explains when decoded bytes are not UTF-8 text', () => {
    expect(() => decodeBase64('/w==')).toThrow('不是有效的 UTF-8 文本')
  })

  it('round-trips a URL component', () => {
    expect(decodeUrl(encodeUrl('https://example.com/搜索?q=工具 箱'))).toBe('https://example.com/搜索?q=工具 箱')
  })

  it('round-trips UTF-8 text as Hex and accepts a 0x prefix', () => {
    expect(encodeHex('你好 👋')).toBe('E4BDA0E5A5BD20F09F918B')
    expect(decodeHex(`0x${encodeHex('你好 👋')}`)).toBe('你好 👋')
    expect(() => decodeHex('ABC')).toThrow('偶数')
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

describe('date calculator', () => {
  it('calculates forward and backward calendar intervals', () => {
    expect(calculateDateDifference('2026-08-01', '2026-08-17')).toMatchObject({ days: 16, weeks: 2, remainingDays: 2, direction: 'forward' })
    expect(calculateDateDifference('2026-08-17', '2026-08-01').direction).toBe('backward')
  })

  it('adds dates and clamps the end of a month', () => {
    expect(calculateDateOffset('2025-01-31', 1, 'months', 'zh-CN')).toMatchObject({ date: '2025-02-28', weekday: '星期五' })
    expect(calculateDateOffset('2024-02-29', 1, 'years', 'zh-CN').date).toBe('2025-02-28')
  })

  it('rejects impossible dates and unsafe offsets', () => {
    expect(() => calculateDateDifference('2026-02-30', '2026-03-01')).toThrow('日期不存在')
    expect(() => calculateDateOffset('2026-08-09', 100_001, 'days')).toThrow('偏移量')
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

  it('converts JSON and YAML with the safe JSON schema', () => {
    const yaml = transformJsonYaml('{"name":"工具箱","enabled":true}', 'json-to-yaml')
    expect(yaml).toContain('name: 工具箱')
    expect(transformJsonYaml(yaml, 'yaml-to-json')).toBe('{\n  "name": "工具箱",\n  "enabled": true\n}')
    expect(() => transformJsonYaml('!!js/function >\n  () => 1', 'yaml-to-json')).toThrow('YAML 解析失败')
  })

  it('round-trips CSV with quoted commas and duplicate headers', () => {
    const json = transformCsvJson('name,name,note\nAda,Ada,"hello, world"\n', 'csv-to-json')
    expect(JSON.parse(json)).toEqual([{ name: 'Ada', name_2: 'Ada', note: 'hello, world' }])
    expect(transformCsvJson(json, 'json-to-csv')).toContain('"hello, world"')
  })

  it('decodes JWT claims without verifying the signature', () => {
    const token = `${encodeBase64('{"alg":"none"}').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.${encodeBase64('{"sub":"42","exp":1700000000}').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`
    expect(decodeJwt(token, 1_800_000_000_000)).toMatchObject({ payload: { sub: '42', exp: 1700000000 }, expired: true })
  })

  it('rejects malformed JWT input', () => {
    expect(() => decodeJwt('not-a-token')).toThrow('三部分')
  })

  it('formats XML without executing external entities', () => {
    expect(formatXml('<?xml version="1.0"?><root><item id="1"> hello </item><!-- note --></root>')).toBe('<?xml version="1.0"?>\n<root>\n  <item id="1">\n    hello\n  </item>\n  <!-- note -->\n</root>')
    expect(() => formatXml('<root><item></root>')).toThrow('未正确闭合')
    expect(() => formatXml('<root/><second/>')).toThrow('只能有一个根元素')
  })

  it('encodes and decodes common and numeric HTML entities', () => {
    expect(transformHtmlEntities('<p title="A&B">Tom & Jerry</p>', 'encode')).toBe('&lt;p title=&quot;A&amp;B&quot;&gt;Tom &amp; Jerry&lt;/p&gt;')
    expect(transformHtmlEntities('&lt;A&gt; &#x1F44B; &copy; &unknown;', 'decode')).toBe('<A> 👋 © &unknown;')
  })
})

describe('JSONPath queries', () => {
  const document = JSON.stringify({ users: [{ name: 'Ada', roles: ['admin'] }, { name: 'Lin', roles: ['editor'] }], nested: { name: 'Root' } })

  it('selects nested properties, array indexes and wildcards', () => {
    expect(transformJsonPath(document, '$.users[0].name')).toBe('"Ada"')
    expect(JSON.parse(transformJsonPath(document, '$.users[*].name'))).toEqual(['Ada', 'Lin'])
    expect(JSON.parse(transformJsonPath(document, '$["nested"].name'))).toBe('Root')
  })

  it('supports bounded recursive lookup and clear syntax errors', () => {
    expect(JSON.parse(transformJsonPath(document, '$..name'))).toEqual(['Ada', 'Lin', 'Root'])
    expect(() => transformJsonPath(document, 'users.name')).toThrow('必须以 $ 开头')
    expect(() => transformJsonPath(document, '$.users[')).toThrow('缺少右方括号')
  })
})

describe('JSON Schema generation and validation', () => {
  it('infers nested fields and array item types from a JSON sample', () => {
    const schema = JSON.parse(transformJsonSchema(JSON.stringify({ name: 'Ada', age: 36, tags: ['admin', 'author'], profile: { active: true } }), 'generate'))
    expect(schema.$schema).toContain('2020-12')
    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(['name', 'age', 'tags', 'profile'])
    expect(schema.properties.tags).toEqual({ type: 'array', items: { type: 'string' } })
    expect(schema.properties.profile.properties.active).toEqual({ type: 'boolean' })
  })

  it('returns bounded validation errors without modifying the input', () => {
    const schema = JSON.stringify({ type: 'object', properties: { name: { type: 'string', minLength: 3 }, age: { type: 'integer', minimum: 18 } }, required: ['name', 'age'], additionalProperties: false })
    const report = JSON.parse(transformJsonSchema('{"name":"Al","age":17,"extra":true}', 'validate', schema))
    expect(report.valid).toBe(false)
    expect(report.errorCount).toBe(3)
    expect(report.errors.map((item: { keyword: string }) => item.keyword)).toEqual(['minLength', 'minimum', 'additionalProperties'])
  })

  it('accepts valid JSON and explains malformed schemas', () => {
    const report = JSON.parse(transformJsonSchema('{"ok":true}', 'validate', '{"type":"object","required":["ok"]}'))
    expect(report).toEqual({ valid: true, errorCount: 0, errors: [] })
    expect(() => transformJsonSchema('{}', 'validate', '[]')).toThrow('必须是对象')
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
