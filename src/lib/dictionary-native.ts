import { invoke } from '@tauri-apps/api/core'
import { isDesktop, listenDesktopEvent } from '@/lib/native'
import type { DictionaryRecord } from '@/lib/dictionary-entry'

export interface DictionaryStatus {
  installed: boolean
  path: string
  version: string
  entryCount: number
  sizeBytes: number
  downloadBytes: number
}

export interface DictionaryProgress {
  runId: string
  progress: number
  detail: string
}

export const DICTIONARY_PROGRESS_EVENT = 'toolknit://dictionary-progress'

const UNINSTALLED: DictionaryStatus = { installed: false, path: '', version: '', entryCount: 0, sizeBytes: 0, downloadBytes: 0 }

/** The browser build has no dictionary at all, and saying so is better than
 * leaving the caller to guess from an empty result. */
export async function readDictionaryStatus(): Promise<DictionaryStatus> {
  if (!isDesktop()) return UNINSTALLED
  return invoke<DictionaryStatus>('dictionary_status')
}

export async function installDictionary(runId: string) {
  if (!isDesktop()) throw new Error('词库仅在桌面版可用。')
  return invoke<DictionaryStatus>('install_dictionary', { runId })
}

export async function cancelDictionaryInstall(runId: string) {
  if (!isDesktop()) return
  await invoke('cancel_dictionary_install', { runId })
}

export async function removeDictionary() {
  if (!isDesktop()) throw new Error('词库仅在桌面版可用。')
  return invoke<DictionaryStatus>('remove_dictionary')
}

/** Looks a batch up in one call. The desktop side answers from one open
 * connection, so a list of words costs one round trip, not one per word. */
export async function lookupDictionaryWords(words: string[]): Promise<DictionaryRecord[]> {
  if (!isDesktop() || !words.length) return []
  return invoke<DictionaryRecord[]>('lookup_dictionary_words', { words })
}

/** Words close to one the dictionary does not have. Nothing is ever corrected
 * automatically — the reader picks, or keeps what they typed. */
export async function suggestDictionaryWords(word: string, limit = 5): Promise<string[]> {
  if (!isDesktop() || !word.trim()) return []
  return invoke<string[]>('suggest_dictionary_words', { word, limit })
}

export async function listenDictionaryProgress(handler: (progress: DictionaryProgress) => void) {
  return listenDesktopEvent<DictionaryProgress>(DICTIONARY_PROGRESS_EVENT, handler)
}
