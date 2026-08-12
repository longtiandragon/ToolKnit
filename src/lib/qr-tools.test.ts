import { describe, expect, it } from 'vitest'
import { validateQrText } from './qr-tools'

describe('QR tools', () => {
  it('normalizes QR content', () => {
    expect(validateQrText('  https://toolknit.local  ')).toBe('https://toolknit.local')
  })

  it('rejects empty and excessively large payloads', () => {
    expect(() => validateQrText('   ')).toThrow('请输入')
    expect(() => validateQrText('x'.repeat(2001))).toThrow('2000')
  })
})
