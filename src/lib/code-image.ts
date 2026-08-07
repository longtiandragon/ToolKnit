export interface CodeImageOptions {
  language: string
  theme: 'forest' | 'paper'
  fontSize: number
  padding: number
  showLineNumbers: boolean
  watermark: string
}

export function splitCodeForExport(code: string, maxLines = 120) {
  const lines = code.split('\n')
  const pages: string[] = []
  for (let i = 0; i < lines.length; i += maxLines) pages.push(lines.slice(i, i + maxLines).join('\n'))
  return pages.length ? pages : ['']
}

export function downloadText(name: string, content: string, type = 'text/plain') {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([content], { type }))
  link.download = name
  link.click()
  URL.revokeObjectURL(link.href)
}
