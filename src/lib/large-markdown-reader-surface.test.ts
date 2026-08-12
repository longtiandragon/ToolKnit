import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const component = readFileSync(new URL('../components/MarkdownContent.vue', import.meta.url), 'utf8')
const worker = readFileSync(new URL('../workers/markdown-preview.worker.ts', import.meta.url), 'utf8')
const documents = readFileSync(new URL('../views/DocumentsView.vue', import.meta.url), 'utf8')

describe('large Markdown reader surface', () => {
  it('requests safe Worker sections and mounts them in cancellable animation-frame batches', () => {
    expect(worker).toContain('renderMarkdownBlocksCached')
    expect(worker).toContain('htmlBlocks')
    expect(component).toContain('nextMarkdownPreviewBatch')
    expect(component).toContain('window.requestAnimationFrame(appendNextBatch)')
    expect(component).toContain('cancelProgressiveRender()')
  })

  it('exposes progress, cancellation and a keyboard-accessible desktop menu', () => {
    expect(documents).toContain('@render-progress="handlePreviewRenderProgress"')
    expect(documents).toContain('正在铺开阅读内容')
    expect(documents).toContain('停止加载')
    expect(documents).toContain('Shift+F10 打开大文档阅读菜单')
    expect(documents).toContain('role="menu" aria-label="大文档阅读操作"')
  })
})
