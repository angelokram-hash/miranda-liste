<script lang="ts">
  import { onMount } from 'svelte';

  interface RawRow {
    Kollektion: string; BildId: string; Anzahl: number; EinzelPreis: number;
    Form: string; Kasse: string; Art: string; Nr: string; KW: string; Monat: string;
    Datum: string;
  }

  type TimeUnit = 'tag' | 'woche' | 'monat' | 'jahr';

  let { data = [], timeUnit = 'woche' as TimeUnit, currentPeriod = '', periods = [] as string[] }:
    { data: RawRow[]; timeUnit?: TimeUnit; currentPeriod?: string; periods?: string[] } = $props();

  const MIN_PERIODS = 10;

  type ValueField = 'Kollektion' | 'Artikel' | 'Art' | 'Preisgruppe' | 'Kasse';
  type YMode = 'umsatz' | 'anzahl';

  let valueField = $state<ValueField>('Kollektion');
  let yMode = $state<YMode>('umsatz');
  let topN = $state(10);
  let pctMode = $state(false);
  let hideSonstige = $state(false);
  let hoveredPoint = $state<{ x: number; y: number; kw: string; cat: string; value: number; pct: number } | null>(null);
  let containerEl: HTMLDivElement | undefined = $state();
  let width = $state(900);
  let height = $state(500);

  const MARGIN = { top: 20, right: 160, bottom: 50, left: 70 };

  const COLORS = [
    '#b07c3e','#6b8e5a','#5a7ea8','#c06050','#8a6ab0','#c09050',
    '#4a8a8a','#b05a80','#7a7a4a','#508ab0','#a06a40','#6a9a6a',
    '#9a5a9a','#4a6a9a','#b08a60','#5a9a80','#9a7a5a','#6a5a8a',
    '#7ab05a','#b0505a','#5a5ab0','#8ab060','#b07060','#607ab0',
  ];

  function getFieldVal(r: RawRow, field: ValueField): string {
    if (field === 'Artikel') return String(r.BildId || '0');
    if (field === 'Preisgruppe') {
      const ep = Number(r.EinzelPreis) || 0;
      if (ep < 20) return '0\u201320\u20ac'; if (ep < 50) return '20\u201350\u20ac'; if (ep < 120) return '50\u2013120\u20ac'; if (ep < 250) return '120\u2013250\u20ac'; return '250\u20ac+';
    }
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

  function imgUrl(bildId: string, size: number): string {
    return `https://konplott-cdn.com/mytism/image/${bildId}/${bildId}.jpg?width=${size}&height=${size}&box=true`;
  }

  // Determine which periods to show (last MIN_PERIODS ending at currentPeriod)
  function periodKeyForRow(r: RawRow): string {
    if (timeUnit === 'tag') return r.Datum;
    const y = (r.Datum || '').slice(0, 4);
    if (timeUnit === 'woche') return `${y}-${r.KW}`;
    if (timeUnit === 'monat') return `${y}-${(r as any).Monat}`;
    return y;
  }

  function periodLabel(p: string): string {
    if (timeUnit === 'tag') { const [y, m, d] = p.split('-'); return `${d}.${m}`; }
    if (timeUnit === 'woche') { const [y, k] = p.split('-'); return `KW${k}`; }
    if (timeUnit === 'monat') { const [y, m] = p.split('-'); return m; }
    return p;
  }

  let visiblePeriods = $derived.by((): string[] => {
    if (!periods.length || !currentPeriod) return [];
    const ci = periods.indexOf(currentPeriod);
    if (ci < 0) return periods.slice(-MIN_PERIODS);
    const start = Math.max(0, ci - MIN_PERIODS + 1);
    return periods.slice(start, ci + 1);
  });

  // Build chart data
  let chartData = $derived.by(() => {
    if (!data.length || !visiblePeriods.length) return { kws: [] as string[], series: [] as { cat: string; values: number[]; total: number; bildId: string }[], maxY: 0 };

    const kws = visiblePeriods;
    const kwSet = new Set(kws);

    // Filter data to visible periods
    const visData = data.filter(r => kwSet.has(periodKeyForRow(r)));

    // Aggregate: cat -> period -> value
    const catKwMap = new Map<string, Map<string, number>>();
    const catBild = new Map<string, string>();
    for (const r of visData) {
      const cat = getFieldVal(r, valueField);
      const pk = periodKeyForRow(r);
      if (!catKwMap.has(cat)) catKwMap.set(cat, new Map());
      catKwMap.get(cat)!.set(pk, (catKwMap.get(cat)!.get(pk) || 0) + getRowVal(r));
      if (valueField === 'Artikel' && !catBild.has(cat)) catBild.set(cat, String(r.BildId));
    }

    // Sort cats by total value, take topN
    let series = [...catKwMap.entries()].map(([cat, kwMap]) => {
      const values = kws.map(kw => kwMap.get(kw) || 0);
      const total = values.reduce((s, v) => s + v, 0);
      return { cat, values, total, bildId: catBild.get(cat) || '' };
    }).sort((a, b) => b.total - a.total);

    // If more than topN, group the rest as "Sonstige"
    if (series.length > topN) {
      const top = series.slice(0, topN);
      if (!hideSonstige) {
        const rest = series.slice(topN);
        const sonstValues = kws.map((_, ki) => rest.reduce((s, r) => s + r.values[ki], 0));
        const sonstTotal = sonstValues.reduce((s, v) => s + v, 0);
        top.push({ cat: 'Sonstige', values: sonstValues, total: sonstTotal, bildId: '' });
      }
      series = top;
    }

    // Compute stacked y values and max
    let maxY = 0;
    if (pctMode) {
      maxY = 100;
    } else {
      for (let ki = 0; ki < kws.length; ki++) {
        const colTotal = series.reduce((s, sr) => s + sr.values[ki], 0);
        maxY = Math.max(maxY, colTotal);
      }
    }
    maxY = maxY || 1;

    return { kws, series, maxY };
  });

  let chartW = $derived(width - MARGIN.left - MARGIN.right);
  let chartH = $derived(height - MARGIN.top - MARGIN.bottom);

  function xPos(kwIdx: number): number {
    const n = chartData.kws.length;
    if (n <= 1) return MARGIN.left + chartW / 2;
    return MARGIN.left + (kwIdx / (n - 1)) * chartW;
  }

  function yPos(v: number): number {
    return MARGIN.top + chartH * (1 - v / chartData.maxY);
  }

  // Build stacked area paths
  let areaPaths = $derived.by(() => {
    const { kws, series, maxY } = chartData;
    if (!kws.length || !series.length) return [];

    const nKw = kws.length;
    // baselines[ki] = cumulative y0 at each kw index
    const baselines = new Array(nKw).fill(0);

    return series.map((sr, si) => {
      const tops: number[] = [];
      for (let ki = 0; ki < nKw; ki++) {
        let val = sr.values[ki];
        if (pctMode) {
          const colTotal = series.reduce((s, r) => s + r.values[ki], 0);
          val = colTotal > 0 ? (val / colTotal) * 100 : 0;
        }
        tops.push(baselines[ki] + val);
      }

      // Build SVG path: top line forward, bottom line backward
      const topPoints = tops.map((v, ki) => `${xPos(ki)},${yPos(v)}`);
      const botPoints = baselines.map((v, ki) => `${xPos(ki)},${yPos(v)}`).reverse();
      const path = `M${topPoints.join(' L')} L${botPoints.join(' L')} Z`;

      // Mid points for hover detection
      const midPoints = tops.map((v, ki) => ({
        x: xPos(ki), y: yPos((v + baselines[ki]) / 2),
        value: sr.values[ki],
        pct: pctMode ? (tops[ki] - baselines[ki]) : (series.reduce((s, r) => s + r.values[ki], 0) > 0 ? (sr.values[ki] / series.reduce((s, r) => s + r.values[ki], 0)) * 100 : 0),
        kw: kws[ki],
      }));

      // Update baselines
      for (let ki = 0; ki < nKw; ki++) baselines[ki] = tops[ki];

      return { cat: sr.cat, path, color: COLORS[si % COLORS.length], midPoints, bildId: sr.bildId };
    });
  });

  let yTicks = $derived(Array.from({ length: 6 }, (_, i) => {
    const val = (chartData.maxY / 5) * i;
    return { val, y: yPos(val) };
  }));

  onMount(() => {
    if (containerEl) {
      const ro = new ResizeObserver(entries => {
        for (const e of entries) { width = e.contentRect.width; height = Math.max(380, Math.min(560, e.contentRect.width * 0.5)); }
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
      <p class="text-[9px] font-semibold uppercase tracking-[0.12em] mb-1.5" style="color: var(--warm-400);">Werte</p>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
        {#each (['Kollektion', 'Artikel', 'Art', 'Preisgruppe', 'Kasse'] as const) as opt, i}
          <button onclick={() => valueField = opt}
            class="px-3 py-1.5 text-[11px] font-medium"
            style="background: {valueField === opt ? 'var(--accent)' : 'white'}; color: {valueField === opt ? 'white' : 'var(--warm-500)'}; {i > 0 ? 'border-left: 1px solid var(--warm-200)' : ''};">
            {opt === 'Art' ? 'Typ' : opt}
          </button>
        {/each}
      </div>
    </div>
    <div>
      <p class="text-[9px] font-semibold uppercase tracking-[0.12em] mb-1.5" style="color: var(--warm-400);">Y-Achse</p>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
        <button onclick={() => yMode = 'umsatz'} class="px-3 py-1.5 text-[11px] font-medium"
          style="background: {yMode === 'umsatz' ? 'var(--accent)' : 'white'}; color: {yMode === 'umsatz' ? 'white' : 'var(--warm-500)'};">Umsatz</button>
        <button onclick={() => yMode = 'anzahl'} class="px-3 py-1.5 text-[11px] font-medium"
          style="background: {yMode === 'anzahl' ? 'var(--accent)' : 'white'}; color: {yMode === 'anzahl' ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">Anzahl</button>
      </div>
    </div>
    <div>
      <p class="text-[9px] font-semibold uppercase tracking-[0.12em] mb-1.5" style="color: var(--warm-400);">Anzeigen</p>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
        {#each [10, 20, 30] as n, i}
          <button onclick={() => topN = n}
            class="px-3 py-1.5 text-[11px] font-medium"
            style="background: {topN === n ? 'var(--accent)' : 'white'}; color: {topN === n ? 'white' : 'var(--warm-500)'}; {i > 0 ? 'border-left: 1px solid var(--warm-200)' : ''};">
            Top {n}
          </button>
        {/each}
      </div>
    </div>
    <div>
      <p class="text-[9px] font-semibold uppercase tracking-[0.12em] mb-1.5" style="color: var(--warm-400);">Modus</p>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
        <button onclick={() => pctMode = false} class="px-3 py-1.5 text-[11px] font-medium"
          style="background: {!pctMode ? 'var(--accent)' : 'white'}; color: {!pctMode ? 'white' : 'var(--warm-500)'};">Absolut</button>
        <button onclick={() => pctMode = true} class="px-3 py-1.5 text-[11px] font-medium"
          style="background: {pctMode ? 'var(--accent)' : 'white'}; color: {pctMode ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">100%</button>
      </div>
    </div>
    <label class="flex items-center gap-2 cursor-pointer self-end pb-0.5">
      <input type="checkbox" bind:checked={hideSonstige} class="accent-[var(--accent)]" />
      <span class="text-[11px]" style="color: var(--warm-500);">Sonstige ausblenden</span>
    </label>
  </div>

  <!-- Chart -->
  <div bind:this={containerEl} class="w-full rounded-xl overflow-hidden" style="background: white; border: 1px solid var(--warm-200);">
    <svg {width} {height} style="font-family: var(--font-body);">
      <!-- Grid lines -->
      {#each yTicks as tick}
        <line x1={MARGIN.left} x2={MARGIN.left + chartW} y1={tick.y} y2={tick.y} stroke="var(--warm-100)" stroke-width="1" />
        <text x={MARGIN.left - 8} y={tick.y + 4} text-anchor="end" fill="var(--warm-400)" font-size="9">
          {pctMode ? tick.val.toFixed(0) + '%' : fmtVal(tick.val)}
        </text>
      {/each}

      <!-- Vertical KW lines -->
      {#each chartData.kws as kw, ki}
        {@const x = xPos(ki)}
        <line x1={x} x2={x} y1={MARGIN.top} y2={MARGIN.top + chartH} stroke="var(--warm-100)" stroke-width="0.5" />
        <text x={x} y={MARGIN.top + chartH + 20} text-anchor="middle" fill="var(--warm-500)" font-size="10" font-weight="500">{periodLabel(kw)}</text>
      {/each}

      <!-- Area paths (render bottom to top = last series first for correct layering) -->
      {#each areaPaths as area}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <path d={area.path} fill={area.color} opacity="0.7" stroke={area.color} stroke-width="0.5"
          style="transition: opacity 0.15s; cursor: pointer;"
          class:opacity-30={hoveredPoint !== null && hoveredPoint.cat !== area.cat}
          onmouseenter={() => {
            if (area.midPoints.length) {
              const mp = area.midPoints[Math.floor(area.midPoints.length / 2)];
              hoveredPoint = { x: mp.x, y: mp.y, kw: mp.kw, cat: area.cat, value: mp.value, pct: mp.pct };
            }
          }}
          onmouseleave={() => hoveredPoint = null} />
      {/each}

      <!-- Hover circles per KW for hovered series -->
      {#if hoveredPoint}
        {#each areaPaths.find(a => a.cat === hoveredPoint?.cat)?.midPoints || [] as mp}
          <circle cx={mp.x} cy={mp.y} r="3" fill="white" stroke={areaPaths.find(a => a.cat === hoveredPoint?.cat)?.color || '#999'} stroke-width="1.5" />
        {/each}
      {/if}

      <!-- Y axis label -->
      <text x={12} y={height / 2} text-anchor="middle" fill="var(--warm-400)" font-size="10" font-weight="500"
        transform="rotate(-90 12 {height / 2})">{pctMode ? 'Anteil %' : yMode === 'umsatz' ? 'Umsatz (\u20ac)' : 'Anzahl'}</text>

      <!-- Legend (right side) -->
      {#each areaPaths as area, i}
        {#if valueField === 'Artikel' && area.bildId}
          <image href={imgUrl(area.bildId, 40)} x={MARGIN.left + chartW + 10} y={MARGIN.top + i * 20 - 2} width="14" height="14" clip-path="inset(0 round 3px)" />
          <text x={MARGIN.left + chartW + 28} y={MARGIN.top + i * 20 + 10} fill="var(--warm-600)" font-size="8">
            {fmtVal(area.midPoints.reduce((s, m) => s + m.value, 0))}
          </text>
        {:else}
          <rect x={MARGIN.left + chartW + 10} y={MARGIN.top + i * 20} width="10" height="10" rx="2" fill={area.color} />
          <text x={MARGIN.left + chartW + 24} y={MARGIN.top + i * 20 + 9} fill="var(--warm-600)" font-size="8">
            {area.cat.length > 16 ? area.cat.slice(0, 14) + '\u2026' : area.cat}
          </text>
        {/if}
      {/each}

      <!-- Tooltip -->
      {#if hoveredPoint}
        {@const tx = Math.min(Math.max(hoveredPoint.x - 75, 5), width - 170)}
        {@const ty = Math.max(hoveredPoint.y - 62, 5)}
        <rect x={tx} y={ty} width="155" height="54" rx="8" fill="var(--warm-800)" fill-opacity="0.92" />
        <text x={tx + 10} y={ty + 16} fill="white" font-size="10" font-weight="600">
          {hoveredPoint.cat === 'Sonstige' ? 'Sonstige' : hoveredPoint.cat.length > 20 ? hoveredPoint.cat.slice(0, 18) + '\u2026' : hoveredPoint.cat}
        </text>
        <text x={tx + 10} y={ty + 32} fill="var(--warm-300)" font-size="9">{periodLabel(hoveredPoint.kw)}</text>
        <text x={tx + 10} y={ty + 46} fill="var(--warm-300)" font-size="9">{fmtVal(hoveredPoint.value)} ({hoveredPoint.pct.toFixed(1)}%)</text>
      {/if}
    </svg>
  </div>
</div>
