import { describe, expect, it } from 'vitest'
import { markdownImageAltText, markdownImageDropIntent, markdownImageImportSelection, markdownImportedImageMarkup, markdownPreviewImageFilename, markdownPreviewImageMarkup } from './markdown-image-import'

describe('Markdown image import handoff', () => {
  it('keeps supported unique files and bounds one insert action', () => {
    const selected = markdownImageImportSelection([
      'F:\\Shots\\graph.png',
      'f:\\shots\\GRAPH.PNG',
      'F:\\Shots\\notes.txt',
      'F:\\Shots\\photo.webp',
      'F:\\Shots\\diagram.avif',
    ], 2)
    expect(selected.paths).toEqual(['F:\\Shots\\graph.png', 'F:\\Shots\\photo.webp'])
    expect(selected.unsupported).toBe(1)
    expect(selected.truncated).toBe(1)
  })

  it('creates safe readable alt text without exposing a full local path', () => {
    expect(markdownImageAltText('F:\\课程截图\\Dijkstra[松弛].png')).toBe('Dijkstra 松弛')
    expect(markdownImportedImageMarkup('../assets/documents/1/import-a.png', 'F:\\课程截图\\Dijkstra.png')).toBe(
      '![Dijkstra](../assets/documents/1/import-a.png)',
    )
  })

  it('activates a file drop only for supported images inside the source editor', () => {
    const bounds = { left: 100, top: 80, right: 700, bottom: 620 }
    expect(markdownImageDropIntent(['F:\\Shots\\graph.png'], { x: 240, y: 180 }, bounds).active).toBe(true)
    expect(markdownImageDropIntent(['F:\\Shots\\graph.png'], { x: 740, y: 180 }, bounds).active).toBe(false)
    expect(markdownImageDropIntent(['F:\\Shots\\notes.txt'], { x: 240, y: 180 }, bounds).active).toBe(false)
  })

  it('copies a safe Markdown reference and derives a portable editor filename', () => {
    expect(markdownPreviewImageMarkup('assets/流程图(最终).png', '流程[图]')).toBe('![流程 图](assets/流程图\\(最终\\).png)')
    expect(markdownPreviewImageFilename('assets/%E6%B5%81%E7%A8%8B%E5%9B%BE.png?raw=1', 'ignored', 'image/png')).toBe('流程图.png')
    expect(markdownPreviewImageFilename('data:image/png;base64,abc', '算法流程', 'image/jpeg')).toBe('算法流程.jpg')
  })
})
