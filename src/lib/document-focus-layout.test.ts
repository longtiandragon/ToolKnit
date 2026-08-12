import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appView = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const documentsView = readFileSync(new URL('../views/DocumentsView.vue', import.meta.url), 'utf8')

describe('document focus layout contract', () => {
  it('promotes document focus into an application-level shell state', () => {
    expect(appView).toContain("'document-focus-mode': ui.documentFocusMode")
    expect(documentsView).toContain('ui.setDocumentFocusMode(active)')
    expect(documentsView).toContain('ui.setDocumentFocusMode(false)')
  })

  it('keeps the native titlebar but removes global navigation from the reading surface', () => {
    expect(documentsView).toContain(':global(.document-focus-mode .rail),:global(.document-focus-mode .topbar){display:none}')
    expect(documentsView).toContain(':global(.document-focus-mode .workspace){width:100%;height:100vh;margin-left:0;padding:0}')
    expect(documentsView).toContain(':global(.has-desktop-titlebar.document-focus-mode .workspace){height:calc(100vh - 34px)}')
  })

  it('lets Escape leave focus mode without changing or saving the document', () => {
    expect(documentsView).toContain("event.key === 'Escape'")
    expect(documentsView).toContain('focusMode.value = false')
  })
})
