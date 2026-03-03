<script lang="ts">
  import { onMount } from 'svelte';

  interface RawRow {
    Kollektion: string; BildId: string; Anzahl: number; EinzelPreis: number;
    Form: string; Kasse: string; Art: string;
  }

  let { data = [] }: { data: RawRow[] } = $props();

  type XField = 'Kasse' | 'FormPfad' | 'Kollektion';
  type YMode = 'umsatz' | 'anzahl';
  type StackField = 'FormPfad' | 'Preisgruppe' | 'Kasse' | 'Kollektion';

  let xField = $state<XField>('Kasse');
  let yMode = $state<YMode>('umsatz');
  let stackField = $state<StackField>('FormPfad');
  let pctMode = $state(false);
  let hoveredBar = $state<{ x: number; y: number; xCat: string; stackCat: string; value: number; pct: number } | null>(null);
  let containerEl: HTMLDivElement | undefined = $state();
  let width = $state(900);
  let height = $state(520);

  const MARGIN = { top: 30, right: 160, bottom: 90, left: 70 };

  const COLORS = [
    '#b07c3e','#6b8e5a','#5a7ea8','#c06050','#8a6ab0','#c09050',
    '#4a8a8a','#b05a80','#7a7a4a','#508ab0','#a06a40','#6a9a6a',
    '#9a5a9a','#4a6a9a','#b08a60','#5a9a80','#9a7a5a','#6a5a8a',
    '#7ab05a','#b0505a','#5a5ab0','#8ab060','#b07060','#607ab0',
  ];

  function getFormPfad(form: string): string {
    return (form || '').trim().split(/\s+/)[0] || '(leer)';
  }
  function getPreisgruppe(ep: number): string {
    if (ep < 20) return '0–20€';
    if (ep < 50) return '20–50€';
    if (ep < 120) return '50–120€';
    if (ep < 250) return '120–250€';
    return '250€+';
  }
  function getFieldVal(r: RawRow, field: string): string {
    if (field === 'FormPfad') return getFormPfad(r.Form);
    if (field === 'Preisgruppe') return getPreisgruppe(Number(r.EinzelPreis) || 0);
    return (r as any)[field] || '(leer)';
  }

  function fmtVal(v: number): string {
    if (yMode === 'umsatz') return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
    return v.toLocaleString('de-DE', { maximumFractionDigits: 0 });
  }

  // Aggregation
  interface BarSegment { stackCat: string; value: number; y0: number; y1: number; color: string; pct: number; }
  interface BarColumn { xCat: string; total: number; segments: BarSegment[]; }

  let chartData = $derived.by(() => {
    if (!data.length) return { columns: [] as BarColumn[], stackCats: [] as string[], maxVal: 0 };

    // Aggregate: xCat → stackCat → value
    const map = new Map<string, Map<string, number>>();
    const allStackCats = new Set<string>();
    for (const r of data) {
      const xCat = getFieldVal(r, xField);
      const sCat = getFieldVal(r, stackField);
      allStackCats.add(sCat);
      if (!map.has(xCat)) map.set(xCat, new Map());
      const sm = map.get(xCat)!;
      const an = Number(r.Anzahl) || 0;
      const val = yMode === 'umsatz' ? (Number(r.EinzelPreis) || 0) * an : an;
      sm.set(sCat, (sm.get(sCat) || 0) + val);
    }

    // Sort stack categories by total value desc
    const stackTotals = new Map<string, number>();
    for (const sm of map.values()) { for (const [s, v] of sm) stackTotals.set(s, (stackTotals.get(s) || 0) + v); }
    const stackCats = [...allStackCats].sort((a, b) => (stackTotals.get(b) || 0) - (stackTotals.get(a) || 0));

    // Build columns sorted by total desc
    const columns: BarColumn[] = [...map.entries()].map(([xCat, sm]) => {
      const total = [...sm.values()].reduce((a, b) => a + b, 0);
      let y0 = 0;
      const segments = stackCats.map((sCat, i) => {
        const val = sm.get(sCat) || 0;
        const pct = total > 0 ? (val / total) * 100 : 0;
        const displayVal = pctMode ? pct : val;
        const seg: BarSegment = { stackCat: sCat, value: val, y0, y1: y0 + displayVal, color: COLORS[i % COLORS.length], pct };
        y0 += displayVal;
        return seg;
      }).filter(s => s.value > 0);
      return { xCat, total, segments };
    }).sort((a, b) => b.total - a.total);

    const maxVal = pctMode ? 100 : Math.max(...columns.map(c => c.total), 1);
    return { columns, stackCats, maxVal };
  });

  let chartW = $derived(width - MARGIN.left - MARGIN.right);
  let chartH = $derived(height - MARGIN.top - MARGIN.bottom);

  function scaleY(v: number): number {
    return MARGIN.top + chartH * (1 - v / chartData.maxVal);
  }

  let yTicks = $derived.by(() => {
    const max = chartData.maxVal;
    const count = 5;
    return Array.from({ length: count + 1 }, (_, i) => {
      const val = (max / count) * i;
      return { val, y: scaleY(val) };
    });
  });

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
        {#each (['Kasse', 'FormPfad', 'Kollektion'] as const) as opt}
          <button onclick={() => xField = opt}
            class="px-3 py-1.5 text-[11px] font-medium"
            style="background: {xField === opt ? 'var(--accent)' : 'white'}; color: {xField === opt ? 'white' : 'var(--warm-500)'}; {opt !== 'Kasse' ? 'border-left: 1px solid var(--warm-200)' : ''};">
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
        {#each (['FormPfad', 'Preisgruppe', 'Kasse', 'Kollektion'] as const) as opt}
          <button onclick={() => stackField = opt}
            class="px-3 py-1.5 text-[11px] font-medium"
            style="background: {stackField === opt ? 'var(--accent)' : 'white'}; color: {stackField === opt ? 'white' : 'var(--warm-500)'}; {opt !== 'FormPfad' ? 'border-left: 1px solid var(--warm-200)' : ''};">
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
      {#each chartData.columns as col, ci}
        {@const barW = Math.max(4, Math.min(60, (chartW / chartData.columns.length) * 0.7))}
        {@const gap = chartW / chartData.columns.length}
        {@const barX = MARGIN.left + gap * ci + (gap - barW) / 2}
        {#each col.segments as seg}
          {@const sy0 = scaleY(seg.y0)}
          {@const sy1 = scaleY(seg.y1)}
          {@const segH = sy0 - sy1}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <rect x={barX} y={sy1} width={barW} height={Math.max(0, segH)} fill={seg.color} rx="1"
            style="cursor: pointer; transition: opacity 0.15s;"
            opacity={hoveredBar && hoveredBar.stackCat !== seg.stackCat ? 0.35 : 0.85}
            onmouseenter={() => hoveredBar = { x: barX + barW / 2, y: sy1, xCat: col.xCat, stackCat: seg.stackCat, value: seg.value, pct: seg.pct }}
            onmouseleave={() => hoveredBar = null} />
        {/each}
        <!-- X label -->
        <text x={barX + barW / 2} y={height - MARGIN.bottom + 14} text-anchor="end" fill="var(--warm-500)" font-size="9"
          transform="rotate(-45 {barX + barW / 2} {height - MARGIN.bottom + 14})">
          {col.xCat.length > 14 ? col.xCat.slice(0, 12) + '…' : col.xCat}
        </text>
      {/each}

      <!-- Y axis label -->
      <text x={12} y={height / 2} text-anchor="middle" fill="var(--warm-400)" font-size="10" font-weight="500"
        transform="rotate(-90 12 {height / 2})">{pctMode ? 'Anteil %' : yMode === 'umsatz' ? 'Umsatz (€)' : 'Anzahl'}</text>

      <!-- Legend (right side) -->
      {#each chartData.stackCats.slice(0, 14) as cat, i}
        <rect x={MARGIN.left + chartW + 12} y={MARGIN.top + i * 18} width="10" height="10" rx="2" fill={COLORS[i % COLORS.length]} />
        <text x={MARGIN.left + chartW + 26} y={MARGIN.top + i * 18 + 9} fill="var(--warm-600)" font-size="9">
          {cat.length > 16 ? cat.slice(0, 14) + '…' : cat}
        </text>
      {/each}
      {#if chartData.stackCats.length > 14}
        <text x={MARGIN.left + chartW + 26} y={MARGIN.top + 14 * 18 + 9} fill="var(--warm-400)" font-size="8">+{chartData.stackCats.length - 14} weitere</text>
      {/if}

      <!-- Tooltip -->
      {#if hoveredBar}
        {@const tx = Math.min(Math.max(hoveredBar.x - 75, 5), width - 165)}
        {@const ty = Math.max(hoveredBar.y - 58, 5)}
        <rect x={tx} y={ty} width="160" height="52" rx="8" fill="var(--warm-800)" fill-opacity="0.92" />
        <text x={tx + 10} y={ty + 16} fill="white" font-size="10" font-weight="600">{hoveredBar.xCat}</text>
        <text x={tx + 10} y={ty + 30} fill="var(--warm-300)" font-size="9">{hoveredBar.stackCat}</text>
        <text x={tx + 10} y={ty + 44} fill="var(--warm-300)" font-size="9">{fmtVal(hoveredBar.value)} ({hoveredBar.pct.toFixed(1)}%)</text>
      {/if}
    </svg>
  </div>
</div>
