/**
 * Theme selection.
 *
 * Three states, not two: `system` follows the OS and is the default, while
 * `dark` and `light` are explicit user overrides that survive restarts. The
 * resolved value is written to `data-theme` on the document element, which is
 * what `src/styles/theme.css` keys off.
 */
export type ThemePreference = 'system' | 'dark' | 'light'
export type ResolvedTheme = 'dark' | 'light'

const STORAGE_KEY = 'knitspace:theme'

/** Dark-first by design: this window sits open all day beside an editor. */
const DEFAULT_PREFERENCE: ThemePreference = 'dark'

const darkQuery = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)')
    : undefined

/** The product is dark-first, so anything other than an explicit light signal resolves dark. */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'dark' || preference === 'light') return preference
  return darkQuery()?.matches ? 'light' : 'dark'
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  } catch {
    // Private mode or a locked-down profile: fall through to the default.
  }
  return DEFAULT_PREFERENCE
}

export function applyTheme(preference: ThemePreference) {
  const resolved = resolveTheme(preference)
  document.documentElement.dataset.theme = resolved
  try {
    localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Persistence is a convenience; the theme still applies for this session.
  }
  return resolved
}

/**
 * Applied before mount so the first paint is already in the right theme.
 * Also keeps `system` live: changing the OS theme updates the window without
 * a restart, but only while the user has not chosen an explicit override.
 */
export function applyStoredTheme() {
  const preference = readThemePreference()
  applyTheme(preference)

  darkQuery()?.addEventListener('change', () => {
    if (readThemePreference() === 'system') applyTheme('system')
  })
}
