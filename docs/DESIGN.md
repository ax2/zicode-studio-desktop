# ZiCode Studio Desktop design system

ZiCode Studio Desktop uses CSS custom properties and reusable `.ui-*`
primitives to keep the desktop UI consistent. The CSS variables in
`public/style-theme.css` are the single source of truth.

## CSS layers

Load styles in this order:

1. `style-theme.css` — foundation and theme tokens
2. `design-system.css` — reusable UI primitives
3. `style.css` / `cost.css` — page and domain-specific layout

Business styles may position a component or represent domain state, but must not duplicate a primitive's typography, dimensions, colors, or generic interaction states.

## Page composition

Studio is a desktop workbench. Choose a layout according to what people need to read, compare or edit. Across modules, use the existing theme palette, type scale and control shapes so the same action retains its visual weight.

| Surface | Composition | Narrow window |
| --- | --- | --- |
| Library, inbox, task list | Align the title and primary action above the collection. Keep search and common filters together. Place backup, import settings and infrequent management actions in a secondary group. | Allow filters to wrap. Keep the list and selected item reachable in reading order. |
| Conversation, note or document | Give the content a readable column. Keep editing actions close to their selection or composer and secondary details outside the reading column. | Prioritize the editor and its primary action. Side panels may become dismissible views. |
| Preview, canvas or browser | Give the work surface the remaining space. Keep chrome compact and panels independently scrollable where needed. | Retain the active document, selection and navigation when tools collapse. |
| Settings, tool or dialog | Group related fields, labels and validation. Put the action that commits the change alongside its scope. Reserve destructive styling for irreversible actions. | Stack label and field, then the actions. Keep close, cancel and recovery reachable. |

Use the spacing scale to express relationships. A practical desktop starting point is 4–8px between a label and its control, 8–12px between peers, 16–24px between groups and 24–32px between major regions. Choose tokens for these distances. Keep plain lists flat. Use a card when its contents form a selectable item, preview or distinct task. Use a single page title; add a section heading when it tells the reader something new.

Use the theme accent for the primary action, current location or selection. Convey state with a label, shape or other visible cue as well as color. Keep timestamps and supporting text legible. Use a visible keyboard focus ring on input, action and navigation controls. Support reduced motion and system forced colors. Test wrapping with real filenames and translated labels. Visually group icons of the same purpose and give icon-only actions accessible names.

For each changed page family, capture the normal entry point before and after using comparable content, theme and viewport. Inspect one compact size as well as desktop, active and empty states, and at least one genuine task such as opening a result, editing a field or cancelling a dialog. For shared tokens check all built-in themes. Record the screenshots and any gaps in the feature Issue. External websites and user-authored documents retain their own presentation.

These conventions adapt the spacing and grouping principles in [Microsoft Fluent 2 Layout](https://fluent2.microsoft.design/layout) and keyboard guidance in [W3C Understanding Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html).

## Foundation tokens

### Typography

Use only the shared type scale:

- `--font-size-sm`: metadata and compact labels
- `--font-size-md`: default body and controls
- `--font-size-lg`: prominent labels and small headings
- `--font-size-xl`: headings
- `--font-size-2xl`: display values

Do not add a token merely to preserve an isolated historical font size. Choose the closest semantic level and visually review the result.

Define `font-family` only once on the top-level `body` of each document. Descendants must use normal CSS inheritance; do not add component-level `font-family` declarations, including redundant `font-family: inherit` or monospace overrides.

### Spacing

Spacing follows a 4px base scale. `--space-0-5` and `--space-1-5` exist for dense desktop controls. Prefer the scale over literal values in `gap`, `padding`, and component spacing.

### Control heights

- `--control-height-xs` (24px): dense toolbars only
- `--control-height-sm` (28px): compact controls
- `--control-height-md` (32px): default controls
- `--control-height-lg` (40px): primary actions and spacious forms

The default `.ui-*` control size is medium. Add a size modifier only for non-default sizes.

### Shape

Use `--radius-xs`, `--radius-sm`, `--radius-md`, `--radius`, `--radius-lg`, or `--radius-pill`. Do not introduce component-specific radius values.

## UI primitives

Primitives live in `public/design-system.css`:

- `.ui-button`
- `.ui-icon-button`
- `.ui-input`
- `.ui-textarea`
- `.ui-select`
- `.ui-badge`
- `.ui-panel`
- `.ui-card`
- `.ui-toolbar`

Button variants are `--primary`, `--secondary`, `--ghost`, and `--danger`. Size modifiers are `--xs`, `--sm`, and `--lg`; medium is the default.

```html
<button
  type="button"
  class="ui-button ui-button--primary save-settings-button"
>
  Save
</button>

<button
  type="button"
  class="ui-icon-button ui-icon-button--sm ui-icon-button--ghost new-session-btn"
  aria-label="New session"
>
  …
</button>
```

Keep business classes when migrating existing markup. `.ui-*` owns shared appearance; the business class owns positioning, domain state, JS hooks, and test selectors.

## Interaction and accessibility

The design system owns hover, active, focus-visible, disabled, busy, and invalid presentation. Prefer native semantics:

- Use `<button type="button">` for actions.
- Use `<a href>` for navigation.
- Use native `<input>`, `<textarea>`, and `<select>` elements.
- Use `disabled`, `aria-disabled`, `aria-busy`, and `aria-invalid` rather than visual-only state classes.
- Do not apply button styling to a `div` or `span` to simulate a control.

Domain states such as `.selected`, `.current`, or `.is-recording` remain in business CSS.

## Rules

Recommended:

```css
.settings-actions {
  display: flex;
  gap: var(--space-2);
}

.settings-title {
  font-size: var(--font-size-lg);
}
```

Avoid:

```css
.settings-button {
  height: 34px;
  padding: 7px 14px;
  border-radius: 9px;
  font-size: 13px;
}
```

Do not create one-off variables such as `--settings-special-gap` merely to satisfy the checker. Stable, repeated component semantics may become tokens; one-off page layouts should compose foundation tokens.

## Legitimate exceptions

Not every CSS dimension is a design token. Percentages, viewport units, calculated geometry, responsive breakpoints, dynamic measurements, one-pixel dividers, and chart geometry may be literal when they describe layout or rendering rather than visual scale.

For an exceptional fixed value that the checker cannot infer, explain it locally:

```css
/* design-token-ignore: fixed plotting area required by Chart.js */
.cost-chart-canvas {
  height: 300px;
}
```

An ignore without a reason is invalid. Do not use ignores for ordinary font sizes, control heights, padding, gaps, or radii.

## Checks

After changing CSS, UI markup, or inline styles, run:

```bash
bun run check
```

Useful focused commands:

```bash
bun run check:design
bun run check:design:fix
```

The fixer only performs exact token substitutions. Ambiguous values require human selection and visual review. Static inline styles in JavaScript are reported as warnings; dynamic measured geometry is allowed.

## Visual review checklist

Before completing a design-system migration, review:

- every built-in theme
- sidebar and header controls
- chat composer
- settings forms
- dialogs
- cost dashboard and charts
- hover, active, focus, disabled, busy, and invalid states
- narrow windows
- long text, truncation, wrapping, and icon alignment
