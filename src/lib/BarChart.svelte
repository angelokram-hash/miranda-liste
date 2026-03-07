<script lang="ts">
  import { onMount } from 'svelte';

  interface RawRow {
    Kollektion: string; BildId: string; Anzahl: number; EinzelPreis: number;
    Form: string; Kasse: string; Art: string; Monat: string; KW: string;
  }

  let { data = [], compareData = [] }: { data: RawRow[]; compareData: RawRow[] } = $props();

  type XField = 'Channel' | 'FormPfad' | 'Kollektion' | 'Art' | 'Monat' | 'KW';
  type YMode = 'umsatz' | 'anzahl';
  type StackField = 'FormPfad' | 'Preisgruppe' | 'Channel' | 'Kollektion' | 'Art';

  let xField = $state<XField>('Channel');
  let yMode = $state<YMode>('umsatz');
  let stackField = $state<StackField>('FormPfad');
  let pctMode = $state(false);
  let hoveredBar = $state<{ x: number; y: number; xCat: string; stackCat: string; value: number; pct: number; isComp: boolean } | null>(null);
  let containerEl: HTMLDivElement | undefined = $state();
  let width = $state(900);
  let height = $state(520);

  const MARGIN = { top: 30, right: 160, bottom: 90, left: 70 };
  const MONAT_ORDER = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

  const COLORS = [
    '#b07c3e','#6b8e5a','#5a7ea8','#c06050','#8a6ab0','#c09050',
    '#4a8a8a','#b05a80','#7a7a4a','#508ab0','#a06a40','#6a9a6a',
    '#9a5a9a','#4a6a9a','#b08a60','#5a9a80','#9a7a5a','#6a5a8a',
    '#7ab05a','#b0505a','#5a5ab0','#8ab060','#b07060','#607ab0',
  ];

  function getFieldVal(r: RawRow, field: string): string {
    if (field === 'FormPfad') return ((r.Form || '').trim().split(/\s+/)[0]) || '(leer)';
    if (field === 'Preisgruppe') {
      const ep = Number(r.EinzelPreis) || 0;
      if (ep < 20) return '0–20€'; if (ep < 50) return '20–50€'; if (ep < 120) return '50–120€'; if (ep < 250) return '120–250€'; return '250€+';
    }
    if (field === 'Channel') return (r as any).Channel || r.Kasse || '(leer)';
    return (r as any)[field] || '(leer)';
  }

  function getRowVal(r: RawRow): number {
    const an = Number(r.Anzahl) || 0;
    return yMode === 'umsatz' ? (Number(r.EinzelPreis) || 0) * an : an;
  }

  function fmtVal(v: number): string {
    if (yMode === 'umsatz') return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
    return v.toLocaleString('de-DE', { maximumFractionDigits: 0 });
  }

  let isTimeX = $derived(xField === 'Monat' || xField === 'KW');
  let hasCompare = $derived(isTimeX && compareData.length > 0);

  interface BarSegment { stackCat: string; value: number; y0: number; y1: number; color: string; pct: number; }
  interface BarColumn { xCat: string; total: number; segments: BarSegment[]; }

  function buildColumns(rows: RawRow[], stackOrder: string[]): BarColumn[] {
    if (!rows.length) return [];
    const map = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const xCat = getFieldVal(r, xField);
      const sCat = getFieldVal(r, stackField);
      if (!map.has(xCat)) map.set(xCat, new Map());
      map.get(xCat)!.set(sCat, (map.get(xCat)!.get(sCat) || 0) + getRowVal(r));
    }
    return [...map.entries()].map(([xCat, sm]) => {
      const total = [...sm.values()].reduce((a, b) => a + b, 0);
      let y0 = 0;
      const segments = stackOrder.map(sCat => {
        const val = sm.get(sCat) || 0;
        const pct = total > 0 ? (val / total) * 100 : 0;
        const displayVal = pctMode ? pct : val;
        const seg: BarSegment = { stackCat: sCat, value: val, y0, y1: y0 + displayVal, color: '', pct };
        y0 += displayVal;
        return seg;
      }).filter(s => s.value > 0);
      return { xCat, total, segments };
    });
  }

  function sortCols(cols: BarColumn[]): BarColumn[] {
    if (xField === 'Monat') return [...cols].sort((a, b) => MONAT_ORDER.indexOf(a.xCat) - MONAT_ORDER.indexOf(b.xCat));
    if (xField === 'KW') return [...cols].sort((a, b) => Number(a.xCat) - Number(b.xCat));
    return [...cols].sort((a, b) => b.total - a.total);
  }

  // Compute unified stack order from both datasets
  let allStackCats = $derived.by(() => {
    const totals = new Map<string, number>();
    for (const r of [...data, ...compareData]) {
      const s = getFieldVal(r, stackField);
      totals.set(s, (totals.get(s) || 0) + getRowVal(r));
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  });

  let mainColumns = $derived(sortCols(buildColumns(data, allStackCats)));
  let compColumns = $derived(hasCompare ? sortCols(buildColumns(compareData, allStackCats)) : []);

  // Merge x categories for time axis
  let allXCats = $derived.by(() => {
    if (!hasCompare) return mainColumns.map(c => c.xCat);
    const set = new Set([...mainColumns.map(c => c.xCat), ...compColumns.map(c => c.xCat)]);
    const arr = [...set];
    if (xField === 'Monat') return arr.sort((a, b) => MONAT_ORDER.indexOf(a) - MONAT_ORDER.indexOf(b));
    if (xField === 'KW') return arr.sort((a, b) => Number(a) - Number(b));
    return arr;
  });

  let displayColumns = $derived(hasCompare ? allXCats.map(x => mainColumns.find(c => c.xCat === x) || { xCat: x, total: 0, segments: [] }) : mainColumns);

  let maxVal = $derived.by(() => {
    if (pctMode) return 100;
    let m = 0;
    for (const c of displayColumns) m = Math.max(m, c.total);
    if (hasCompare) for (const c of compColumns) m = Math.max(m, c.total);
    return m || 1;
  });

  let chartW = $derived(width - MARGIN.left - MARGIN.right);
  let chartH = $derived(height - MARGIN.top - MARGIN.bottom);

  function scaleY(v: number): number { return MARGIN.top + chartH * (1 - v / maxVal); }

  let yTicks = $derived(Array.from({ length: 6 }, (_, i) => {
    const val = (maxVal / 5) * i;
    return { val, y: scaleY(val) };
  }));

  function colorForStack(sCat: string): string {
    const idx = allStackCats.indexOf(sCat);
    return COLORS[idx >= 0 ? idx % COLORS.length : 0];
  }

  onMount(() => {
    if (containerEl) {
      const ro = new ResizeObserver(entries => {
        for (const e of entries) { width = e.contentRect.width; height = Math.max(400, Math.min(600, e.contentRect.width * 0.55)); }
      });
      ro.observe(containerEl);
      return () => ro.disconnect();
    }
  });
</script>

<div class="space-y-4">
  <!-- Controls -->
  <div class="flex flex-wrap items-center gap-4">
    <div>
      <p class="text-[9px] font-semibold uppercase tracking-[0.12em] mb-1.5" style="color: var(--warm-400);">X-Achse</p>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
        {#each (['Channel', 'FormPfad', 'Kollektion', 'Art', 'Monat', 'KW'] as const) as opt, i}
          <button onclick={() => xField = opt}
            class="px-3 py-1.5 text-[11px] font-medium"
            style="background: {xField === opt ? 'var(--accent)' : 'white'}; color: {xField === opt ? 'white' : 'var(--warm-500)'}; {i > 0 ? 'border-left: 1px solid var(--warm-200)' : ''};">
            {opt}
          </button>
        {/each}
      </div>
    </div>
    <div>
      <p class="text-[9px] font-semibold uppercase tracking-[0.12em] mb-1.5" style="color: var(--warm-400);">Y-Wert</p>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
        <button onclick={() => yMode = 'umsatz'} class="px-3 py-1.5 text-[11px] font-medium"
          style="background: {yMode === 'umsatz' ? 'var(--accent)' : 'white'}; color: {yMode === 'umsatz' ? 'white' : 'var(--warm-500)'};">Umsatz</button>
        <button onclick={() => yMode = 'anzahl'} class="px-3 py-1.5 text-[11px] font-medium"
          style="background: {yMode === 'anzahl' ? 'var(--accent)' : 'white'}; color: {yMode === 'anzahl' ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">Anzahl</button>
      </div>
    </div>
    <div>
      <p class="text-[9px] font-semibold uppercase tracking-[0.12em] mb-1.5" style="color: var(--warm-400);">Stapelung</p>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
        {#each (['FormPfad', 'Preisgruppe', 'Channel', 'Kollektion', 'Art'] as const) as opt, i}
          <button onclick={() => stackField = opt}
            class="px-3 py-1.5 text-[11px] font-medium"
            style="background: {stackField === opt ? 'var(--accent)' : 'white'}; color: {stackField === opt ? 'white' : 'var(--warm-500)'}; {i > 0 ? 'border-left: 1px solid var(--warm-200)' : ''};">
            {opt}
          </button>
        {/each}
      </div>
    </div>
    <div>
      <p class="text-[9px] font-semibold uppercase tracking-[0.12em] mb-1.5" style="color: var(--warm-400);">Modus</p>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
        <button onclick={() => pctMode = false} class="px-3 py-1.5 text-[11px] font-medium"
          style="background: {!pctMode ? 'var(--accent)' : 'white'}; color: {!pctMode ? 'white' : 'var(--warm-500)'};">Gestapelt</button>
        <button onclick={() => pctMode = true} class="px-3 py-1.5 text-[11px] font-medium"
          style="background: {pctMode ? 'var(--accent)' : 'white'}; color: {pctMode ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">100%</button>
      </div>
    </div>
  </div>

  {#if hasCompare}
    <div class="text-[10px] px-3 py-1.5 rounded-lg inline-flex items-center gap-2" style="background: var(--warm-100); color: var(--warm-500);">
      <span class="inline-block w-3 h-3 rounded-sm" style="background: var(--accent); opacity: 0.85;"></span> Aktuell
      <span class="inline-block w-3 h-3 rounded-sm ml-2" style="background: var(--warm-400); opacity: 0.5;"></span> Vergleich
    </div>
  {/if}

  <!-- Chart -->
  <div bind:this={containerEl} class="w-full rounded-xl overflow-hidden" style="background: white; border: 1px solid var(--warm-200);">
    <svg {width} {height} style="font-family: var(--font-body);">
      <!-- Grid -->
      {#each yTicks as tick}
        <line x1={MARGIN.left} x2={MARGIN.left + chartW} y1={tick.y} y2={tick.y} stroke="var(--warm-100)" stroke-width="1" />
        <text x={MARGIN.left - 8} y={tick.y + 4} text-anchor="end" fill="var(--warm-400)" font-size="9">
          {pctMode ? tick.val.toFixed(0) + '%' : fmtVal(tick.val)}
        </text>
      {/each}

      <!-- Bars -->
      {#each displayColumns as col, ci}
        {@const nCols = displayColumns.length}
        {@const slotW = chartW / nCols}
        {@const barW = hasCompare ? Math.max(3, Math.min(30, slotW * 0.35)) : Math.max(4, Math.min(60, slotW * 0.7))}
        {@const slotX = MARGIN.left + slotW * ci}

        <!-- Main bar -->
        {@const mainX = hasCompare ? slotX + slotW / 2 - barW - 1 : slotX + (slotW - barW) / 2}
        {#each col.segments as seg}
          {@const sy0 = scaleY(seg.y0)}
          {@const sy1 = scaleY(seg.y1)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <rect x={mainX} y={sy1} width={barW} height={Math.max(0, sy0 - sy1)} fill={colorForStack(seg.stackCat)} rx="1"
            style="cursor: pointer; transition: opacity 0.15s;"
            opacity={hoveredBar && hoveredBar.stackCat !== seg.stackCat ? 0.3 : 0.85}
            onmouseenter={() => hoveredBar = { x: mainX + barW / 2, y: sy1, xCat: col.xCat, stackCat: seg.stackCat, value: seg.value, pct: seg.pct, isComp: false }}
            onmouseleave={() => hoveredBar = null} />
        {/each}

        <!-- Comparison bar -->
        {#if hasCompare}
          {@const compCol = compColumns.find(c => c.xCat === col.xCat)}
          {@const compX = slotX + slotW / 2 + 1}
          {#if compCol}
            {#each compCol.segments as seg}
              {@const sy0 = scaleY(seg.y0)}
              {@const sy1 = scaleY(seg.y1)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <rect x={compX} y={sy1} width={barW} height={Math.max(0, sy0 - sy1)} fill={colorForStack(seg.stackCat)} rx="1"
                style="cursor: pointer; transition: opacity 0.15s;"
                opacity={hoveredBar && hoveredBar.stackCat !== seg.stackCat ? 0.15 : 0.4}
                onmouseenter={() => hoveredBar = { x: compX + barW / 2, y: sy1, xCat: col.xCat, stackCat: seg.stackCat, value: seg.value, pct: seg.pct, isComp: true }}
                onmouseleave={() => hoveredBar = null} />
            {/each}
          {/if}
        {/if}

        <!-- X label -->
        {@const labelX = slotX + slotW / 2}
        <text x={labelX} y={height - MARGIN.bottom + 14} text-anchor="end" fill="var(--warm-500)" font-size="9"
          transform="rotate(-45 {labelX} {height - MARGIN.bottom + 14})">
          {col.xCat.length > 14 ? col.xCat.slice(0, 12) + '…' : col.xCat}
        </text>
      {/each}

      <!-- Y axis label -->
      <text x={12} y={height / 2} text-anchor="middle" fill="var(--warm-400)" font-size="10" font-weight="500"
        transform="rotate(-90 12 {height / 2})">{pctMode ? 'Anteil %' : yMode === 'umsatz' ? 'Umsatz (€)' : 'Anzahl'}</text>

      <!-- Legend -->
      {#each allStackCats.slice(0, 14) as cat, i}
        <rect x={MARGIN.left + chartW + 12} y={MARGIN.top + i * 18} width="10" height="10" rx="2" fill={COLORS[i % COLORS.length]} />
        <text x={MARGIN.left + chartW + 26} y={MARGIN.top + i * 18 + 9} fill="var(--warm-600)" font-size="9">
          {cat.length > 16 ? cat.slice(0, 14) + '…' : cat}
        </text>
      {/each}
      {#if allStackCats.length > 14}
        <text x={MARGIN.left + chartW + 26} y={MARGIN.top + 14 * 18 + 9} fill="var(--warm-400)" font-size="8">+{allStackCats.length - 14} weitere</text>
      {/if}

      <!-- Tooltip -->
      {#if hoveredBar}
        {@const tx = Math.min(Math.max(hoveredBar.x - 80, 5), width - 175)}
        {@const ty = Math.max(hoveredBar.y - 68, 5)}
        <rect x={tx} y={ty} width="170" height="60" rx="8" fill="var(--warm-800)" fill-opacity="0.92" />
        <text x={tx + 10} y={ty + 16} fill="white" font-size="10" font-weight="600">{hoveredBar.xCat} {hoveredBar.isComp ? '(Vergleich)' : ''}</text>
        <text x={tx + 10} y={ty + 32} fill="var(--warm-300)" font-size="9">{hoveredBar.stackCat}</text>
        <text x={tx + 10} y={ty + 48} fill="var(--warm-300)" font-size="9">{fmtVal(hoveredBar.value)} ({hoveredBar.pct.toFixed(1)}%)</text>
      {/if}
    </svg>
  </div>
</div>
