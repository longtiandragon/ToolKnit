import type { ClipboardItem } from '@/types'

export interface ClipboardNoteDraft {
  title: string
  content: string
}

function shorten(value: string, limit: number) {
  const characters = Array.from(value.trim())
  return characters.length > limit ? `${characters.slice(0, limit).join('')}…` : characters.join('')
}

function textTitle(content: string) {
  const firstLine = content
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim()
    .replace(/^#{1,6}\s+/, '')
    .trim()

  return shorten(firstLine || '来自剪贴板的笔记', 42)
}

function codeTitle(content: string) {
  const comment = content
    .split(/\r?\n/)
    .map((line) => {
      const match = line.trim().match(/^(?:\/\/|\/\*+|\*+|#)\s*(.+?)(?:\s*\*\/)?$/)
      const value = match?.[1]?.trim() ?? ''
      return /^(?:include|define|pragma|if|ifdef|ifndef|endif)\b/.test(value) ? '' : value
    })
    .find((line) => line.length > 2)

  return shorten(comment || '来自剪贴板的代码', 42)
}

function codeFence(content: string) {
  const longest = [...content.matchAll(/`+/g)].reduce((length, match) => Math.max(length, match[0].length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}

/** Converts only explicit text/code captures into an ordinary Markdown note.
 * Images stay assets: turning an image into a fake text note would hide the
 * better annotation and library workflows available elsewhere. */
export function clipboardItemToMarkdownNote(item: ClipboardItem): ClipboardNoteDraft | undefined {
  if (item.kind === 'image') return undefined
  const captured = item.content?.trim()
  if (!captured) return undefined

  const title = item.kind === 'code' ? codeTitle(captured) : textTitle(captured)
  const fence = item.kind === 'code' ? codeFence(captured) : ''
  const body = item.kind === 'code'
    ? `${fence}\n${captured}\n${fence}`
    : captured

  return { title, content: `# ${title}\n\n${body}\n` }
}
