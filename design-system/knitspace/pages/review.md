# Review Page Overrides

> **PROJECT:** Knitspace
> **Generated:** 2026-08-09 04:30:27
> **Page Type:** General

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1200px (standard)
- **Layout:** Full-width sections, centered content
- **Sections:** 1. Hero (product + aggregate rating), 2. Rating breakdown, 3. Individual reviews, 4. Buy/CTA

### Spacing Overrides

- No overrides — use Master spacing

### Typography Overrides

- No overrides — use Master typography

### Color Overrides

- **Strategy:** Trust colors. Star ratings gold. Verified badge green. Review sentiment colors.

### Component Overrides

- Avoid: Static URLs for dynamic content
- Avoid: Large blocking CSS files
- Avoid: Desktop-first causing mobile issues

---

## Page-Specific Components

- No unique components for this page

---

## Recommendations

- Effects: Minimal glow (text-shadow: 0 0 10px), dark-to-light transitions, low white emission, high readability, visible focus
- Navigation: Update URL on state/view changes
- Performance: Inline critical CSS defer non-critical
- Responsive: Start with mobile styles then add breakpoints
- CTA Placement: After reviews summary + Buy button alongside reviews
