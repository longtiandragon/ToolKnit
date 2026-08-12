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
      accent: {
        DEFAULT: 'var(--accent)',
        hover: 'var(--accent-hover)',
        press: 'var(--accent-press)',
        fg: 'var(--accent-fg)',
        soft: 'var(--accent-soft)',
      },
      success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)' },
      warn: { DEFAULT: 'var(--warn)', soft: 'var(--warn-soft)' },
      danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' },
      // `cat` is set per element via a `--cat` custom property, which keeps
      // nine category colours out of the generated stylesheet and out of the
      // safelist.
      cat: 'var(--cat)',
    },
    font: {
      ui: 'var(--font-ui)',
      display: 'var(--font-display)',
      mono: 'var(--font-mono)',
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
      'btn bg-accent text-accent-fg hover:not-disabled:bg-accent-hover active:not-disabled:bg-accent-press',
    ],
    [
      'btn-default',
      'btn bg-surface-2 text-fg border border-line hover:not-disabled:bg-surface-3 hover:not-disabled:border-line-strong',
    ],
    ['btn-ghost', 'btn text-fg-2 hover:not-disabled:bg-surface-2 hover:not-disabled:text-fg'],
    ['btn-danger', 'btn bg-danger-soft text-danger hover:not-disabled:bg-danger hover:not-disabled:text-white'],

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
