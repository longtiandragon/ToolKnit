import { describe, expect, it } from 'vitest'
import { detectCodeLanguage, highlightCode } from './code-highlight'

describe('code highlighting', () => {
  it('detects a language from the file extension', () => {
    expect(detectCodeLanguage('example.cpp')).toBe('cpp')
    expect(detectCodeLanguage('component.vue')).toBe('xml')
  })

  it('produces semantic highlight spans', () => {
    const html = highlightCode('const answer = true', 'javascript')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('hljs-literal')
  })
})
