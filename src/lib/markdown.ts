import MarkdownIt from 'markdown-it'
import katex from 'katex'
import { highlightCode } from '@/lib/code-highlight'

const md = new MarkdownIt({
  linkify: true,
  breaks: true,
  highlight(code, language) {
    const safe = highlightCode(code, language)
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
