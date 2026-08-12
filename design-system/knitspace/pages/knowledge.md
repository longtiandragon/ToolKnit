# Knowledge Page Overrides

> **PROJECT:** Knitspace
> **Generated:** 2026-08-09 04:03:35
> **Page Type:** General

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1200px (standard)
- **Layout:** Full-width sections, centered content
- **Sections:** 1. Hero with video background, 2. Key features overlay, 3. Benefits section, 4. CTA

### Spacing Overrides

- No overrides — use Master spacing

### Typography Overrides

- No overrides — use Master typography

### Color Overrides

- **Strategy:** Dark overlay 60% on video. Brand accent for CTA. White text on dark.

### Component Overrides

- Avoid: Large blocking CSS files
- Avoid: Static URLs for dynamic content
- Avoid: Desktop-first causing mobile issues

---

## Page-Specific Components

- No unique components for this page

---

## Recommendations

- Effects: Minimal glow (text-shadow: 0 0 10px), dark-to-light transitions, low white emission, high readability, visible focus
- Performance: Inline critical CSS defer non-critical
- Navigation: Update URL on state/view changes
- Responsive: Start with mobile styles then add breakpoints
- CTA Placement: Overlay on video (center/bottom) + Bottom section
