import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from '@/lib/native'

/**
 * Formats, rate-limits and forwards a renderer error to the desktop crash log.
 *
 * Loaded on demand by `crash-report`, so none of this is in the startup bundle.
 * `src-tauri/src/crash_log.rs` owns the file, its size cap and the redaction — a
 * stack trace is mostly `file:///C:/Users/...` frames and none of that may reach
 * a log.
 *
 * The browser preview has nowhere to write, so it reports nothing rather than
 * throwing inside an error handler.
 */

/** A render loop that throws can fire thousands of times a second; a session
 *  that has already reported this many has told us everything useful. */
const MAX_REPORTS_PER_SESSION = 20

/** Two of the same error inside this window are one error. */
const DEDUPE_WINDOW_MS = 2000

/** Long enough to hold a message and the top of a stack, short enough that the
 *  Rust side's own entry cap is never the thing that truncates. */
const MAX_DETAIL_LENGTH = 2000

export interface CrashReportState {
  sent: number
  lastKey: string
  lastAt: number
}

export function createCrashReportState(): CrashReportState {
  return { sent: 0, lastKey: '', lastAt: 0 }
}

/** Turns whatever was thrown into one line worth keeping. */
export function formatCrashDetail(error: unknown, fallback = 'unknown error'): string {
  if (error instanceof Error) {
    // The stack already starts with `name: message` in every engine we target.
    const detail = error.stack?.trim() || `${error.name}: ${error.message}`
    return detail.slice(0, MAX_DETAIL_LENGTH)
  }
  if (typeof error === 'string') return error.slice(0, MAX_DETAIL_LENGTH) || fallback
  try {
    return JSON.stringify(error).slice(0, MAX_DETAIL_LENGTH) || fallback
  } catch {
    // A circular or exotic value is not worth a second failure here.
    return fallback
  }
}

/**
 * Whether this report should be sent, and the state to carry forward.
 *
 * Pure so the limiting can be tested without a window, a clock or a backend.
 */
export function shouldReport(state: CrashReportState, detail: string, now: number): boolean {
  if (state.sent >= MAX_REPORTS_PER_SESSION) return false
  // Compare a prefix: two runs of the same error differ only deep in the stack.
  const key = detail.slice(0, 200)
  if (key === state.lastKey && now - state.lastAt < DEDUPE_WINDOW_MS) return false
  state.lastKey = key
  state.lastAt = now
  state.sent += 1
  return true
}

const state = createCrashReportState()

export async function report(kind: string, error: unknown) {
  if (!isDesktop()) return
  const detail = formatCrashDetail(error, kind === 'rejection' ? 'unhandled rejection' : undefined)
  if (!shouldReport(state, detail, Date.now())) return
  try {
    await invoke('record_frontend_error', { kind, detail })
  } catch {
    // Reporting a failure must never itself throw — that is how an error
    // handler turns one broken panel into an unusable window.
  }
}

/** The redacted log, for showing the user something they can attach. */
export const crashLog = {
  read: () => invoke<string>('read_crash_log'),
  clear: () => invoke<void>('clear_crash_log'),
}
