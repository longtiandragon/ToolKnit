/**
 * Rendering a multi-megabyte Markdown document produces a similarly large
 * HTML string and DOM tree. CodeMirror can still edit it efficiently, but the
 * reader should be an intentional action instead of a surprise frame drop.
 */
export const EXPLICIT_MARKDOWN_PREVIEW_THRESHOLD = 768 * 1024

export function needsExplicitMarkdownPreview(source: string) {
  return source.length > EXPLICIT_MARKDOWN_PREVIEW_THRESHOLD
}

export function deferredMarkdownPreviewMessage() {
  return '这篇 Markdown 很大。为了让输入、滚动和桌面右键菜单保持流畅，Knitspace 没有自动构建整篇预览。可在预览面板中按需加载完整版本。'
}
