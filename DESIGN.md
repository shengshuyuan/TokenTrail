# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-09
- Primary product surfaces: local AI usage dashboard, filters, system status, charts, project distribution, raw records, sharing and integration controls.
- Evidence reviewed: `src/app/page.tsx`, `src/app/globals.css`, `src/app/layout.tsx`, `src/components/dashboard/StatsCards.tsx`, `src/components/dashboard/FilterBar.tsx`, `src/components/dashboard/SystemStatus.tsx`, `src/components/Motion.tsx`, `src/lib/themes.ts`, `tailwind.config.ts`, `docs/PRD.md`, `README.zh-CN.md`.

## Brand
- Personality: precise, local-first, observability-minded, quietly futuristic, and practical for daily cost review.
- Trust signals: clear data scope, visible refresh/sync status, stable numeric hierarchy, readable tables, privacy-first project-name behavior.
- Avoid: marketing-style hero sections, decorative cards inside cards, unreadably tiny labels, over-bright neon bloom, layout changes that obscure the existing data order.

## Product goals
- Goals: make AI usage, cost, source mix, project distribution, and raw records easy to scan and verify.
- Non-goals: adding new analytics behavior, changing privacy settings, or rearranging the restored information architecture during visual polish.
- Success signals: dashboard feels more refined without changing workflows; numbers remain legible at desktop and narrow widths; controls feel responsive but not distracting.

## Personas and jobs
- Primary personas: local power users who track AI tool usage and cost across multiple coding tools.
- User jobs: check total usage and cost, filter by source/model/window, confirm system health, inspect raw records, share a snapshot.
- Key contexts of use: repeated desktop checks, quick narrow-window/mobile review, local always-on service monitoring.

## Information architecture
- Primary navigation: single dashboard page with sticky top controls.
- Core routes/screens: dashboard root, API-backed status/stats/usage surfaces, modal/popover flows for theme, integration, and sharing.
- Content hierarchy: filters and status first, settings, summary metrics, charts, project distribution, raw records, footer.

## Design principles
- Principle 1: preserve the data-first dashboard order; polish should clarify, not reshuffle.
- Principle 2: make density feel intentional through typography, spacing, and material contrast rather than shrinking text.
- Tradeoffs: expressive themes are allowed, but common component structure and accessibility behavior must stay consistent.

## Visual language
- Color: theme-token driven; each theme should use multiple accent roles without becoming a one-color surface.
- Typography: body uses theme fonts; numeric data uses tabular numeric font; labels are compact but legible.
- Spacing/layout rhythm: compact dashboard rhythm with clear section separation and stable control sizes.
- Shape/radius/elevation: panels use theme radius/chamfer; small stat cards keep solid rounded borders for clean rendering.
- Motion: reveal, hover, and refresh motion should feel polished and short; honor reduced-motion preference.
- Imagery/iconography: app logo is the primary brand asset; dashboard icons should remain subtle utility markers.

## Components
- Existing components to reuse: `MotionGroup`, `MotionItem`, `StatsCards`, `FilterBar`, `SystemStatus`, `ThemePicker`, chart panels, project/raw record panels.
- New/changed components: visual-only class refinements for panels, controls, tables, stat cards, and pagination buttons.
- Variants and states: active, hover, focus-visible, disabled, loading, refreshing, success, warning, empty.
- Token/component ownership: theme tokens live in `src/app/globals.css` and `src/lib/themes.ts`; Tailwind aliases live in `tailwind.config.ts`.

## Accessibility
- Target standard: practical WCAG AA readability for dashboard text and controls.
- Keyboard/focus behavior: preserve visible focus rings for buttons and links.
- Contrast/readability: avoid dimming body labels below usable contrast; keep numeric values prominent.
- Screen-reader semantics: do not remove existing semantic sections, tables, buttons, or aria-live sync behavior.
- Reduced motion and sensory considerations: respect `prefers-reduced-motion` by disabling long transitions and animations.

## Responsive behavior
- Supported breakpoints/devices: desktop, tablet, and narrow mobile around 390px.
- Layout adaptations: keep existing wrapping controls, one-column mobile panels, horizontal scroll for dense raw table.
- Touch/hover differences: hover polish must not be required for understanding or operation.

## Interaction states
- Loading: skeleton/pulse states should be calm and not shift layout.
- Empty: keep existing empty-state guidance readable.
- Error: make errors visible without changing data flows.
- Success: sync/backup success should be noticeable but short-lived.
- Disabled: disabled pagination/buttons should visibly reduce emphasis.
- Offline/slow network, if applicable: status panels and error text remain the primary feedback surface.

## Content voice
- Tone: concise, operational, and calm.
- Terminology: keep existing product terms such as TokenTrail, sources, models, tokens, cost, raw records.
- Microcopy rules: avoid adding explanatory marketing text inside the dashboard; controls should stay direct.

## Implementation constraints
- Framework/styling system: Next.js 14, React 18, Tailwind CSS, CSS custom properties, Recharts.
- Design-token constraints: use existing `--theme-*` tokens and compatibility `--eva-*` aliases before adding new layers.
- Performance constraints: visual effects must remain CSS-only and lightweight.
- Compatibility constraints: preserve local-first runtime workflow and existing API behavior.
- Test/screenshot expectations: verify with build and browser checks on desktop and narrow viewport when practical.

## Open questions
- [ ] Should TokenTrail eventually standardize on one default theme, or continue treating all four themes as first-class?
