import { describe, expect, it } from 'vitest'
import { readableNativeError } from './web-fetch-native'

describe('web fetch native errors', () => {
  it('preserves Tauri string rejections instead of hiding the reason', () => {
    expect(readableNativeError('网页返回 HTTP 521。', '抓取失败')).toBe('网页返回 HTTP 521。')
    expect(readableNativeError(new Error('连接超时'), '抓取失败')).toBe('连接超时')
  })

  it('uses a bounded fallback for empty or unknown errors', () => {
    expect(readableNativeError('', '抓取失败')).toBe('抓取失败')
    expect(readableNativeError({ status: 521 }, '抓取失败')).toBe('抓取失败')
  })
})
