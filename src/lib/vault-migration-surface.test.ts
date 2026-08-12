import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const store = readFileSync(new URL('../stores/workbench.ts', import.meta.url), 'utf8')
const vault = readFileSync(new URL('../../src-tauri/src/vault.rs', import.meta.url), 'utf8')

function rustFunction(name: string, nextName: string) {
  const start = vault.indexOf(`pub fn ${name}`)
  const end = vault.indexOf(`pub fn ${nextName}`, start + 1)
  return vault.slice(start, end)
}

describe('resumable browser to SQLite migration contract', () => {
  it('uses completion markers instead of non-empty table counts', () => {
    const clipboard = rustFunction('hydrate_clipboard_items', 'save_source')
    const favorites = rustFunction('hydrate_content_favorites', 'set_content_favorite')
    const recents = rustFunction('hydrate_content_recents', 'hydrate_documents')
    const documents = rustFunction('hydrate_documents', 'write_api_key')

    for (const migration of [clipboard, favorites, recents, documents]) {
      expect(migration).not.toMatch(/count\s*==\s*0/)
    }
    expect(documents).toContain('existing_entity_ids.insert(document.id.clone())')
    expect(documents).toContain('migrate_missing_vocabulary')
    expect(documents).toContain('self.save_relation(relation)?')
    expect(documents).not.toContain('replace_vocabulary(browser_vocabulary)')
    expect(documents).not.toContain('replace_relations(browser_relations)')
  })

  it('does not duplicate the full legacy workspace before native hydration', () => {
    const start = store.indexOf('async function hydrateVault()')
    const end = store.indexOf('async function searchDocuments', start)
    const hydration = store.slice(start, end)
    expect(hydration).not.toContain('JSON.stringify({ savedAt: now(), documents: browserDocuments })')
    expect(hydration).not.toContain('JSON.stringify({ savedAt: now(), vocabulary: browserVocabulary })')
    expect(hydration).not.toContain('JSON.stringify({ savedAt: now(), relations: browserRelations })')
    const activation = hydration.indexOf('desktopVaultActive.value = true')
    expect(activation).toBeLessThan(hydration.indexOf('\n      persist()', activation))
    expect(hydration).toContain('if (vaultHydrating.value) return')
  })

  it('exposes progress and an announced recovery path with mouse and keyboard menus', () => {
    expect(app).toContain('vaultBootstrapStages')
    expect(app).toContain('role="progressbar"')
    expect(app).toContain('class="vault-notice" role="alert"')
    expect(app).toContain('@contextmenu="openVaultNoticeContext"')
    expect(app).toContain('@keydown="openVaultNoticeContextFromKeyboard"')
    expect(app).toContain('重试连接')
    expect(app).toContain('打开数据与备份')
    expect(app).toContain('复制错误详情')
  })
})
