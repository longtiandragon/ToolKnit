import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import katex from 'katex'

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

export const questionTemplate = (title = '未命名错题') => `---
schema_version: 1
title: ${title}
type: algorithm
subject: 算法
tags: []
difficulty: 3
review_enabled: true
---

## 题目

## 我的尝试

## 错误原因

## 正确解法

## 知识点

## 复盘
`
