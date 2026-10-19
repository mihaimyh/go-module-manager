---
name: VS Code Native
colors:
  surface: '#1f1f1f'
  surface-container: '#252526'
  surface-raised: '#2d2d30'
  surface-hover: '#2a2d2e'
  border: '#3c3c3c'
  border-strong: '#4b4b4b'
  on-surface: '#cccccc'
  on-surface-muted: '#9d9d9d'
  primary: '#007acc'
  on-primary: '#ffffff'
  primary-hover: '#1177bb'
  success: '#89d185'
  warning: '#cca700'
  danger: '#f14c4c'
  focus: '#007fd4'
typography:
  body:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  title:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 22px
  label:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.04em
  mono:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
rounded:
  sm: 2px
  DEFAULT: 4px
  md: 6px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
---

## Brand & Style

GMM lives inside a code editor, so it borrows the editor's own restraint rather than importing a product aesthetic. Dense, quiet, and keyboard-friendly: no hero sections, no drop shadows, no gradients. Hierarchy comes from one accent color, 1px borders and monospace data.

The screen is an editor panel, not a marketing page: the first row of content is already data.

## Colors

Neutral greys for every surface, one blue accent reserved for focus, active selection and primary actions. Semantic colors appear only on badges and callouts, never as fills behind text larger than a pill. Advisory findings are amber; reachable vulnerabilities are red.

## Typography

Inter for chrome and prose; JetBrains Mono for module paths and versions so digits do not jitter between rows. Table headers are uppercase 11px with wide tracking.

## Layout & Spacing

A 56px toolbar, a 40px tab strip, then a two-pane split: 60% dependency table, 40% detail inspector. Rows are 40px, borders 1px, padding in a 4/8/12/16/24 scale.

## Elevation & Depth

Flat. Separation by 1px borders and a single tonal step between surface and surface-container. Focus is a 1px accent ring, offset 1px — never a glow.

## Shapes

4px on inputs, buttons and cards; 9999px on status pills; 2px on checkboxes and small chips.

## Components

### Toolbar
Title left, filters inline, primary action right. Search input 32px tall with a leading icon.

### Tabs
Text tabs with a 2px bottom indicator on the active tab, count badges in mono.

### Dependency Table
Sticky header, 40px rows, checkbox column, module path in mono with an `indirect` chip, required/selected version columns, and an update column holding a version plus a kind pill (patch, minor, major, prerelease). Selected row uses surface-hover plus a 1px accent left border.

### Detail Inspector
Path as heading, a two-column definition list, a version select with an inline Update button, an amber advisory callout, and a muted footnote naming the owning `go.mod`.

### Status Pills
Pill radius, mono 11px, 1px border, tinted 12% background — patch green, minor blue, major amber, prerelease dashed outline.
