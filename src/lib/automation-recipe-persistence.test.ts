import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const store = readFileSync(new URL('../stores/workbench.ts', import.meta.url), 'utf8')
const service = readFileSync(new URL('./automation-recipes.ts', import.meta.url), 'utf8')
const persistence = readFileSync(new URL('./workspace-persistence.ts', import.meta.url), 'utf8')
const vault = readFileSync(new URL('../../src-tauri/src/vault.rs', import.meta.url), 'utf8')
const commands = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8')
const center = readFileSync(new URL('../views/AutomationCenterView.vue', import.meta.url), 'utf8')

describe('desktop automation recipe ownership', () => {
  it('hydrates the portable ledger before removing the browser recovery copy', () => {
    const start = store.indexOf('async function hydrateVault()')
    const end = store.indexOf('async function searchDocuments', start)
    const hydration = store.slice(start, end)
    expect(hydration.indexOf('hydrateAutomationRecipes')).toBeLessThan(hydration.indexOf('desktopVaultActive.value = true'))
    expect(persistence).toContain('recipes: desktopAutomationActive ? []')
    expect(persistence).toContain('pipelineRecipes: desktopAutomationActive ? []')
    expect(store).toContain('prepareWorkspaceRestore(serialized, desktopVaultActive.value)')
  })

  it('uses one generic SQLite registry and rejects machine-bound definitions', () => {
    expect(vault).toContain('CREATE TABLE IF NOT EXISTS automation_recipes')
    expect(vault).toContain('browser-automation-recipes-migration-v1')
    expect(vault).toContain('processing_parameter_key_contains_path')
    expect(vault).toContain('processing_text_contains_absolute_path')
    expect(commands).toContain('hydrate_default_automation_recipes')
    expect(commands).toContain('replace_default_automation_recipes')
    expect(service).toContain("invoke<AutomationRecipeRecord>('save_default_automation_recipe'")
  })

  it('keeps execution manual and makes local bindings explicit in the center', () => {
    expect(center).toContain('所有运行都从只读预览开始')
    expect(center).toContain('没有后台执行')
    expect(center).toContain('打开手动预览')
    expect(center).toContain('bindDesktopOrganizerRule')
    expect(center).not.toContain('scanDesktopSmartOrganizer')
    expect(center).not.toContain('executeDesktopSmartOrganizer')
  })
})
