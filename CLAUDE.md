# CLAUDE.md — Miranda-Liste

## Project Overview

Sales analytics dashboard for **Konplott** jewelry stores. Built with SvelteKit as a static SPA, it visualizes product sales data across multiple store locations, collections, and time periods.

**Stack:** SvelteKit 2 · Svelte 5 (runes) · TypeScript (strict) · Tailwind CSS 4 · Vite 7 · Fuse.js

**Deployment:** Vercel (static adapter, SSR disabled, CSR only)

## Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build (static output to build/)
npm run preview      # Preview production build
npm run check        # Type-check with svelte-check
npm run check:watch  # Type-check in watch mode
```

No test suite exists. Use `npm run check` to validate types before committing.

## Project Structure

```
src/
├── lib/
│   ├── engine.ts              # Core data aggregation, filtering, formatting
│   ├── index.ts               # Library exports
│   ├── Dashboard.svelte       # KPI dashboard with charts
│   ├── AreaChart.svelte       # 10-period trend chart
│   ├── BarChart.svelte        # Store comparison bars
│   ├── BubbleChart.svelte     # FormPfad vs Kollektion bubbles
│   ├── PieChart.svelte        # Collection breakdown pie
│   └── datagrid/              # Custom data grid library (~65 TS files)
│       ├── core/
│       │   ├── index.svelte.ts        # Grid core entry
│       │   ├── column-creation/       # Column builders
│       │   ├── features/              # Grid features (filtering, sorting, grouping, etc.)
│       │   ├── managers/              # Cache, handler, lifecycle managers
│       │   ├── processors/            # Data processing pipeline
│       │   ├── services/              # FilteringService, SortingService, etc.
│       │   └── helpers/               # Utilities
│       ├── icons/                     # 60+ SVG icon components
│       ├── plugins/                   # Grid plugins
│       └── prebuilt/                  # Pre-built grid components
├── routes/
│   ├── +layout.svelte         # Root layout
│   ├── +layout.ts             # Prerender config (ssr=false)
│   └── +page.svelte           # Main dashboard page (~1200 lines)
└── app.d.ts                   # Global type declarations

static/
├── data.json                  # Dictionary-encoded sales data (~12 MB, 167k+ records)
└── robots.txt

_convert.cjs                   # CSV → dictionary-encoded data.json converter
_import.cjs                    # Incremental CSV merger into data.json
```

## Key Architecture

### Data Format

`static/data.json` uses dictionary encoding for compression:

```jsonc
{
  "d": {                        // Dictionaries: string field → index array
    "K": ["Trier", "Köln", ...],  // Kasse (stores)
    "L": ["Petit Glamour", ...],  // Kollektion
    // ...more field dictionaries
  },
  "r": [ [0, 1, 2, ...], ... ]  // Rows as index arrays referencing dictionaries
}
```

**Row column indices:** 0=Kasse, 1=Kollektion, 2=SubKollektion, 3=Art, 4=Nr, 5=Form, 6=FormPfad, 7=BildId, 8=Anzahl, 9=EinzelPreis, 10=Monat, 11=KW, 12=Datum

### Engine (`src/lib/engine.ts`)

Central module for all data logic: aggregation, time filtering, period comparison (Vorperiode/Vorjahr), formatting (EUR, percentages, deltas). All chart components and the main page depend on it.

### Datagrid Library (`src/lib/datagrid/`)

Fully custom-built data grid (not a third-party library). Features: filtering, sorting, grouping, pagination, virtualization, column pinning/resizing/visibility, row selection/expansion, global fuzzy search, faceting, computed columns.

### Main Page (`src/routes/+page.svelte`)

The primary UI — a large single-page component (~1200 lines) containing the full dashboard: time navigation (Tag/Woche/Monat/Jahr), role-based store filtering, article matrix, chart toggles, and drill-down tabs.

## Code Conventions

- **Svelte 5 runes** throughout: `$state`, `$derived`, `$derived.by`, `$props()`
- **TypeScript strict mode** — all strict checks enabled
- **Tailwind CSS 4** with Vite plugin integration (no PostCSS config)
- **German naming** in domain logic: Kasse, Kollektion, Anzahl, Umsatz, etc.
- **Commit messages** in English with conventional prefixes (`feat:`, `fix:`, `perf:`, `data:`)
- **No semicolons** in TypeScript/Svelte files (project convention)
- Prefer editing existing files over creating new ones
- The `datagrid/` library is self-contained — changes there should not leak domain logic

## Authentication

Password-based role switching with hardcoded passwords in `+page.svelte`. Roles filter visible stores (Kassen):
- Default: all stores
- Named roles: Koblenz, NRW, Frankfurt — each sees a subset of stores

## Data Import Workflow

1. Place new CSV files (semicolon-delimited, ISO-8859 encoding) in project root
2. Run `node _import.cjs` for incremental merge or `node _convert.cjs` for full rebuild
3. Output updates `static/data.json`
