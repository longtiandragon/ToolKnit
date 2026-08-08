import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import cpp from 'highlight.js/lib/languages/cpp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'

for (const [name, language] of Object.entries({ bash, cpp, css, go, java, javascript, json, python, rust, sql, typescript, xml })) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, language)
}

hljs.registerAliases(['sh', 'shell', 'powershell'], { languageName: 'bash' })
hljs.registerAliases(['c', 'h', 'hpp'], { languageName: 'cpp' })
hljs.registerAliases(['js', 'jsx'], { languageName: 'javascript' })
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' })
hljs.registerAliases(['html', 'vue'], { languageName: 'xml' })

export const codeLanguages = [
  { id: 'cpp', label: 'C / C++', extensions: ['c', 'cc', 'cpp', 'cxx', 'h', 'hpp'] },
  { id: 'javascript', label: 'JavaScript', extensions: ['js', 'jsx', 'mjs', 'cjs'] },
  { id: 'typescript', label: 'TypeScript', extensions: ['ts', 'tsx'] },
  { id: 'python', label: 'Python', extensions: ['py'] },
  { id: 'java', label: 'Java', extensions: ['java'] },
  { id: 'rust', label: 'Rust', extensions: ['rs'] },
  { id: 'go', label: 'Go', extensions: ['go'] },
  { id: 'json', label: 'JSON', extensions: ['json'] },
  { id: 'xml', label: 'HTML / Vue / XML', extensions: ['html', 'htm', 'vue', 'xml'] },
  { id: 'css', label: 'CSS / SCSS', extensions: ['css', 'scss', 'less'] },
  { id: 'bash', label: 'Shell', extensions: ['sh', 'bash', 'ps1'] },
  { id: 'sql', label: 'SQL', extensions: ['sql'] }
] as const

export type CodeLanguage = typeof codeLanguages[number]['id']

export function escapeCodeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character))
}

export function detectCodeLanguage(filename: string, content = ''): CodeLanguage {
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  const matched = codeLanguages.find((language) => (language.extensions as readonly string[]).includes(extension))
  if (matched) return matched.id
  const detected = content.trim() ? hljs.highlightAuto(content, codeLanguages.map((item) => item.id)).language : undefined
  return (codeLanguages.some((item) => item.id === detected) ? detected : 'javascript') as CodeLanguage
}

export function highlightCode(code: string, language?: string) {
  return language && hljs.getLanguage(language) ? hljs.highlight(code, { language }).value : escapeCodeHtml(code)
}
