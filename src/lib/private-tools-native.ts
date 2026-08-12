import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from '@/lib/native'

export type PrivateToolRisk = 'readOnly' | 'changesFiles'

export interface PrivateToolOption { label: string; value: string }

export interface PrivateToolField {
  key: string
  label: string
  kind: 'text' | 'integer' | 'file' | 'directory' | 'select'
  placeholder: string
  help: string
  required: boolean
  defaultValue: string
  options: PrivateToolOption[]
  min?: number
  max?: number
}

export interface PrivateToolOperation {
  id: string
  title: string
  description: string
  risk: PrivateToolRisk
  confirmationText: string
  fields: PrivateToolField[]
}

export interface PrivateToolDefinition {
  id: string
  title: string
  description: string
  icon: string
  operations: PrivateToolOperation[]
}

export interface PrivateToolsCatalog { version: number; tools: PrivateToolDefinition[] }

export interface PrivateToolRunResult {
  exitCode: number
  stdout: string
  stderr: string
  payload?: Record<string, unknown>
  elapsedMs: number
  logTruncated: boolean
}

/** Personal Pack desktop bridge. This module is not reachable from the
 * Public Core module graph and therefore does not enter its renderer bundle. */
export async function loadPrivateTools(manifestPath: string) {
  if (!isDesktop()) throw new Error('私人工具包仅支持桌面模式。')
  return invoke<PrivateToolsCatalog>('load_private_tools', { manifestPath })
}

export async function runPrivateTool(request: {
  manifestPath: string
  toolId: string
  operationId: string
  input: Record<string, string>
  runId: string
  mode: 'preview' | 'apply'
  confirmed: boolean
}) {
  if (!isDesktop()) throw new Error('私人工具包仅支持桌面模式。')
  return invoke<PrivateToolRunResult>('run_private_tool', request)
}

export async function cancelPrivateToolRun(runId: string) {
  if (!isDesktop()) return
  return invoke<void>('cancel_private_tool_run', { runId })
}
