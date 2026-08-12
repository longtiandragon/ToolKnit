import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const settings = readFileSync(new URL('../views/SettingsView.vue', import.meta.url), 'utf8')
const studio = readFileSync(new URL('../views/AiStudioView.vue', import.meta.url), 'utf8')
const assist = readFileSync(new URL('../components/AiAssistPanel.vue', import.meta.url), 'utf8')
const native = readFileSync(new URL('./native.ts', import.meta.url), 'utf8')
const rustCommands = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8')
const vault = readFileSync(new URL('../../src-tauri/src/vault.rs', import.meta.url), 'utf8')
const cargo = readFileSync(new URL('../../src-tauri/Cargo.toml', import.meta.url), 'utf8')

describe('AI desktop connection and cancellation surface', () => {
  it('exposes connection testing without exposing the credential', () => {
    expect(settings).toContain('testAiConnection')
    expect(settings).toContain('测试连接')
    expect(settings).toContain('复制连接诊断')
    expect(settings).toContain('内容不包含 API Key')
    expect(settings).toContain('@contextmenu="openAiProfileMenu($event, profile)"')
    expect(settings).toContain('@keydown="openAiProfileMenu($event, profile)"')
  })

  it('cancels both the workbench and in-editor request through the native task', () => {
    expect(studio).toContain("activeRunController.abort()")
    expect(studio).toContain("'AI_REQUEST_CANCELLED'")
    expect(studio).toContain('停止等待')
    expect(assist).toContain('activeController?.abort()')
    expect(native).toContain("invoke('cancel_ai_action', { requestId })")
    expect(rustCommands).toContain('static ACTIVE_AI_REQUESTS')
    expect(rustCommands).toContain('fn cancel_ai_action(request_id: String)')
  })

  it('bounds a stalled native provider request', () => {
    expect(vault).toContain('.timeout(Duration::from_secs(120))')
  })

  it('uses the persistent Windows credential backend and verifies stored keys', () => {
    expect(cargo).toContain('features = ["windows-native"]')
    expect(vault).toContain('entry.get_password()? != profile.api_key')
    expect(vault).toContain('pub fn has_api_key')
    expect(settings).toContain('hasStoredApiKey(profile.id)')
    expect(settings).toContain('系统凭据已丢失')
  })
})
