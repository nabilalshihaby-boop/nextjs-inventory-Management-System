# Sontic Plus design system

Design language for Sontic Plus, an inventory management and POS system. Functionality and layout follow the reference screenshots (sidebar + topbar shell, KPI tiles, data tables, two-column form cards, modals); the visual language is original. Light theme, tuned for 1920×1080 and data-dense tables.

Namespace for cards: `window.Industry_indust`. Link `styles.css` from every page.

## Tokens (`tokens/`)

- **Color** (`colors.css`, OKLCH): `--primary-50…900` deep teal (base 600), `--accent-*` amber (POS and highlights, dark text), `--neutral-0…950` cool slate, semantic `--success/warning/danger/info-{50,100,500,700}`, KPI tile tones `--tone-{teal,green,blue,amber,violet,rose,cyan,red}` (equal lightness, white text ≥ 4.5:1). Aliases: `--bg-app`, `--bg-surface`, `--bg-subtle`, `--bg-hover`, `--border`, `--border-strong`, `--text-1/2/3`, `--focus-ring`.
- **Type** (`typography.css`): Manrope (display, 700/800) and Public Sans (body). Classes: `.t-kpi` 32/36, `.t-page-title` 28/34, `.t-section-title` 18/24, `.t-body` 15/22, `.t-table` 14/20, `.t-label` 13/18, `.t-caption` 12/16. Table headers are 12px uppercase 700. Numbers use tabular figures.
- **Spacing** (`spacing.css`): `--space-1…12` (4px base), `--radius-sm/md/lg/xl` (4/8/12/16), `--shadow-sm/md/lg/xl`, layout sizes `--sidebar-w` 272, `--sidebar-w-collapsed` 76, `--topbar-h` 68, `--control-h` 42, `--row-h` 56.

`components.css` holds the `sp-*` classes the components use. Never restyle them per page.

## Components

Build every page from these; do not hand-roll variants.

- **core**: `Icon` (Lucide name), `Button` (primary, secondary, danger, ghost, accent; sm/md/lg; icon, iconOnly), `Badge` (pass `status="Paid|Unpaid|Received|Completed|Pending|Partial"`)
- **forms**: `Field` (label, required, hint, error), `Input` (icon, addon "EGP" or "%"), `Select`, `Textarea`, `Checkbox`, `Switch`, `FormCard` (columns 1–3, Cancel/Save footer; `sp-span-all` / `sp-span-2` on fields)
- **data**: `StatCard` (8 tones), `DataTable` (columns, rows, `actions(row)` row menu, `footer` totals row), `RowMenu`, `TableToolbar` (search left, actions right), `Pagination`, `Tabs`
- **overlay**: `Modal` (sm/md/lg), `ConfirmDeleteModal` (the one shared delete confirmation: title "Delete [name]?", "Are you sure you want to delete this [item]? This action cannot be undone.", Cancel + danger Delete; use for every delete, trash icon and row-menu delete)
- **shell**: `AppShell` (collapsible `Sidebar` + `Topbar` + content + footer), `Sidebar`, `Topbar`, `PageHeader`

Page patterns: list page = `TableToolbar` + `DataTable` + `Pagination`; create page = `PageHeader` (title, Back button) + `FormCard`; dashboard = `.sp-kpi-grid` of `StatCard`s + `.sp-card` sections.

## Visual foundations

White cards (12px radius, 1px border, `shadow-sm`) on a pale slate app background. Primary actions are solid teal; destructive are red; amber is reserved for POS. Table rows are 56px with a 46px uppercase header; row hover is a faint teal tint. Focus is a 3px teal ring. Inputs are 42px, 8px radius. KPI tiles are the one place with saturated full-bleed color. Status uses tinted pill badges with a dot. No gradients, no emoji.

## Iconography

Lucide, loaded from the `lucide-static` CDN as masks so icons inherit text color. No logo was supplied; the brand renders as "Sontic Plus" in Manrope.

## Content

Title Case for page titles and buttons ("Create Product"), sentence case for helper text. Currency prefixed ("EGP 71,800.00"). Required fields marked with a red asterisk.

## Index

`styles.css`, `tokens/`, `components.css`, `components/*`, `foundations/*` (cards), `components/shell/shell.card.html` (full 1920×1080 shell), `thumbnail.html`.

## POS Lock recovery (demo)
The POS lock stores only `sp.poslock.v1` in browser local storage (auto-lock flag, timeout, salted PIN hash). If you are locked out, open the browser console on the POS page and run `localStorage.removeItem("sp.poslock.v1"); location.reload();`. The cart, held orders and other data are not stored there and are unaffected. Invalid or incomplete values in that key are ignored, so the next Lock Screen click starts PIN setup.
