import { describe, expect, it } from 'vitest'
import { detectCodeLanguage, highlightCode } from './code-highlight'

describe('code highlighting', () => {
  it('detects a language from the file extension', () => {
    expect(detectCodeLanguage('example.cpp')).toBe('cpp')
    expect(detectCodeLanguage('component.vue')).toBe('xml')
  })

  it('detects common clipboard snippets without trusting a .txt placeholder', () => {
    expect(detectCodeLanguage('snippet.txt', 'const title: string = "Knitspace"\nexport { title }')).toBe('typescript')
    expect(detectCodeLanguage('剪贴板代码.txt', 'def greet(name):\n    print(f"Hello {name}")')).toBe('python')
    expect(detectCodeLanguage('snippet.txt', '{"enabled":true,"items":[1,2]}')).toBe('json')
    expect(detectCodeLanguage('snippet.txt', '<template><main>{{ title }}</main></template>')).toBe('xml')
    expect(detectCodeLanguage('snippet.txt', '.card {\n  display: grid;\n  color: #fff;\n}')).toBe('css')
  })

  it('keeps a recognized filename authoritative', () => {
    expect(detectCodeLanguage('example.js', 'const title: string = "still a js file"')).toBe('javascript')
  })

  it('produces semantic highlight spans', () => {
    const html = highlightCode('const answer = true', 'javascript')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('hljs-literal')
  })
})
