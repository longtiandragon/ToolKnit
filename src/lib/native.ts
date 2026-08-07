import { invoke } from '@tauri-apps/api/core'

export function isDesktop() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function storeApiKey(id: string, apiKey: string) {
  if (!isDesktop()) return false
  await invoke('write_api_key', { profile: { id, api_key: apiKey } })
  return true
}

export async function runDesktopAi(request: { profile_id: string; base_url: string; model: string; messages: unknown }) {
  return invoke<string>('run_ai_action', { request })
}
