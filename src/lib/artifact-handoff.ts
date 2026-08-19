import { newId } from '@/lib/id'
import { validateArtifactRef } from '@/lib/tool-platform'
import type { ArtifactKind, ArtifactRef } from '@/types'

const HANDOFF_TTL_MS = 15 * 60 * 1000
const HANDOFF_MAX_BATCHES = 6
const HANDOFF_MAX_FILES = 100
const HANDOFF_MAX_BYTES = 1024 * 1024 * 1024

export type ArtifactHandoffSource = 'smart-organizer' | 'file-pipeline'

export interface ArtifactHandoffTicket {
  id: string
  kind: 'files' | 'directory'
  itemCount: number
  expiresAt: number
}

export type ArtifactHandoffPayload =
  | {
      kind: 'files'
      source: ArtifactHandoffSource
      artifacts: ArtifactRef[]
      createdAt: number
      expiresAt: number
    }
  | {
      kind: 'directory'
      source: ArtifactHandoffSource
      name: string
      path: string
      createdAt: number
      expiresAt: number
    }

interface OrganizerHandoffOutput {
  name: string
  relativePath: string
  size?: number
  mime?: string
}

const handoffs = new Map<string, ArtifactHandoffPayload>()

function absoluteDesktopPath(value: string) {
  const path = value.trim()
  if (!path || path.length > 32 * 1024 || /[\u0000-\u001f]/.test(path)) throw new Error('交接路径无效。')
  if (!/^(?:[a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(path)) throw new Error('交接只接受本机绝对路径。')
  return path
}

function safeDisplayName(value: string) {
  const name = value.trim()
  if (!name || name.length > 512 || /[\\/\u0000-\u001f]/.test(name)) throw new Error('交接文件名无效。')
  return name
}

function artifactKind(name: string, mime = ''): ArtifactKind {
  const lower = name.toLocaleLowerCase('en-US')
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf'
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return 'media'
  if (/\.(zip|7z|rar|tar|tgz|gz)$/.test(lower)) return 'archive'
  return 'files'
}

function organizerOutputPath(archiveRoot: string, relativePath: string) {
  const root = absoluteDesktopPath(archiveRoot).replace(/[\\/]+$/, '')
  const relative = relativePath.trim().replace(/\//g, '\\')
  const parts = relative.split('\\')
  if (!relative || relative.length > 32 * 1024 || /^[\\/]|^[a-zA-Z]:/.test(relative)
    || parts.some(part => !part || part === '.' || part === '..' || /[\u0000-\u001f]/.test(part))) {
    throw new Error('整理结果包含无效相对路径，无法交接。')
  }
  return `${root}\\${relative}`
}

function cloneArtifact(artifact: ArtifactRef): ArtifactRef {
  return {
    ...artifact,
    ...(artifact.locator ? { locator: { ...artifact.locator } } : {}),
    ...(artifact.metadata ? { metadata: { ...artifact.metadata } } : {}),
  }
}

function clonePayload(payload: ArtifactHandoffPayload): ArtifactHandoffPayload {
  return payload.kind === 'files'
    ? { ...payload, artifacts: payload.artifacts.map(cloneArtifact) }
    : { ...payload }
}

function pruneHandoffs(now: number) {
  for (const [id, payload] of handoffs) {
    if (payload.expiresAt <= now) handoffs.delete(id)
  }
  while (handoffs.size >= HANDOFF_MAX_BATCHES) handoffs.delete(handoffs.keys().next().value as string)
}

function storePayload(payload: ArtifactHandoffPayload, itemCount: number, now: number): ArtifactHandoffTicket {
  pruneHandoffs(now)
  const id = newId()
  handoffs.set(id, clonePayload(payload))
  return { id, kind: payload.kind, itemCount, expiresAt: payload.expiresAt }
}

/** Creates a short-lived, renderer-memory-only handoff. The returned ticket
 * contains no path and is safe to put in a route query or button state. */
export function createOrganizerArtifactHandoff(
  archiveRoot: string,
  outputs: readonly OrganizerHandoffOutput[],
  now = Date.now(),
) {
  if (!outputs.length || outputs.length > HANDOFF_MAX_FILES) throw new Error(`一次最多交接 ${HANDOFF_MAX_FILES} 个整理结果。`)
  const totalBytes = outputs.reduce((sum, output) => sum + (output.size ?? 0), 0)
  if (totalBytes > HANDOFF_MAX_BYTES) throw new Error('交接结果超过 1 GB，请分批加入文件流水线。')
  const artifacts = outputs.map(output => {
    const name = safeDisplayName(output.name)
    return validateArtifactRef({
      id: newId(),
      kind: artifactKind(name, output.mime),
      name,
      ...(output.size !== undefined ? { size: output.size } : {}),
      ...(output.mime ? { mime: output.mime } : {}),
      locator: { kind: 'desktop-path', value: organizerOutputPath(archiveRoot, output.relativePath) },
      metadata: { origin: 'smart-organizer' },
    })
  })
  return storePayload({
    kind: 'files', source: 'smart-organizer', artifacts,
    createdAt: now, expiresAt: now + HANDOFF_TTL_MS,
  }, artifacts.length, now)
}

export function createDirectoryArtifactHandoff(path: string, name: string, now = Date.now()) {
  const payload: ArtifactHandoffPayload = {
    kind: 'directory', source: 'file-pipeline',
    path: absoluteDesktopPath(path), name: safeDisplayName(name),
    createdAt: now, expiresAt: now + HANDOFF_TTL_MS,
  }
  return storePayload(payload, 1, now)
}

/** Handoffs are deliberately single-use. Reloading the page or opening a
 * history item never recreates access to an old absolute path. */
export function consumeArtifactHandoff(id: string, now = Date.now()) {
  if (!id || id.length > 160 || /[\u0000-\u001f]/.test(id)) return undefined
  pruneHandoffs(now)
  const payload = handoffs.get(id)
  if (!payload) return undefined
  handoffs.delete(id)
  return clonePayload(payload)
}
