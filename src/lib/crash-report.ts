/**
 * Registers the two global error handlers, and nothing else.
 *
 * An uncaught exception and a rejected promise were both entirely invisible:
 * nothing listened for either, so a broken render or a failed `invoke` left the
 * user with a blank panel and no way to say what happened.
 *
 * This file runs on every launch, so it is deliberately almost empty — the
 * startup bundle is within a kilobyte of its budget and a diagnostic that never
 * fires must not cost the ordinary path anything. Formatting, rate limiting and
 * the `invoke` all live in `crash-report-sink`, which is fetched only once
 * something has actually gone wrong. The trade is that a failure severe enough
 * to break dynamic import goes unreported; a failure that severe would not have
 * reached a working `invoke` either.
 */
let installed = false

function send(kind: string, value: unknown) {
  void import('@/lib/crash-report-sink').then((sink) => sink.report(kind, value)).catch(() => {})
}

export function installCrashReporting() {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (event) => {
    // `error` also fires for a failed <img> or <script> load, which carries no
    // error object and is not a crash.
    if (!event.error && !event.message) return
    send('renderer', event.error ?? event.message)
  })

  window.addEventListener('unhandledrejection', (event) => send('rejection', event.reason))
}
