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
  const source = content.trim()
  if (!source) return 'javascript'

  // Clipboard snippets normally have no trustworthy filename. Prefer strong,
  // human-readable syntax signals before highlight.js' statistical detector;
  // short snippets such as `const value: string = ...` are otherwise often
  // reported as C++ or Java.
  if (/^\s*[\[{]/.test(source)) {
    try { JSON.parse(source); return 'json' } catch { /* It may be code with a block body. */ }
  }
  if (/<template(?:\s|>)|<script\s+setup|<style(?:\s|>)/i.test(source)) return 'xml'
  if (/<!doctype\s+html|<html(?:\s|>)|<\/?(?:div|span|main|section|article|head|body)(?:\s|>)/i.test(source)) return 'xml'
  if (/^\s*(?:package\s+[\w.]+;|public\s+(?:final\s+)?class\s+)|\bSystem\.out\.(?:print|println)\s*\(/m.test(source)) return 'java'
  if (/^\s*(?:#include\s*[<"]|using\s+namespace\s+std\b)|\bstd::|\b(?:cout|cin)\s*<</m.test(source)) return 'cpp'
  if (/^\s*(?:fn\s+main\s*\(|use\s+(?:std|crate)::)|\b(?:println|eprintln)!\s*\(|\blet\s+mut\b/m.test(source)) return 'rust'
  if (/^\s*package\s+\w+\s*$|^\s*func\s+\w+\s*\(|:=/m.test(source)) return 'go'
  if (/^\s*(?:def|class)\s+\w+.*:\s*$|^\s*(?:from\s+[\w.]+\s+import|import\s+[\w.]+)|\bif\s+__name__\s*==/m.test(source)) return 'python'
  if (/^\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b[\s\S]*\b(?:FROM|VALUES|SET|TABLE)\b/im.test(source)) return 'sql'
  if (/^\s*(?:interface|type|enum|namespace)\s+\w+|\bimport\s+type\b|\bas\s+const\b|\b(?:const|let|var)\s+\w+\s*:\s*[A-Za-z_$][\w$<>,.[\] |&?]*/m.test(source)) return 'typescript'
  if (/^\s*(?:@(?:media|supports|keyframes)|[.#]?[A-Za-z][\w\s.#:[\]="'-]*\{)|--[\w-]+\s*:|\b(?:display|color|background|margin|padding|font-size)\s*:/m.test(source)) return 'css'
  if (/\b(?:const|let|var|function|class)\s+[A-Za-z_$]|=>|\b(?:console|document|window)\./m.test(source)) return 'javascript'
  if (/^\s*#!.*\b(?:ba|z|fi)?sh\b|^\s*echo\s+|^\s*export\s+[A-Za-z_]\w*=|\$\{?[A-Za-z_][\w]*\}?/m.test(source)) return 'bash'

  const detected = hljs.highlightAuto(source, codeLanguages.map((item) => item.id)).language
  return (codeLanguages.some((item) => item.id === detected) ? detected : 'javascript') as CodeLanguage
}

export function highlightCode(code: string, language?: string) {
  return language && hljs.getLanguage(language) ? hljs.highlight(code, { language }).value : escapeCodeHtml(code)
}
