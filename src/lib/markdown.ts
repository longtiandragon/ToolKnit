import MarkdownIt from 'markdown-it'
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
import katex from 'katex'

for (const [name, language] of Object.entries({ bash, cpp, css, go, java, javascript, json, python, rust, sql, typescript, xml })) {
  hljs.registerLanguage(name, language)
}
hljs.registerAliases(['sh', 'shell'], { languageName: 'bash' })
hljs.registerAliases(['c', 'h', 'hpp'], { languageName: 'cpp' })
hljs.registerAliases(['js', 'jsx'], { languageName: 'javascript' })
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' })
hljs.registerAliases(['html', 'vue'], { languageName: 'xml' })

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character))

const md = new MarkdownIt({
  linkify: true,
  breaks: true,
  highlight(code, language) {
    const safe = language && hljs.getLanguage(language)
      ? hljs.highlight(code, { language }).value
      : escapeHtml(code)
    return `<pre class="code-block"><code>${safe}</code></pre>`
  }
})

function renderMath(source: string) {
  return source
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false }))
    .replace(/(?<!\\)\$([^$\n]+?)\$/g, (_, tex) => katex.renderToString(tex.trim(), { throwOnError: false }))
}

export function renderMarkdown(source: string) {
  return renderMath(md.render(source))
}
