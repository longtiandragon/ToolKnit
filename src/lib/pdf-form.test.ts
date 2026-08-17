import { describe, expect, it } from 'vitest'
import { parsePdfFormValues } from './pdf-form'

describe('pdf form values', () => {
  it('accepts bounded scalar and option values', () => {
    expect(parsePdfFormValues('{"姓名":"张三","同意":true,"城市":["上海","北京"]}')).toEqual({
      姓名: '张三',
      同意: true,
      城市: ['上海', '北京'],
    })
  })

  it('rejects ambiguous or unsafe input shapes', () => {
    expect(() => parsePdfFormValues('[]')).toThrow('必须是“字段名: 值”的对象')
    expect(() => parsePdfFormValues('{"同意":"yes"}')).not.toThrow()
    expect(() => parsePdfFormValues('{"同意":{"nested":true}}')).toThrow('必须是字符串、数字、布尔值或字符串数组')
  })

  it('rejects empty and malformed JSON', () => {
    expect(() => parsePdfFormValues('')).toThrow('请输入表单字段 JSON')
    expect(() => parsePdfFormValues('{"name":')).toThrow('JSON 格式无效')
  })
})
