import { describe, expect, it } from 'vitest'
import { aiProviderPresets, findAiProviderPreset } from './ai-presets'

describe('AI provider presets', () => {
  it('contains official, relay and local OpenAI-compatible providers', () => {
    expect(aiProviderPresets.map((preset) => preset.id)).toEqual(expect.arrayContaining([
      'openai', 'deepseek', 'sub2api', 'openrouter', 'dashscope', 'groq', 'ollama', 'lm-studio',
    ]))
  })

  it('uses verified compatible base URLs for common providers', () => {
    expect(findAiProviderPreset('deepseek')?.baseUrl).toBe('https://api.deepseek.com')
    expect(findAiProviderPreset('openrouter')?.baseUrl).toBe('https://openrouter.ai/api/v1')
    expect(findAiProviderPreset('dashscope')?.baseUrl).toContain('/compatible-mode/v1')
  })

  it('does not hard-code a third-party Sub2API deployment', () => {
    const preset = findAiProviderPreset('sub2api')
    expect(preset?.baseUrl).toBe('')
    expect(preset?.models).toEqual([])
  })
})
