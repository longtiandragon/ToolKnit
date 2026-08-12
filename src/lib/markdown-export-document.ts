function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

export function safeMarkdownExportName(title: string, extension = 'html') {
  let base = title.replace(/[\u0000-\u001f\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '') || 'untitled'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = `_${base}`
  return `${base.slice(0, 120)}.${extension}`
}

export function standaloneMarkdownHtml(title: string, body: string) {
  const safeTitle = escapeHtml(title.trim() || '未命名文档')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="Knitspace local Markdown export">
<title>${safeTitle}</title>
<style>
:root{color-scheme:light;--ink:#1c2d26;--muted:#56675f;--line:#dcded7;--paper:#fffefa;--soft:#f3f4ef;--green:#176348}
*{box-sizing:border-box}html{background:#eceee9}body{max-width:920px;min-height:100vh;margin:0 auto;padding:64px 72px;color:var(--ink);background:var(--paper);font-family:"Segoe UI Variable Text","Microsoft YaHei UI","PingFang SC",sans-serif;font-size:16px;line-height:1.78}
h1,h2,h3,h4,h5,h6{margin:1.55em 0 .65em;line-height:1.28;letter-spacing:-.02em}h1{margin-top:0;padding-bottom:.35em;border-bottom:1px solid var(--line);font-size:2.15em}h2{font-size:1.55em}h3{font-size:1.28em}p,ul,ol,blockquote,pre,table,figure{margin:1em 0}a{color:var(--green);text-decoration-thickness:1px;text-underline-offset:3px}blockquote{margin-left:0;padding:.35em 1em;border-left:4px solid #77a38f;color:var(--muted);background:var(--soft)}
code{font-family:"Cascadia Code","JetBrains Mono",Consolas,monospace;font-size:.9em}p code,li code{padding:.12em .34em;border:1px solid var(--line);border-radius:4px;background:var(--soft)}.code-frame{overflow:hidden;border:1px solid #d5dbd6;border-radius:10px;background:#f6f8f6}.code-frame__bar{padding:7px 12px;border-bottom:1px solid #dce1dd;color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase}.code-block{overflow:auto;margin:0;padding:16px 18px;line-height:1.65;background:#f9fbf9}.hljs-keyword,.hljs-selector-tag{color:#7b3f91}.hljs-string,.hljs-attr{color:#276e52}.hljs-number,.hljs-literal{color:#9b552d}.hljs-comment{color:#75827b;font-style:italic}
table{width:100%;border-collapse:collapse}th,td{padding:8px 10px;border:1px solid var(--line);text-align:left}th{background:var(--soft)}img,svg{max-width:100%;height:auto}.math-block{max-width:100%;overflow:auto;padding:.6em 0}.task-list{padding-left:.4em;list-style:none}.task-list input{margin-right:.55em}.markdown-mermaid{padding:16px;border:1px solid var(--line);border-radius:10px;background:#fbfcf9}.markdown-mermaid figcaption{margin-bottom:10px;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.08em}.markdown-mermaid__source{display:none}
.katex .katex-mathml{position:static!important;width:auto!important;height:auto!important;overflow:visible!important;clip:auto!important;white-space:normal!important}.katex .katex-html{display:none!important}.katex-display{display:block;margin:1em 0;text-align:center}.katex-display math{display:block;margin:auto}.katex math{font-family:"Cambria Math","STIX Two Math",serif;font-size:1.08em}
.export-note{margin-top:48px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
@media(max-width:720px){body{padding:32px 22px;font-size:15px}}@media print{html{background:#fff}body{max-width:none;padding:0;box-shadow:none}.export-note{display:none}a{color:inherit}.code-frame,blockquote,.markdown-mermaid{break-inside:avoid}}
</style>
</head>
<body>
<article class="markdown-export">${body}</article>
<footer class="export-note">由 Knitspace 在本机导出 · 可直接使用浏览器打印或另存为 PDF</footer>
</body>
</html>`
}
