import { describe, expect, it } from 'vitest'
import { matchesRedactionTerm, parseRedactionTerms, redactionRectangle } from './pdf-redaction'

describe('PDF permanent redaction helpers', () => {
  it('normalizes comma/newline separated terms without duplicates', () => {
    expect(parseRedactionTerms('姓名，电话\n姓名; 地址')).toEqual(['姓名', '电话', '地址'])
  })

  it('matches terms case-insensitively inside a text item', () => {
    expect(matchesRedactionTerm('Contact EMAIL: demo@example.com', ['email'])).toBe(true)
    expect(matchesRedactionTerm('ordinary text', ['email'])).toBe(false)
  })

  it('returns a padded canvas rectangle for a matching item', () => {
    expect(redactionRectangle({ str: '姓名：张三', transform: [10, 0, 0, 10, 20, 80], width: 60 }, [1, 0, 0, -1, 0, 100], 1, ['张三']))
      .toEqual({ x: 18, y: 8, width: 64, height: 14 })
    expect(redactionRectangle({ str: '普通文本', transform: [10, 0, 0, 10, 20, 80], width: 60 }, [1, 0, 0, -1, 0, 100], 1, ['张三']))
      .toBeUndefined()
  })
})
