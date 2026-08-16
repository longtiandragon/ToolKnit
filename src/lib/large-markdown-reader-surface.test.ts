import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const component = readFileSync(new URL('../components/MarkdownContent.vue', import.meta.url), 'utf8')
const worker = readFileSync(new URL('../workers/markdown-preview.worker.ts', import.meta.url), 'utf8')
const documents = readFileSync(new URL('../views/DocumentsView.vue', import.meta.url), 'utf8')

describe('large Markdown reader surface', () => {
  it('requests safe Worker sections and mounts them in cancellable animation-frame batches', () => {
    expect(worker).toContain('renderMarkdownBlockRecordsCached')
    expect(worker).toContain('htmlBlocks')
    expect(worker).toContain('blockKeys')
    expect(component).toContain('nextMarkdownPreviewBatchRange')
    expect(component).toContain('window.requestAnimationFrame(appendNextBatch)')
    expect(component).toContain('cancelProgressiveRender()')
    expect(component).toContain('planMarkdownPreviewReconciliation')
    expect(component).toContain('progressiveBlockRanges')
    expect(component).toContain('progressiveRenderedBlockKeys')
    expect(documents).toContain('Once requested, keep it live with a longer settle delay')
  })

  it('exposes progress, cancellation and a keyboard-accessible desktop menu', () => {
    expect(documents).toContain('@render-progress="handlePreviewRenderProgress"')
    expect(documents).toContain('正在铺开阅读内容')
    expect(documents).toContain('停止加载')
    expect(documents).toContain('Shift+F10 打开大文档阅读菜单')
    // Attribute order is formatting, not contract: the menu has to exist
    // with that accessible name, not to write its attributes in one order.
    expect(documents).toMatch(/aria-label="大文档阅读操作"/)
    expect(documents).toMatch(/ref="largePreviewMenuElement"[\s\S]{0,400}?role="menu"/)
  })
})
