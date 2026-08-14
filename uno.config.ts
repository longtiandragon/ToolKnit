import { defineConfig, presetWind4, transformerDirectives } from 'unocss'

/**
 * The design system is expressed here rather than in stylesheets.
 *
 * Colours resolve to the CSS variables declared in `src/styles/theme.css`, so
 * `bg-surface` and `text-fg-2` mean the right thing in both themes without any
 * `dark:` variants in the markup. Shortcuts carry the component-level
 * decisions — a button's height, a panel's radius — so those stay consistent
 * across 23 views without being retyped.
 */
export default defineConfig({
  presets: [presetWind4({ preflights: { reset: false } })],
  // No variant-group transformer: its `prefix:(…)` syntax collides with
  // ordinary TypeScript in Vue templates. `updateSettings({ mode: ($event
  // .target as HTMLSelectElement).value })` parses as a variant group and gets
  // rewritten, which breaks the SFC. Groups are written out in full instead.
  transformers: [transformerDirectives()],

  // presetWind4's reset is off — the six legacy sheets still own base element
  // styling and a second reset on top of them changed more than it fixed. But
  // the reset is also where Tailwind-style borders get their *style*: `border-b`
  // emits only `border-bottom-width: 1px`, and a width with no style paints
  // nothing. Every `border-b` / `border-t` / `border-l` / `border-r` in the
  // rewritten views was therefore invisible, and the rules you could see were
  // legacy declarations that have since been deleted.
  //
  // These three lines are the border half of that reset, and nothing else.
  preflights: [
    {
      getCSS: () => `*,::before,::after{border-style:solid;border-width:0;border-color:var(--line)}`,
    },
  ],

  theme: {
    colors: {
      bg: 'var(--bg)',
      surface: {
        DEFAULT: 'var(--surface)',
        2: 'var(--surface-2)',
        3: 'var(--surface-3)',
      },
      well: 'var(--well)',
      fg: {
        DEFAULT: 'var(--fg)',
        2: 'var(--fg-2)',
        3: 'var(--fg-3)',
      },
      line: {
        DEFAULT: 'var(--line)',
        strong: 'var(--line-strong)',
      },
      // Two ramps, split by role. `accent` is ink — text, icons, borders,
      // rings — and is light enough to read on a dark plane. `accent-solid`
      // is the fill under an `accent-fg` label and is dark enough for that
      // label to clear 4.5:1. Using the ink ramp as a fill puts white on a
      // pale blue at 2:1, which is what the skip link used to do.
      accent: {
        DEFAULT: 'var(--accent)',
        hover: 'var(--accent-hover)',
        press: 'var(--accent-press)',
        fg: 'var(--accent-fg)',
        soft: 'var(--accent-soft)',
        solid: 'var(--accent-solid)',
        'solid-hover': 'var(--accent-solid-hover)',
        'solid-press': 'var(--accent-solid-press)',
      },
      success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)' },
      warn: { DEFAULT: 'var(--warn)', soft: 'var(--warn-soft)' },
      danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' },
      // `cat` is set per element via a `--cat` custom property, which keeps
      // nine category colours out of the generated stylesheet and out of the
      // safelist.
      cat: 'var(--cat)',
    },
    // These must NOT be named the same as the raw tokens in theme.css. UnoCSS
    // emits `--font-<key>: <value>` for every entry here, so `ui:
    // 'var(--font-ui)'` became `--font-ui: var(--font-ui)` — a cycle, which
    // CSS resolves by dropping the property. uno.css loads last, so it won,
    // and the whole product rendered in Times New Roman.
    font: {
      ui: 'var(--font-family-ui)',
      display: 'var(--font-family-display)',
      mono: 'var(--font-family-mono)',
    },
    shadow: {
      sm: 'var(--shadow-sm)',
      md: 'var(--shadow-md)',
      lg: 'var(--shadow-lg)',
    },
    radius: {
      sm: '6px',
      DEFAULT: '8px',
      md: '10px',
      lg: '14px',
      xl: '18px',
    },
  },

  shortcuts: [
    // ── Surfaces ──────────────────────────────────────────────────────────
    ['panel', 'bg-surface border border-line rounded-lg'],
    ['panel-2', 'bg-surface-2 border border-line rounded-md'],
    ['well', 'bg-well border border-line rounded-md'],
    ['hairline', 'border-b border-line'],

    // ── Buttons ───────────────────────────────────────────────────────────
    // One base so every button shares height, radius and focus behaviour.
    [
      'btn',
      'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-sm ' +
        'text-[13px] font-medium whitespace-nowrap select-none ' +
        'transition-colors duration-120 ' +
        'disabled:opacity-45 disabled:cursor-not-allowed',
    ],
    ['btn-sm', 'h-7.5 px-2.5 text-[12px] gap-1'],
    ['btn-lg', 'h-10.5 px-5 text-[14px]'],
    ['btn-icon', 'w-9 px-0 shrink-0'],
    [
      'btn-primary',
      'btn bg-accent-solid text-accent-fg hover:not-disabled:bg-accent-solid-hover active:not-disabled:bg-accent-solid-press',
    ],
    // `border-line-strong`, not `border-line`: a secondary button's whole
    // identity is its outline, and in light mode `--surface-2` on a `--well`
    // ground differ by three units — the audit found the 选择文件 button in
    // the compact drop zone genuinely invisible.
    [
      'btn-default',
      'btn bg-surface-2 text-fg border border-line-strong hover:not-disabled:bg-surface-3 hover:not-disabled:border-fg-3',
    ],
    ['btn-ghost', 'btn text-fg-2 hover:not-disabled:bg-surface-2 hover:not-disabled:text-fg'],
    ['btn-danger', 'btn bg-danger-soft text-danger hover:not-disabled:bg-danger hover:not-disabled:text-white'],
    // A toolbar button: shorter than `btn`, no border, and it never wraps.
    // Toolbars pack a dozen of these into one row above an editor or canvas,
    // where a 36px control would cost more height than the row is worth.
    [
      'btn-tool',
      'inline-flex items-center gap-1 shrink-0 h-7 px-2 rounded-sm text-[12px] whitespace-nowrap select-none ' +
        'text-fg-2 transition-colors duration-120 ' +
        'hover:not-disabled:bg-surface-2 hover:not-disabled:text-fg ' +
        'disabled:opacity-45 disabled:cursor-not-allowed',
    ],
    ['btn-tool-active', 'bg-accent-soft text-accent font-medium'],

    // ── Context menus ─────────────────────────────────────────────────────
    // Right-click is a first-class interaction in this app — /documents alone
    // opens fifteen menus — and they had grown four separate class names with
    // four slightly different paddings, radii and hover colours. One set.
    // Panels are always teleported to `body`, hence `fixed`.
    ['menu-panel', 'fixed z-130 stack py-1 rounded-md bg-surface border border-line shadow-lg'],
    ['menu-title', 'row-between gap-3 px-3 pt-1 pb-1.5 text-[11px] font-semibold text-fg-3'],
    [
      'menu-item',
      'flex items-center justify-between gap-3 w-full shrink-0 min-h-8 px-3 py-1 ' +
        'text-[12px] text-fg-2 text-left transition-colors duration-120 ' +
        'hover:not-disabled:bg-accent-soft hover:not-disabled:text-accent ' +
        'focus-visible:not-disabled:bg-accent-soft focus-visible:not-disabled:text-accent ' +
        'focus-visible:outline-none disabled:opacity-45 disabled:cursor-not-allowed',
    ],
    [
      'menu-item-danger',
      'text-danger hover:not-disabled:bg-danger-soft hover:not-disabled:text-danger ' +
        'focus-visible:not-disabled:bg-danger-soft focus-visible:not-disabled:text-danger',
    ],
    ['menu-sep', 'shrink-0 my-1 h-px bg-line'],

    // ── Command palette rows ──────────────────────────────────────────────
    // Eight result kinds — spaces, favourites, recents, tools, canvases,
    // knowledge, sources, clipboard — all render the same row. One shape.
    ['command-row', 'row gap-2.5 px-2 py-1.5 rounded-sm transition-colors duration-120 hover:bg-accent-soft focus-visible:bg-accent-soft focus-visible:outline-none'],
    ['command-row__mark', 'center w-8 h-8 shrink-0 rounded-sm bg-surface-2 text-fg-2'],
    ['command-row__tag', 'shrink-0 text-[11px] not-italic text-fg-3'],

    // ── Form controls ─────────────────────────────────────────────────────
    [
      'field',
      'h-9 px-3 rounded-sm bg-well border border-line text-[13px] text-fg ' +
        'transition-colors duration-120 ' +
        'hover:not-disabled:not-focus:border-line-strong ' +
        'focus:outline-none focus:border-accent focus:ring-3 focus:ring-[var(--accent-ring)] ' +
        'disabled:opacity-50 disabled:cursor-not-allowed',
    ],
    ['field-area', 'field h-auto py-2 leading-relaxed resize-y'],

    // ── Work panes ────────────────────────────────────────────────────────
    // A pane is a panel that fills its column and scrolls its own body: a
    // fixed header strip, then content that takes the rest. Tool pages are
    // built almost entirely out of these.
    // The pane, not the field inside it, carries the focus indication: a
    // textarea that fills its container has no edge of its own to ring.
    ['pane', 'panel flex flex-col overflow-hidden min-w-0 transition-colors focus-within:border-line-strong'],
    ['pane-head', 'row-between gap-2 shrink-0 px-3 h-10 border-b border-line'],
    ['pane-title', 'text-[12px] font-medium text-fg-2'],
    // The editable surface inside a pane. It owns no border of its own — the
    // pane already drew one, and two nested boxes read as a mistake.
    //
    // The `!` overrides are aimed at the legacy sheets, which style bare
    // `textarea`/`input` elements globally for the views that have not been
    // rebuilt yet. They come out with `legacy-bridge.css`.
    [
      'code-area',
      'w-full flex-1 min-h-40 px-3 py-2.5 border-0! rounded-none! bg-transparent! shadow-none! ' +
        'font-mono text-[13px] leading-relaxed resize-none ' +
        'focus:outline-none focus-visible:shadow-none!',
    ],

    // ── Small parts ───────────────────────────────────────────────────────
    ['chip', 'inline-flex items-center gap-1 h-6 px-2 rounded-full text-[12px] bg-surface-2 text-fg-2'],
    ['chip-accent', 'chip bg-accent-soft text-accent'],
    [
      'kbd',
      'inline-flex items-center h-5 px-1.5 rounded-[4px] bg-surface-2 border border-line ' +
        'font-mono text-[11px] text-fg-3',
    ],
    // The label above a heading. Kept quiet: it identifies, it does not shout.
    ['eyebrow', 'text-[12px] font-semibold text-fg-3 tracking-wide'],
    ['divider', 'h-px bg-line'],
    // A text link's hit area is its line box, and an 11px line box is 16px
    // tall — two thirds of the 24px pointer minimum. This pads the box and
    // pulls the margin back by the same amount, so the target grows and the
    // text does not move. For quiet actions that sit in a header row or a
    // footer, where the inline-link exemption does not apply.
    ['tap', 'inline-flex items-center px-1 -mx-1 py-1 -my-1'],

    // ── Layout ────────────────────────────────────────────────────────────
    ['row', 'flex items-center'],
    ['row-between', 'flex items-center justify-between'],
    ['stack', 'flex flex-col'],
    ['center', 'flex items-center justify-center'],
    ['abs-center', 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'],

    // ── Interactive list rows ─────────────────────────────────────────────
    [
      'nav-item',
      'row gap-2.5 h-8.5 px-2.5 rounded-sm text-[13px] text-fg-2 ' +
        'transition-colors duration-120 hover:bg-surface-2 hover:text-fg',
    ],
    ['nav-item-active', 'bg-surface-2 text-fg font-medium'],
  ],

  // Category classes are composed at runtime (`cat-${category.accent}`), so
  // static extraction never sees them.
  safelist: ['pdf', 'image', 'text', 'media', 'dev', 'organize', 'express', 'ai', 'source'].map(
    (name) => `cat-${name}`,
  ),

  rules: [
    // Lets a container declare its category once (`cat-pdf`) and have every
    // child read it through `--cat`.
    [
      /^cat-(pdf|image|text|media|dev|organize|express|ai|source)$/,
      ([, name]) => ({ '--cat': `var(--cat-${name})` }),
    ],
  ],
})
