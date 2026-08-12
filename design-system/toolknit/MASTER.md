# ToolKnit Desktop Design System

Selected direction: document-first local workspace, 2026-08-08.

## Product grammar

- Treat every route as a desktop tool, not a marketing page.
- The global rail and 64 px app bar establish location; route bodies must not repeat a hero-sized title or slogan.
- Use a navigator + primary work surface + optional contextual inspector when a workflow has a collection and a selected object.
- Keep low-frequency settings collapsible. Never force raw input and preview into equal narrow columns by default.
- Empty states should explain the next real action without pretending data exists.

## Tokens

- App background: `#f7f6f2`
- Work surface: `#fffefa`
- Secondary surface: `#f1f0eb`
- Navigation: `#10332b`
- Primary text: `#1a2723`
- Secondary text: `#4d5d57`
- Muted text: `#76817d`
- Primary action: `#13806e`
- Strong action: `#0c6557`
- Border: `rgba(24, 43, 36, 0.11)`
- Functional radii: 4, 6, and 8 px. Use 10 px only for large modal surfaces.
- Shadows: none by default; use subtle elevation only for overlays and drawers.

## Typography

- UI: Segoe UI Variable Text → Microsoft YaHei UI → Noto Sans SC.
- Display: Segoe UI Variable Display with the same Chinese fallbacks.
- Code: Cascadia Code → Cascadia Mono → Consolas.
- UI controls: 12–14 px.
- Reading content: 16 px / 1.82 line-height, maximum 860 px.
- Page/document title: 27 px, weight 720. Markdown h2: 22 px.

## Components

- Buttons are 36 px high, 6 px radius, with one emerald primary action per local region.
- Inputs are white, one-pixel bordered, and use visible green focus rings.
- Lists are grouped surfaces with row separators; do not turn every row into a card.
- Panels use borders and alignment before shadows.
- Icons come from the existing application icon layer; do not use emoji or text glyphs as product icons.
- Uploaded screenshots, documents, posters, and clipboard images use `object-fit: contain`.

## Markdown

- Render through `MarkdownContent.vue` and `renderMarkdown()` only.
- Support headings, lists, task lists, tables, blockquotes, images, links, code highlighting, and KaTeX.
- Keep raw HTML disabled, external links isolated, code blocks scrollable, and long-form line length readable.

## Responsive desktop behavior

- Default rail: 228 px; 204 px below 1180 px; icon rail at 920 px and below.
- Do not create body-level horizontal scroll.
- At narrow widths, hide secondary controls before shrinking type below readable sizes.
- Split view may collapse to preview-only when two readable panes no longer fit.

## Forbidden regressions

- Duplicate page titles and giant slogans inside tool routes.
- Grid-paper page backgrounds outside a real image/canvas editing surface.
- Permanent sidebars for low-frequency settings.
- Nested cards, decorative gradients, oversized radii, or heavy shadows.
- Native-looking controls with inconsistent padding, tiny text, clipped labels, or invisible focus.
