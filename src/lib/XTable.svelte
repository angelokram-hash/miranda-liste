<script lang="ts">
  interface RawRow {
    Kollektion: string; SubKollektion: string; Art: string; Form: string;
    FormPfad: string; Kasse: string; Monat: string; KW: string; Datum: string;
    Anzahl: number; EinzelPreis: number; BildId: string; Nr: string;
    Quelle: string;
  }

  interface CellArticle {
    bildId: string; nr: string; kollektion: string; form: string; preisgruppe: string;
    einzelPreis: number; umsatz: number; anzahl: number;
    kassenStats: { kasse: string; anzahl: number }[];
  }

  interface XVariantGroup {
    key: string; umsatz: number; anzahl: number; count: number;
    thumbBildId: string; articles: CellArticle[];
  }

  interface CellData {
    umsatz: number; anzahl: number; artikelCount: number;
    articles: CellArticle[];
  }

  let { data = [], hideEuro = false }: { data: RawRow[]; hideEuro?: boolean } = $props()

  // ─── Dimension types ───
  type XDimension = 'Alle' | 'Kollektion' | 'FormPfad' | 'Art' | 'PreisObergruppe' | 'Preisgruppe' | 'Channel' | 'Jahr' | 'Monat' | 'JahrMonat' | 'SubKollektion'

  const COL_DIMS: { value: XDimension; label: string }[] = [
    { value: 'Alle', label: 'Alle' },
    { value: 'Kollektion', label: 'Kollektionen' },
    { value: 'FormPfad', label: 'FormPfad' },
    { value: 'Art', label: 'Art' },
    { value: 'PreisObergruppe', label: 'PreisObergruppe' },
    { value: 'Preisgruppe', label: 'Preisgruppe' },
    { value: 'Channel', label: 'Channel' },
    { value: 'Jahr', label: 'Jahr' },
    { value: 'Monat', label: 'Monat' },
    { value: 'JahrMonat', label: 'JahrMonat' },
  ]

  const ROW_DIMS: { value: XDimension; label: string }[] = [
    { value: 'Alle', label: 'Alle' },
    { value: 'Kollektion', label: 'Kollektionen' },
    { value: 'FormPfad', label: 'FormPfad' },
    { value: 'Art', label: 'Art' },
    { value: 'PreisObergruppe', label: 'PreisObergruppe' },
    { value: 'SubKollektion', label: 'SubKollektion' },
    { value: 'Preisgruppe', label: 'Preisgruppe' },
    { value: 'Channel', label: 'Channel' },
    { value: 'Jahr', label: 'Jahr' },
    { value: 'Monat', label: 'Monat' },
    { value: 'JahrMonat', label: 'JahrMonat' },
  ]

  const FILTER_DIMS: { value: XDimension; label: string }[] = [
    { value: 'Kollektion', label: 'Kollektionen' },
    { value: 'SubKollektion', label: 'SubKollektion' },
    { value: 'FormPfad', label: 'FormPfad' },
    { value: 'Art', label: 'Art' },
    { value: 'PreisObergruppe', label: 'PreisObergruppe' },
    { value: 'Preisgruppe', label: 'Preisgruppe' },
    { value: 'Channel', label: 'Channel' },
  ]

  const MONAT_SORT: Record<string, number> = {
    Jan: 1, Feb: 2, Mär: 3, Apr: 4, Mai: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Okt: 10, Nov: 11, Dez: 12,
  }

  // ─── State ───
  let colDim = $state<XDimension>('Channel')
  let rowDim = $state<XDimension>('Kollektion')
  let filters = $state<Map<XDimension, Set<string>>>(new Map())
  let activeFilterDim = $state<XDimension | null>(null)
  let expandedCell = $state<string | null>(null) // "row\0col" key of expanded cell
  let xVariantenMode = $state(false)
  let expandedVariantsX = $state<Set<string>>(new Set())
  function toggleXVariant(key: string) {
    const s = new Set(expandedVariantsX);
    if (s.has(key)) s.delete(key); else s.add(key);
    expandedVariantsX = s;
  }

  type SortTarget = { type: 'rowName' } | { type: 'rowTotal' } | { type: 'colValue'; col: string }
  let sortTarget = $state<SortTarget>({ type: 'rowTotal' })
  let sortDir = $state<'desc' | 'asc'>('desc')

  // ─── Helpers ───
  function getVal(r: RawRow, dim: XDimension): string {
    switch (dim) {
      case 'Alle': return 'Alle'
      case 'Kollektion': return r.Kollektion || '(leer)'
      case 'FormPfad': return (r as any).FormPfad || ((r.Form || '').trim().split(/\s+/)[0]) || '(leer)'
      case 'Art': return r.Art || '(leer)'
      case 'SubKollektion': return r.SubKollektion || '(leer)'
      case 'Channel': return (r as any).Channel || r.Kasse || '(leer)'
      case 'Monat': return r.Monat || '(leer)'
      case 'Jahr': return (r as any).Jahr || '(leer)'
      case 'JahrMonat': return (r as any).JahrMonat || '(leer)'
      case 'Preisgruppe': {
        const ep = Number(r.EinzelPreis) || 0
        if (ep < 20) return '0–20 €'
        if (ep < 50) return '20–50 €'
        if (ep < 120) return '50–120 €'
        if (ep < 250) return '120–250 €'
        return 'über 250 €'
      }
      case 'PreisObergruppe': {
        const ep = Number(r.EinzelPreis) || 0
        if (ep < 50) return 'Niedrig (0–50 €)'
        if (ep < 250) return 'Mittel (50–250 €)'
        return 'Premium (über 250 €)'
      }
      default: return '(leer)'
    }
  }

  let fmtEUR = $derived.by(() => hideEuro
    ? (_: number) => '\u2022\u2022\u2022'
    : (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }))

  let fmtNum = $derived.by(() => hideEuro
    ? (_: number) => '\u2022\u2022\u2022'
    : (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 0 }))

  function imgUrl(bid: string | number, size = 200): string {
    const id = typeof bid === 'number' ? Math.round(bid) : bid
    return `https://konplott-cdn.com/mytism/image/${id}/${id}.jpg?width=${size}&height=${size}&box=true`
  }

  function dimSort(a: string, b: string, dim: XDimension): number {
    if (dim === 'Monat') return (MONAT_SORT[a] || 99) - (MONAT_SORT[b] || 99)
    if (dim === 'Jahr' || dim === 'JahrMonat') return a.localeCompare(b)
    if (dim === 'Preisgruppe' || dim === 'PreisObergruppe') return a.localeCompare(b, 'de', { numeric: true })
    return a.localeCompare(b, 'de')
  }

  function xPreisgruppe(ep: number): string {
    if (ep < 20) return '0–20'; if (ep < 50) return '20–50'; if (ep < 120) return '50–120'; if (ep < 250) return '120–250'; return '250+'
  }

  function buildArticles(rows: RawRow[]): CellArticle[] {
    const m = new Map<string, { nr: string; kollektion: string; form: string; preisgruppe: string; umsatz: number; anzahl: number; kassen: Map<string, number> }>()
    for (const r of rows) {
      const bid = String(r.BildId)
      if (!bid || bid === '0') continue
      if (!m.has(bid)) m.set(bid, { nr: '', kollektion: '', form: '', preisgruppe: '', umsatz: 0, anzahl: 0, kassen: new Map() })
      const a = m.get(bid)!
      if (!a.nr && r.Nr) a.nr = String(r.Nr)
      if (!a.kollektion && r.Kollektion) a.kollektion = r.Kollektion
      if (!a.form && r.Form) a.form = r.Form
      if (!a.preisgruppe) a.preisgruppe = xPreisgruppe(Number(r.EinzelPreis) || 0)
      const an = Number(r.Anzahl) || 0
      a.umsatz += (Number(r.EinzelPreis) || 0) * an
      a.anzahl += an
      const ch = (r as any).Channel || r.Kasse
      a.kassen.set(ch, (a.kassen.get(ch) || 0) + an)
    }
    return Array.from(m.entries()).map(([bildId, a]) => ({
      bildId, nr: a.nr, kollektion: a.kollektion, form: a.form, preisgruppe: a.preisgruppe,
      einzelPreis: a.anzahl > 0 ? a.umsatz / a.anzahl : 0,
      umsatz: a.umsatz, anzahl: a.anzahl,
      kassenStats: Array.from(a.kassen.entries()).map(([kasse, anzahl]) => ({ kasse, anzahl })).sort((x, y) => y.anzahl - x.anzahl),
    })).sort((a, b) => b.umsatz - a.umsatz)
  }

  function groupVariants(articles: CellArticle[]): XVariantGroup[] {
    const groups = new Map<string, CellArticle[]>()
    for (const art of articles) {
      const vk = `${art.kollektion}|${art.form}|${art.preisgruppe}`
      if (!groups.has(vk)) groups.set(vk, [])
      groups.get(vk)!.push(art)
    }
    return Array.from(groups.entries()).map(([key, arts]) => ({
      key, thumbBildId: arts[0].bildId,
      umsatz: arts.reduce((s, a) => s + a.umsatz, 0),
      anzahl: arts.reduce((s, a) => s + a.anzahl, 0),
      count: arts.length, articles: arts,
    })).sort((a, b) => b.umsatz - a.umsatz)
  }

  // ─── Derived: filter options (from unfiltered data) ───
  let filterOptions = $derived.by(() => {
    const map = new Map<XDimension, string[]>()
    for (const fdim of FILTER_DIMS) {
      const set = new Set<string>()
      for (const r of data) set.add(getVal(r, fdim.value))
      map.set(fdim.value, [...set].sort((a, b) => dimSort(a, b, fdim.value)))
    }
    return map
  })

  // ─── Derived: filtered rows ───
  let filteredRows = $derived.by(() => {
    if (filters.size === 0) return data
    return data.filter(r => {
      for (const [dim, allowed] of filters) {
        if (allowed.size > 0 && !allowed.has(getVal(r, dim))) return false
      }
      return true
    })
  })

  // ─── Derived: pivot computation with anzahl + artikelCount ───
  let pivotResult = $derived.by(() => {
    const cells = new Map<string, number>()
    const cellAnzahl = new Map<string, number>()
    const cellBildIds = new Map<string, Set<string>>()
    const cellRows = new Map<string, RawRow[]>()
    const rowTotals = new Map<string, number>()
    const rowAnzahl = new Map<string, number>()
    const rowBildIds = new Map<string, Set<string>>()
    const colTotals = new Map<string, number>()
    const colAnzahl = new Map<string, number>()
    const colBildIds = new Map<string, Set<string>>()
    const colSet = new Set<string>()
    const rowSet = new Set<string>()
    let grandTotal = 0
    let grandAnzahl = 0
    const grandBildIds = new Set<string>()

    for (const r of filteredRows) {
      const rv = getVal(r, rowDim)
      const cv = getVal(r, colDim)
      const an = Number(r.Anzahl) || 0
      const umsatz = (Number(r.EinzelPreis) || 0) * an
      const bid = String(r.BildId)

      const key = rv + '\0' + cv
      cells.set(key, (cells.get(key) || 0) + umsatz)
      cellAnzahl.set(key, (cellAnzahl.get(key) || 0) + an)
      if (!cellBildIds.has(key)) cellBildIds.set(key, new Set())
      if (bid && bid !== '0') cellBildIds.get(key)!.add(bid)
      if (!cellRows.has(key)) cellRows.set(key, [])
      cellRows.get(key)!.push(r)

      rowTotals.set(rv, (rowTotals.get(rv) || 0) + umsatz)
      rowAnzahl.set(rv, (rowAnzahl.get(rv) || 0) + an)
      if (!rowBildIds.has(rv)) rowBildIds.set(rv, new Set())
      if (bid && bid !== '0') rowBildIds.get(rv)!.add(bid)

      colTotals.set(cv, (colTotals.get(cv) || 0) + umsatz)
      colAnzahl.set(cv, (colAnzahl.get(cv) || 0) + an)
      if (!colBildIds.has(cv)) colBildIds.set(cv, new Set())
      if (bid && bid !== '0') colBildIds.get(cv)!.add(bid)

      colSet.add(cv)
      rowSet.add(rv)
      grandTotal += umsatz
      grandAnzahl += an
      if (bid && bid !== '0') grandBildIds.add(bid)
    }

    const cols = [...colSet].sort((a, b) => dimSort(a, b, colDim))
    const rows = [...rowSet].sort((a, b) => dimSort(a, b, rowDim))

    return {
      cells, cellAnzahl, cellBildIds, cellRows,
      rowTotals, rowAnzahl, rowBildIds,
      colTotals, colAnzahl, colBildIds,
      cols, rows, grandTotal, grandAnzahl, grandBildIds,
    }
  })

  // ─── Derived: articles for expanded cell (lazy) ───
  let expandedArticles = $derived.by(() => {
    if (!expandedCell) return []
    const rows = pivotResult.cellRows.get(expandedCell)
    if (!rows || rows.length === 0) return []
    return buildArticles(rows)
  })

  let expandedArticlesVariant = $derived.by((): XVariantGroup[] => {
    if (!expandedArticles.length) return []
    return groupVariants(expandedArticles)
  })

  // ─── Derived: sorted rows ───
  let sortedRows = $derived.by(() => {
    const { cells, rowTotals, rows } = pivotResult
    return [...rows].sort((a, b) => {
      if (sortTarget.type === 'rowName') {
        const cmp = dimSort(a, b, rowDim)
        return sortDir === 'asc' ? cmp : -cmp
      }
      let va: number, vb: number
      if (sortTarget.type === 'rowTotal') {
        va = rowTotals.get(a) || 0
        vb = rowTotals.get(b) || 0
      } else {
        va = cells.get(a + '\0' + sortTarget.col) || 0
        vb = cells.get(b + '\0' + sortTarget.col) || 0
      }
      return sortDir === 'desc' ? vb - va : va - vb
    })
  })

  // ─── Actions ───
  function toggleSort(target: SortTarget) {
    if (target.type === sortTarget.type &&
        (target.type === 'rowName' || target.type === 'rowTotal' ||
         (target.type === 'colValue' && sortTarget.type === 'colValue' && target.col === (sortTarget as any).col))) {
      sortDir = sortDir === 'desc' ? 'asc' : 'desc'
    } else {
      sortTarget = target
      sortDir = target.type === 'rowName' ? 'asc' : 'desc'
    }
  }

  function swapDims() {
    const tmp = colDim
    colDim = rowDim
    rowDim = tmp
    sortTarget = { type: 'rowTotal' }
    sortDir = 'desc'
    expandedCell = null
  }

  function toggleFilterVal(dim: XDimension, val: string) {
    const newFilters = new Map(filters)
    const set = new Set(newFilters.get(dim) || [])
    if (set.has(val)) set.delete(val)
    else set.add(val)
    if (set.size === 0) newFilters.delete(dim)
    else newFilters.set(dim, set)
    filters = newFilters
  }

  function clearFilter(dim: XDimension) {
    const newFilters = new Map(filters)
    newFilters.delete(dim)
    filters = newFilters
  }

  function selectAllFilter(dim: XDimension) {
    const opts = filterOptions.get(dim) || []
    const newFilters = new Map(filters)
    newFilters.set(dim, new Set(opts))
    filters = newFilters
  }

  function isFilterActive(dim: XDimension): boolean {
    return filters.has(dim) && (filters.get(dim)?.size || 0) > 0
  }

  function filterCount(dim: XDimension): number {
    return filters.get(dim)?.size || 0
  }

  function toggleCell(key: string) {
    expandedCell = expandedCell === key ? null : key
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div onclick={() => { if (activeFilterDim) activeFilterDim = null }}>
  <!-- Dimension selectors -->
  <div class="flex flex-wrap items-center gap-4 mb-4">
    <div class="flex items-center gap-2">
      <span class="text-[10px] font-semibold uppercase tracking-[0.12em]" style="color: var(--warm-400);">Zeilen:</span>
      <select bind:value={rowDim}
        onchange={() => expandedCell = null}
        class="text-[11px] py-1 px-2 rounded-lg outline-none"
        style="border: 1px solid var(--warm-200); color: var(--warm-700); font-family: var(--font-body); background: white;">
        {#each ROW_DIMS as opt}
          <option value={opt.value} disabled={opt.value === colDim}>{opt.label}</option>
        {/each}
      </select>
    </div>
    <button onclick={swapDims}
      class="px-2 py-1 text-sm rounded-lg transition-colors hover:opacity-70"
      style="border: 1px solid var(--warm-200); color: var(--warm-500); background: white;"
      title="Zeilen ↔ Spalten tauschen">⇄</button>
    <div class="flex items-center gap-2">
      <span class="text-[10px] font-semibold uppercase tracking-[0.12em]" style="color: var(--warm-400);">Spalten:</span>
      <select bind:value={colDim}
        onchange={() => expandedCell = null}
        class="text-[11px] py-1 px-2 rounded-lg outline-none"
        style="border: 1px solid var(--warm-200); color: var(--warm-700); font-family: var(--font-body); background: white;">
        {#each COL_DIMS as opt}
          <option value={opt.value} disabled={opt.value === rowDim}>{opt.label}</option>
        {/each}
      </select>
    </div>
    <p class="text-[10px] ml-auto" style="color: var(--warm-400);">
      {sortedRows.length} × {pivotResult.cols.length} · {filteredRows.length} Einträge
    </p>
  </div>

  <!-- Filters -->
  <div class="flex flex-wrap items-center gap-2 mb-4">
    <span class="text-[9px] font-bold uppercase tracking-[0.12em]" style="color: var(--warm-400);">Filter:</span>
    {#each FILTER_DIMS as fdim}
      {@const active = isFilterActive(fdim.value)}
      <div class="relative">
        <button
          onclick={(e: MouseEvent) => { e.stopPropagation(); activeFilterDim = activeFilterDim === fdim.value ? null : fdim.value }}
          class="px-2 py-1 text-[10px] rounded-lg transition-colors"
          style="border: 1px solid {active ? 'var(--accent)' : 'var(--warm-200)'}; color: {active ? 'var(--accent)' : 'var(--warm-500)'}; background: {active ? 'var(--warm-50)' : 'white'};">
          {fdim.label}
          {#if active}<span class="ml-0.5 text-[8px]">({filterCount(fdim.value)})</span>{/if}
        </button>
        {#if activeFilterDim === fdim.value}
          <div class="absolute top-full left-0 mt-1 w-52 max-h-60 overflow-y-auto rounded-xl shadow-lg z-50 py-2"
            style="background: white; border: 1px solid var(--warm-200);"
            onclick={(e: MouseEvent) => e.stopPropagation()}>
            <div class="flex items-center gap-2 px-3 pb-1.5" style="border-bottom: 1px solid var(--warm-100);">
              <button onclick={() => selectAllFilter(fdim.value)} class="text-[10px] font-medium" style="color: var(--accent);">Alle</button>
              <span class="text-[10px]" style="color: var(--warm-300);">|</span>
              <button onclick={() => clearFilter(fdim.value)} class="text-[10px] font-medium" style="color: var(--accent);">Keine</button>
            </div>
            {#each filterOptions.get(fdim.value) || [] as val}
              {@const checked = filters.get(fdim.value)?.has(val) || false}
              <label class="flex items-center gap-2 px-3 py-1 hover:bg-[var(--warm-50)] cursor-pointer">
                <input type="checkbox" {checked}
                  onchange={() => toggleFilterVal(fdim.value, val)}
                  class="accent-[var(--accent)]" />
                <span class="text-[10px] truncate" style="color: var(--warm-700);">{val}</span>
              </label>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
    {#if filters.size > 0}
      <button onclick={() => { filters = new Map() }}
        class="text-[10px] px-2 py-1 rounded-lg transition-colors"
        style="color: var(--accent); border: 1px solid var(--warm-200); background: white;">
        ✕ Filter zurücksetzen
      </button>
    {/if}
  </div>

  <!-- Pivot Table -->
  <div class="overflow-x-auto rounded-lg" style="border: 1px solid var(--warm-200);">
    <table class="w-full text-[11px]" style="border-collapse: collapse;">
      <thead>
        <tr style="background: var(--warm-100);">
          <th class="sticky left-0 z-10 px-3 py-2.5 text-left font-semibold whitespace-nowrap cursor-pointer hover:opacity-70 transition-opacity"
            style="background: var(--warm-100); color: var(--warm-500); border-right: 2px solid var(--warm-200); border-bottom: 2px solid var(--warm-200); min-width: 140px;"
            onclick={() => toggleSort({ type: 'rowName' })}>
            {ROW_DIMS.find(d => d.value === rowDim)?.label || rowDim} \ {COL_DIMS.find(d => d.value === colDim)?.label || colDim}
            {#if sortTarget.type === 'rowName'}
              <span style="color: var(--accent);">{sortDir === 'asc' ? '↑' : '↓'}</span>
            {/if}
          </th>
          {#each pivotResult.cols as cv}
            <th class="px-3 py-2.5 text-right font-semibold whitespace-nowrap cursor-pointer hover:opacity-70 transition-opacity"
              style="color: var(--warm-600); border-bottom: 2px solid var(--warm-200); border-right: 1px solid var(--warm-100);"
              onclick={() => toggleSort({ type: 'colValue', col: cv })}>
              {cv}
              {#if sortTarget.type === 'colValue' && (sortTarget as any).col === cv}
                <span style="color: var(--accent);">{sortDir === 'desc' ? '↓' : '↑'}</span>
              {/if}
            </th>
          {/each}
          <th class="px-3 py-2.5 text-right font-bold whitespace-nowrap cursor-pointer hover:opacity-70 transition-opacity"
            style="background: var(--warm-150, #ebe5db); color: var(--warm-700); border-bottom: 2px solid var(--warm-200); border-left: 2px solid var(--warm-200);"
            onclick={() => toggleSort({ type: 'rowTotal' })}>
            Gesamt
            {#if sortTarget.type === 'rowTotal'}
              <span style="color: var(--accent);">{sortDir === 'desc' ? '↓' : '↑'}</span>
            {/if}
          </th>
        </tr>
      </thead>
      <tbody>
        {#each sortedRows as rv, ri}
          {@const isExpRow = expandedCell !== null && expandedCell.startsWith(rv + '\0')}
          <tr class="hover:bg-[var(--warm-50)] transition-colors" style="{ri % 2 === 1 ? 'background: rgba(245,239,232,0.3);' : ''}">
            <td class="sticky left-0 z-10 px-3 py-2 font-medium truncate"
              style="background: {ri % 2 === 1 ? '#faf7f3' : 'white'}; color: var(--warm-700); border-right: 2px solid var(--warm-200); max-width: 200px;"
              title={rv}>
              {rv}
            </td>
            {#each pivotResult.cols as cv}
              {@const key = rv + '\0' + cv}
              {@const val = pivotResult.cells.get(key) || 0}
              {@const anz = pivotResult.cellAnzahl.get(key) || 0}
              {@const artCount = pivotResult.cellBildIds.get(key)?.size || 0}
              {@const isCellExpanded = expandedCell === key}
              <td class="px-3 py-1.5 text-right tabular-nums align-top"
                style="color: {val > 0 ? 'var(--warm-700)' : 'var(--warm-300)'}; border-right: 1px solid var(--warm-50); {isCellExpanded ? 'background: var(--warm-50);' : ''}">
                {#if val > 0}
                  <p class="text-[11px] font-medium">{fmtEUR(val)}</p>
                  <p class="text-[9px]" style="color: var(--warm-400);">{fmtNum(anz)} Stk</p>
                  <button class="text-[8px] hover:underline" style="color: var(--accent);"
                    onclick={() => toggleCell(key)}>
                    {artCount} {artCount === 1 ? 'Artikel' : 'Artikel'}
                  </button>
                {:else}
                  <p class="text-[11px]">–</p>
                {/if}
              </td>
            {/each}
            <td class="px-3 py-1.5 text-right tabular-nums font-semibold align-top"
              style="background: rgba(235,229,219,0.3); color: var(--warm-800); border-left: 2px solid var(--warm-200);">
              <p class="text-[11px] font-semibold">{fmtEUR(pivotResult.rowTotals.get(rv) || 0)}</p>
              <p class="text-[9px]" style="color: var(--warm-400);">{fmtNum(pivotResult.rowAnzahl.get(rv) || 0)} Stk</p>
              <p class="text-[8px]" style="color: var(--warm-500);">{pivotResult.rowBildIds.get(rv)?.size || 0} Artikel</p>
            </td>
          </tr>
          <!-- Expanded article grid row -->
          {#if isExpRow && expandedCell}
            {@const expCv = expandedCell.split('\0')[1]}
            <tr>
              <td colspan={pivotResult.cols.length + 2}
                style="background: var(--warm-50); border-top: 1px solid var(--warm-200); border-bottom: 2px solid var(--warm-200);">
                <div class="px-5 py-4">
                  <div class="flex items-center gap-3 mb-3">
                    <p class="text-[10px] font-semibold" style="color: var(--warm-600);">
                      {rv} × {expCv} — {expandedArticles.length} Artikel, {fmtEUR(pivotResult.cells.get(expandedCell) || 0)} Umsatz
                    </p>
                    <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
                      <button onclick={() => (xVariantenMode = false, expandedVariantsX = new Set())} class="px-2 py-0.5 text-[9px] font-medium"
                        style="background: {!xVariantenMode ? 'var(--accent)' : 'white'}; color: {!xVariantenMode ? 'white' : 'var(--warm-500)'};">Alle</button>
                      <button onclick={() => xVariantenMode = true} class="px-2 py-0.5 text-[9px] font-medium"
                        style="background: {xVariantenMode ? 'var(--accent)' : 'white'}; color: {xVariantenMode ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">Varianten</button>
                    </div>
                    {#if xVariantenMode}
                      <button onclick={() => (expandedVariantsX = expandedVariantsX.size > 0 ? new Set() : new Set(expandedArticlesVariant.map(v => v.key)))}
                        class="px-2 py-0.5 text-[9px] rounded-lg" style="border: 1px solid var(--warm-200); color: var(--warm-500); background: white;">
                        {expandedVariantsX.size > 0 ? '↕ Zu' : '↕ Auf'}
                      </button>
                    {/if}
                    <button onclick={() => expandedCell = null}
                      class="text-[10px] px-2 py-0.5 rounded-lg ml-auto"
                      style="border: 1px solid var(--warm-200); color: var(--warm-500); background: white;">✕ Schließen</button>
                  </div>
                  <div class="flex flex-wrap gap-3">
                    {#if xVariantenMode}
                      {#each expandedArticlesVariant as vg (vg.key)}
                        {@const vOpen = expandedVariantsX.has(vg.key)}
                        <div class="flex flex-col items-center">
                          <!-- svelte-ignore a11y_click_events_have_key_events -->
                          <!-- svelte-ignore a11y_no_static_element_interactions -->
                          <div class="cursor-pointer" onclick={() => toggleXVariant(vg.key)}>
                            <div class="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden shadow-sm transition-all hover:shadow-lg hover:scale-105" style="border: 1.5px solid {vOpen ? 'var(--accent)' : 'var(--warm-200)'};">
                              <img src={imgUrl(vg.thumbBildId, 200)} alt="" class="w-full h-full object-cover" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).parentElement!.style.display='none'; }} />
                              {#if vg.count > 1}
                                <span class="absolute bottom-0.5 left-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-bold" style="background: var(--accent); color: white;">{vg.count}×</span>
                              {/if}
                            </div>
                            <div class="mt-1.5 text-center">
                              <p class="text-[10px] font-medium tabular-nums" style="color: var(--warm-700);">{fmtEUR(vg.umsatz)}</p>
                              <p class="text-[9px] tabular-nums" style="color: var(--warm-400);">{fmtNum(vg.anzahl)} Stk</p>
                            </div>
                          </div>
                          {#if vOpen}
                            <div class="mt-2 flex flex-wrap gap-2 p-2 rounded-xl" style="background: white; border: 1px solid var(--warm-200);">
                              {#each vg.articles as art (art.bildId)}
                                <div class="flex flex-col items-center">
                                  <div class="relative w-16 h-16 rounded-lg overflow-hidden shadow-sm" style="border: 1px solid var(--warm-200);">
                                    <img src={imgUrl(art.bildId, 160)} alt="" class="w-full h-full object-cover" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).parentElement!.style.display='none'; }} />
                                  </div>
                                  <p class="text-[9px] font-medium tabular-nums mt-0.5" style="color: var(--warm-700);">{fmtEUR(art.umsatz)}</p>
                                  <p class="text-[8px] tabular-nums" style="color: var(--warm-400);">{fmtNum(art.anzahl)} Stk</p>
                                  {#if art.nr}<a href="https://www.konplott.com/go/{art.nr}" target="_blank" rel="noopener" class="text-[7px] underline" style="color: var(--accent);" onclick={(e: MouseEvent) => e.stopPropagation()}>Shop ↗</a>{/if}
                                </div>
                              {/each}
                            </div>
                          {/if}
                        </div>
                      {/each}
                    {:else}
                      {#each expandedArticles as art (art.bildId)}
                        <div class="flex flex-col items-center">
                          <div class="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden shadow-sm transition-all hover:shadow-lg hover:scale-105" style="border: 1.5px solid var(--warm-200);">
                            <img src={imgUrl(art.bildId, 200)} alt="" class="w-full h-full object-cover" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).parentElement!.style.display='none'; }} />
                          </div>
                          <div class="mt-1.5 text-center">
                            <p class="text-[10px] font-medium tabular-nums" style="color: var(--warm-700);">{fmtEUR(art.umsatz)}</p>
                            <p class="text-[9px] tabular-nums" style="color: var(--warm-400);">{fmtNum(art.anzahl)} Stk</p>
                            {#if art.nr}<a href="https://www.konplott.com/go/{art.nr}" target="_blank" rel="noopener" class="text-[8px] underline hover:no-underline" style="color: var(--accent);" onclick={(e: MouseEvent) => e.stopPropagation()}>Shop ↗</a>{/if}
                          </div>
                        </div>
                      {/each}
                    {/if}
                  </div>
                </div>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
      <tfoot>
        <tr style="background: var(--warm-100);">
          <td class="sticky left-0 z-10 px-3 py-2.5 font-bold"
            style="background: var(--warm-100); color: var(--warm-700); border-right: 2px solid var(--warm-200); border-top: 2px solid var(--warm-200);">
            Gesamt
          </td>
          {#each pivotResult.cols as cv}
            <td class="px-3 py-1.5 text-right tabular-nums align-top"
              style="color: var(--warm-800); border-top: 2px solid var(--warm-200); border-right: 1px solid var(--warm-100);">
              <p class="text-[11px] font-semibold">{fmtEUR(pivotResult.colTotals.get(cv) || 0)}</p>
              <p class="text-[9px]" style="color: var(--warm-400);">{fmtNum(pivotResult.colAnzahl.get(cv) || 0)} Stk</p>
              <p class="text-[8px]" style="color: var(--warm-500);">{pivotResult.colBildIds.get(cv)?.size || 0} Artikel</p>
            </td>
          {/each}
          <td class="px-3 py-1.5 text-right tabular-nums font-bold align-top"
            style="background: var(--warm-150, #ebe5db); color: var(--warm-800); border-top: 2px solid var(--warm-200); border-left: 2px solid var(--warm-200);">
            <p class="text-[11px] font-bold">{fmtEUR(pivotResult.grandTotal)}</p>
            <p class="text-[9px]" style="color: var(--warm-400);">{fmtNum(pivotResult.grandAnzahl)} Stk</p>
            <p class="text-[8px]" style="color: var(--warm-500);">{pivotResult.grandBildIds.size} Artikel</p>
          </td>
        </tr>
      </tfoot>
    </table>
  </div>

  {#if sortedRows.length === 0}
    <div class="text-center py-10">
      <p class="text-sm" style="color: var(--warm-400);">Keine Daten für diese Auswahl</p>
    </div>
  {/if}
</div>
