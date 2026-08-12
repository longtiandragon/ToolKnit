import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const documents = readFileSync(new URL('../views/DocumentsView.vue', import.meta.url), 'utf8')
const conflictDialog = readFileSync(new URL('../components/ExternalMarkdownConflictDialog.vue', import.meta.url), 'utf8')
const native = readFileSync(new URL('./native.ts', import.meta.url), 'utf8')
const rust = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8')
const vault = readFileSync(new URL('../../src-tauri/src/vault.rs', import.meta.url), 'utf8')

describe('managed Vault Markdown change surface', () => {
  it('watches only managed Markdown and exposes one reconciliation command', () => {
    expect(rust).toContain('watch_default_vault_markdown')
    expect(rust).toContain('"knitspace://vault-markdown-change"')
    expect(rust).toContain('watch(&notes, RecursiveMode::NonRecursive)')
    expect(rust).toContain('watch(&questions, RecursiveMode::NonRecursive)')
    expect(native).toContain("invoke<DesktopVaultMarkdownReconcile>('reconcile_default_vault_markdown'")
    expect(native).toContain("invoke('watch_default_vault_markdown')")
  })

  it('reindexes FTS, wiki links and versions without rewriting the changed file', () => {
    const reconcileStart = vault.indexOf('pub fn reconcile_document_markdown')
    const reconcileEnd = vault.indexOf('pub fn save_vocabulary', reconcileStart)
    const reconcile = vault.slice(reconcileStart, reconcileEnd)
    expect(reconcile).toContain('Self::save_document_transaction')
    expect(reconcile).toContain('status: "missing"')
    expect(reconcile).not.toContain('write_document_content')
  })

  it('gives the active editor ownership and pauses autosave until an explicit decision', () => {
    expect(app).toContain('if(activeDocumentId.value===change.documentId)')
    expect(app).toContain("status:'pending'")
    expect(app.indexOf("window.addEventListener('knitspace:editor-dirty',handleDocumentDirty)")).toBeLessThan(app.indexOf('onMounted(async()=>'))
    expect(documents).toContain("autoSaveState.value = 'paused'")
    expect(documents).toContain('比较并处理')
    expect(documents).toContain('用当前版本重新创建')
    expect(documents).toContain('@contextmenu.prevent.stop="openManagedVaultMenu"')
    expect(documents).toContain('managed-vault')
    expect(documents).toContain("route.query.qa !== 'managed-vault-conflict'")
    expect(conflictDialog).toContain('资料库 Markdown 冲突')
  })

  it('checks the disk again and keeps a preserve-both recovery path', () => {
    expect(documents).toContain('fresh.content !== conflict.disk.content')
    expect(documents).toContain("decision === 'keep-both'")
    expect(documents).toContain('createIndependentDocumentCopy(conflict.current')
    expect(documents).toContain('store.writeManagedVaultMarkdown')
  })
})
