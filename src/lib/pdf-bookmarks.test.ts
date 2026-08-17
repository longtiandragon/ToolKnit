import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { applyPdfBookmarkDocument, parsePdfBookmarkDocument } from './pdf-bookmarks'

describe('PDF bookmark editor', () => {
  it('bounds and normalizes an import document', () => {
    const parsed = parsePdfBookmarkDocument(JSON.stringify({
      version: 1,
      items: [{ title: '  第一章  ', page: '2', bold: true, items: [{ title: '链接', url: 'https://example.com' }] }],
    }), 2)
    expect(parsed.items[0]).toMatchObject({ title: '第一章', page: 2, bold: true })
    expect(parsed.items[0].items[0]).toMatchObject({ title: '链接', url: 'https://example.com' })
  })

  it('writes a replaceable outline tree with page destinations and styles', async () => {
    const document = await PDFDocument.create()
    document.addPage([300, 400])
    document.addPage([300, 400])
    applyPdfBookmarkDocument(document, JSON.stringify({
      items: [
        { title: '第一章', page: 1, bold: true, items: [{ title: '第二页', page: 2, italic: true }] },
        { title: '官网', url: 'https://example.com', color: '#123456' },
      ],
    }))

    const reloaded = await PDFDocument.load(await document.save())
    const root = reloaded.catalog.lookup(PDFName.of('Outlines'), PDFDict)
    const firstRef = root.get(PDFName.of('First')) as PDFRef
    const first = reloaded.context.lookup(firstRef, PDFDict)
    expect(first.lookup(PDFName.of('Title'), PDFString, PDFHexString).decodeText()).toBe('第一章')
    expect(first.lookup(PDFName.of('F'))?.toString()).toBe('2')
    const destination = first.lookup(PDFName.of('Dest'), PDFArray)
    expect((destination.get(0) as PDFRef).toString()).toBe(reloaded.getPages()[0].ref.toString())
    const child = reloaded.context.lookup(first.get(PDFName.of('First')) as PDFRef, PDFDict)
    expect(child.lookup(PDFName.of('Title'), PDFString, PDFHexString).decodeText()).toBe('第二页')
    const second = reloaded.context.lookup(first.get(PDFName.of('Next')) as PDFRef, PDFDict)
    expect(second.lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('URI'), PDFString).decodeText()).toBe('https://example.com')
  })

  it('rejects unsafe links and out-of-range pages', () => {
    expect(() => parsePdfBookmarkDocument(JSON.stringify({ items: [{ title: 'bad', url: 'javascript:alert(1)' }] }), 1)).toThrow('只允许')
    expect(() => parsePdfBookmarkDocument(JSON.stringify({ items: [{ title: 'bad', page: 2 }] }), 1)).toThrow('1 到 1')
  })
})
