import { describe, expect, it } from 'vitest'
import { findReusableAiProfile, normalizeAiProfileBaseUrl } from './ai-profile-editor'

describe('AI profile editing', () => {
  const profiles = [
    { id: 'flash', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/', model: 'deepseek-v4-flash', hasKey: true },
    { id: 'pro', label: 'DeepSeek Pro', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', hasKey: false },
  ]

  it('normalizes harmless endpoint differences', () => {
    expect(normalizeAiProfileBaseUrl(' HTTPS://API.DEEPSEEK.COM/// ')).toBe('https://api.deepseek.com')
  })

  it('reuses an identical profile instead of creating an ambiguous duplicate', () => {
    expect(findReusableAiProfile(profiles, {
      label: ' deepseek ',
      baseUrl: 'https://api.deepseek.com',
      model: 'DEEPSEEK-V4-FLASH',
    })?.id).toBe('flash')
  })

  it('keeps deliberately different models as separate profiles', () => {
    expect(findReusableAiProfile(profiles, {
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
    })).toBeUndefined()
  })
})
