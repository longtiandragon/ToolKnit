import { invoke } from '@tauri-apps/api/core'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { ClipboardItem as WorkbenchClipboardItem } from '@/types'

export function isDesktop() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function storeApiKey(id: string, apiKey: string) {
  if (!isDesktop()) return false
  await invoke('write_api_key', { profile: { id, api_key: apiKey } })
  return true
}

export async function removeApiKey(id: string) {
  if (!isDesktop()) return false
  await invoke('delete_api_key', { profileId: id })
  return true
}

export async function runDesktopAi(request: { profile_id: string; base_url: string; model: string; messages: unknown }) {
  return invoke<string>('run_ai_action', { request })
}

export async function saveDesktopOutput(outputDirectory: string, filename: string, data: Blob | ArrayBuffer | Uint8Array | string) {
  if (!isDesktop()) return undefined
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data instanceof ArrayBuffer ? new Uint8Array(data) : data
  return invoke<string>('save_output', { outputDir: outputDirectory, filename, data: Array.from(bytes) })
}

export async function desktopFileExists(path: string) { return isDesktop() ? invoke<boolean>('file_exists', { path }) : false }
interface InputFilePayload { name:string; path:string; mime:string; size:number; data:number[] }
export async function readDesktopInputFile(path:string) {
  const payload = await invoke<InputFilePayload>('read_input_file',{path})
  const file = new File([new Uint8Array(payload.data)],payload.name,{type:payload.mime})
  Object.defineProperty(file,'path',{value:payload.path,enumerable:true})
  return file
}
export async function listenWindowFileDrops(handler:(paths:string[])=>void) {
  if(!isDesktop()) return () => undefined
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().onDragDropEvent(event=>{ if(event.payload.type==='drop') handler(event.payload.paths) })
}
export async function revealDesktopFile(path: string) { if (isDesktop()) await invoke('reveal_in_folder', { path }) }
export async function saveOutputAs(source:string,name:string) { if(!isDesktop())return;const {save}=await import('@tauri-apps/plugin-dialog');const destination=await save({title:'另存 ToolKnit 输出',defaultPath:name});if(!destination)return;return invoke<string>('copy_output_file',{source,destination}) }
export async function getDirectorySize(path: string) { return isDesktop() && path ? invoke<number>('directory_size', { path }) : 0 }
export async function setClipboardMonitor(enabled: boolean, paused: boolean) { if (isDesktop()) await invoke('set_clipboard_monitor', { enabled, paused }) }
export async function copyClipboardItem(item: WorkbenchClipboardItem) {
  if (isDesktop()) return invoke('copy_clipboard', { kind: item.kind, content: item.content, assetPath: item.assetPath })
  if (item.content) return navigator.clipboard.writeText(item.content)
  throw new Error('浏览器模式无法重新复制本地图片资源。')
}
export async function copyPngToClipboard(blob: Blob) {
  if (isDesktop()) {
    await invoke('copy_png_bytes', { data: Array.from(new Uint8Array(await blob.arrayBuffer())) })
    return
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('当前浏览器不支持复制图片。')
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}
export async function copyPngFilesToClipboard(files: Array<{ name: string; blob: Blob }>) {
  if (!isDesktop()) throw new Error('多张独立图片复制仅支持桌面开发模式，请使用“合并长图”或导出。')
  return invoke<string[]>('copy_png_files', {
    files: await Promise.all(files.map(async ({ name, blob }) => ({
      name,
      data: Array.from(new Uint8Array(await blob.arrayBuffer()))
    })))
  })
}
export async function cleanupClipboardAssets(activePaths:string[]) { if(isDesktop()) await invoke('cleanup_clipboard_assets',{activePaths}) }
export function localAssetUrl(path?: string) { return path && isDesktop() ? convertFileSrc(path) : path ?? '' }

export async function listenDesktopEvent<T>(event: string, handler: (payload: T) => void) {
  if (!isDesktop()) return () => undefined
  const { listen } = await import('@tauri-apps/api/event')
  return listen<T>(event, ({ payload }) => handler(payload))
}

export async function hideMainWindow() { if (isDesktop()) { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().hide() } }
export async function quitDesktopApp() { if (isDesktop()) await invoke('quit_app') }

export interface GitHubRelease { tag_name: string; html_url: string; published_at?: string; name?: string; body?: string }
export async function checkDesktopUpdate() { return isDesktop() ? invoke<GitHubRelease>('check_github_update') : undefined }
export async function openExternalUrl(url:string) { if(isDesktop()){const {open}=await import('@tauri-apps/plugin-shell');await open(url)}else window.open(url,'_blank','noopener,noreferrer') }

export async function sendSystemNotification(title: string, body: string) {
  if (!isDesktop()) return false
  const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification')
  let granted = await isPermissionGranted()
  if (!granted) granted = await requestPermission() === 'granted'
  if (granted) sendNotification({ title, body })
  return granted
}
