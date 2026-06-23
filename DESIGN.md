# Exponential Design System

## 1. Atmosphere & Identity

Exponential feels like a quiet terminal command center for product work: dense, keyboard-first, source-aware, and calm under load. The signature is a paper-terminal editorial surface: mono type, square edges, hairline borders, muted graphite and bone tones, and one phosphor-green accent for action and live state.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Surface/primary | `--editorial-bg` | `#f0eee9` | `#0c0d0c` | Page background |
| Surface/panel | `--editorial-surface` | `#faf9f5` | `#111312` | Cards, panels, buttons |
| Surface/raised | `--editorial-surface-2` | `#e8e5dd` | `#16191a` | Status bars, secondary surfaces |
| Surface/deep | `--editorial-surface-3` | `#ddd9cf` | `#1d2120` | Pressed state |
| Text/primary | `--editorial-ink-1` | `#1a1c19` | `#f0eadc` | Headlines, primary text |
| Text/secondary | `--editorial-ink-2` | `#33372f` | `#d0cabd` | Strong supporting text |
| Text/muted | `--editorial-ink-3` | `#5a5e52` | `#aaa497` | Body support, nav |
| Text/faint | `--editorial-ink-4` | `#85897b` | `#827d73` | Metadata |
| Border/default | `--editorial-line` | `#cdcabd` | `#343a36` | Dividers |
| Border/strong | `--editorial-line-strong` | `#b3afa0` | `#48504a` | Button and panel outlines |
| Accent/primary | `--editorial-accent` | `#1f7a37` | `#7ee787` | Primary CTA, links, focus |
| Accent/hover | `--editorial-accent-hover` | `#196530` | `#9af0a0` | CTA hover |
| Accent/soft | `--editorial-accent-soft` | `#d9ecd9` | `#1a2a1c` | Selected and soft accent fills |

### Rules

- Use editorial tokens or existing `--color-*` aliases that resolve through editorial tokens.
- Accent is for action, selected state, live state, and focus. It is not decoration.
- Preserve light and dark theme parity for every public surface.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| Display | `44px` to `68px` | 500 to 600 | 1.05 | 0 | Root landing hero |
| Hero | `48px` to `72px` | 600 | 1 | 0 | Marketing hero |
| H2 | `24px` to `32px` | 500 to 600 | 1.2 | 0 | Section headers |
| Body/lg | `18px` | 400 | 1.75 | 0 | Lead copy |
| Body | `14px` to `16px` | 400 | 1.6 | 0 | General content |
| UI | `13px` | 500 | 1.4 | 0 | Buttons, labels |
| Meta | `10px` to `12px` | 400 to 600 | 1.4 | 0 | Status bars, chips, captions |

### Font Stack

- Primary: `var(--editorial-sans), ui-monospace, "SF Mono", Menlo, monospace`
- Display: `var(--editorial-display), ui-monospace, "SF Mono", Menlo, monospace`
- Mono: `var(--editorial-mono), ui-monospace, "SF Mono", Menlo, monospace`

### Rules

- Letter spacing stays at `0` unless existing uppercase metadata uses a local wider style.
- Public marketing uses mono-heavy editorial type, not generic SaaS sans styling.

## 4. Spacing & Layout

### Base Unit

Spacing is based on 4px increments through Tailwind utilities and existing CSS primitives.

| Token | Value | Usage |
|-------|-------|-------|
| `1` | 4px | Tight inline spacing |
| `2` | 8px | Button and icon gaps |
| `3` | 12px | Compact control padding |
| `4` | 16px | Default content gap |
| `6` | 24px | Card padding |
| `8` | 32px | Block separation |
| `10` | 40px | Section separation |
| `12` | 48px | Large groups |
| `16` | 64px | Page rhythm |

### Grid

- Public marketing max width: `max-w-7xl`.
- Root landing max width: `max-w-[1180px]`.
- Breakpoints follow Tailwind defaults: `sm`, `md`, `lg`, `xl`, `2xl`.

### Rules

- Use stable header dimensions and wrapping so CTAs do not overflow on mobile.
- Do not introduce new layout systems for marketing surfaces; use the existing Tailwind grid/flex patterns.

## 5. Components

### CommandLink

- Structure: Next `Link` rendered as an inline-flex command button.
- Variants: `default`, `primary`, `ghost`.
- Spacing: `min-h-9 px-4 py-2` by default; header variants may use `min-h-8 px-3`.
- States: hover color and surface changes through editorial tokens; focus uses the global focus ring.
- Accessibility: keep link text literal and destination-specific.

### MarketingShell

- Structure: `PublicPageFrame`, terminal status-bar nav, optional eyebrow chip, page content.
- Spacing: content container uses `px-6 py-8`, expanding at larger breakpoints.
- States: public nav links use tokenized hover borders and surfaces.
- Accessibility: nav is labelled `Public marketing`.

### TerminalPanel

- Structure: bordered square panel with optional status-bar header.
- Depth: no shadow on TTY panels; separation comes from borders and tonal shifts.

## 6. Motion & Interaction

### Timing

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | 80ms to 150ms | ease-out | Button press, hover |
| Standard | 120ms to 200ms | ease-in-out | Color and border transitions |

### Rules

- Animate color, background, border-color, opacity, and transform only.
- Every interactive element must have hover and focus-visible behavior.
- Respect global focus-visible styling from `globals.css`.

## 7. Depth & Surface

### Strategy

Use borders plus tonal shifts. Public marketing surfaces rely on square corners, hairline borders, and subtle background changes, not decorative shadows.

| Type | Value | Usage |
|------|-------|-------|
| Default border | `1px solid var(--editorial-line)` | Status bars and soft sections |
| Strong border | `1px solid var(--editorial-line-strong)` | Panels and command buttons |
| Tonal panel | `var(--editorial-surface)` | Primary framed areas |
| Tonal header | `var(--editorial-surface-2)` | Terminal bars and secondary bands |
