import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const unoConfig = readFileSync(new URL('../../uno.config.ts', import.meta.url), 'utf8')

describe('utility borders are actually painted', () => {
  /*
   * `border-b` and its siblings emit only `border-bottom-width`. The style
   * comes from the framework reset, which this project turns off because the
   * legacy sheets still own base element styling. Without the style, a width
   * paints nothing: every single-side separator in the app was invisible for a
   * whole rewrite, and it was impossible to see because the rules still on
   * screen were legacy declarations being deleted one at a time.
   *
   * This cannot be detected from a rendered page — CSS computes `border-width`
   * to 0 whenever `border-style` is `none`, so a missing style and a
   * deliberate zero are indistinguishable at runtime. The invariant has to be
   * pinned at its source instead.
   */
  it('keeps the border half of the reset even though the reset is off', () => {
    expect(unoConfig).toMatch(/preflights:\s*\[/)
    expect(unoConfig).toMatch(/\*,\s*::before,\s*::after\s*\{[^}]*border-style:\s*solid/)
    expect(unoConfig).toMatch(/\*,\s*::before,\s*::after\s*\{[^}]*border-width:\s*0/)
    expect(unoConfig).toMatch(/preflights:\s*\{\s*reset:\s*false\s*\}/)
  })
})
