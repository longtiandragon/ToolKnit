# Today Focus Page Overrides

> **PROJECT:** Knitspace
> **Generated:** 2026-08-09 06:14:20
> **Page Type:** Dashboard / Data View

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1200px (standard)
- **Layout:** Full-width sections, centered content
- **Sections:** 1. Hero (problem statement), 2. Comparison matrix (you vs competitors), 3. Feature deep-dive, 4. Winner CTA

### Spacing Overrides

- No overrides — use Master spacing

### Typography Overrides

- No overrides — use Master typography

### Color Overrides

- **Strategy:** Your product column highlighted (accent bg or green). Competitors neutral. Checkmarks green.

### Component Overrides

- Avoid: Remove focus outline without replacement
- Avoid: Static URLs for dynamic content
- Avoid: Large blocking CSS files

---

## Page-Specific Components

- No unique components for this page

---

## Recommendations

- Effects: Improved shadows (softer than flat, clearer than neumorphism), modern (200-300ms), focus visible, WCAG AA/AAA
- Interaction: Use visible focus rings on interactive elements
- Navigation: Update URL on state/view changes
- Performance: Inline critical CSS defer non-critical
- CTA Placement: After comparison table (highlighted row) + Bottom
