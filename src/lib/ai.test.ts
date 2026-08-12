import { describe, expect, it } from 'vitest'
import { aiErrorMessage, makeChatCompletionRequest, makeContentChatCompletionRequest, readChatCompletionText } from './ai'

describe('AI chat completion compatibility', () => {
  it('disables default thinking for DeepSeek V4 content actions', () => {
    expect(makeChatCompletionRequest('deepseek-v4-flash', 0.2, [])).toMatchObject({
      model: 'deepseek-v4-flash',
      thinking: { type: 'disabled' },
    })
    expect(makeChatCompletionRequest('deepseek-v4-pro', 0.2, [])).toMatchObject({
      thinking: { type: 'disabled' },
    })
  })

  it('does not send DeepSeek-only options to other compatible providers', () => {
    expect(makeChatCompletionRequest('gpt-4.1-mini', 0.2, [])).not.toHaveProperty('thinking')
  })

  it('builds the same complete DeepSeek body used by the content workbench', () => {
    const request = makeContentChatCompletionRequest('deepseek-v4-flash', 'rewrite', '原始材料')
    expect(request).toMatchObject({
      model: 'deepseek-v4-flash',
      temperature: 0.45,
      stream: false,
      thinking: { type: 'disabled' },
    })
    expect(request.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: expect.stringContaining('原始材料') }),
    ]))
  })

  it('returns final text and rejects silent empty responses', () => {
    expect(readChatCompletionText({ choices: [{ message: { content: '完成' } }] })).toBe('完成')
    expect(() => readChatCompletionText({ choices: [{ message: { content: '' } }] })).toThrow('没有返回可显示的文本')
  })

  it('preserves native string failures instead of hiding the diagnosis', () => {
    expect(aiErrorMessage('AI 服务请求失败：Authentication Fails')).toContain('Authentication Fails')
    expect(aiErrorMessage({ message: '连接超时' })).toBe('连接超时')
  })
})
