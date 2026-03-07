<script lang="ts">
  import { onMount } from 'svelte';

  interface RawRow {
    Kollektion: string; BildId: string; Anzahl: number; EinzelPreis: number;
    Form: string; Kasse: string; Art: string;
  }

  let { data = [], hideEuro = false }: { data: RawRow[]; hideEuro?: boolean } = $props();

  type XField = 'FormPfad' | 'Form' | 'Channel';
  type ValMode = 'anzahl' | 'umsatz';

  let xField = $state<XField>('FormPfad');
  let valMode = $state<ValMode>('umsatz');
  let hoveredBubble = $state<{ label: string; x: number; y: number; val: number; preis: number; anzahl: number } | null>(null);
  let containerEl: HTMLDivElement | undefined = $state();
  let width = $state(900);
  let height = $state(600);

  const MARGIN = { top: 40, right: 30, bottom: 100, left: 70 };

  // Color palette for categories
  const COLORS = [
    '#b07c3e','#6b8e5a','#5a7ea8','#c06050','#8a6ab0','#c09050',
    '#4a8a8a','#b05a80','#7a7a4a','#508ab0','#a06a40','#6a9a6a',
    '#9a5a9a','#4a6a9a','#b08a60','#5a9a80','#9a7a5a','#6a5a8a',
  ];

  interface Bubble {
    label: string;
    xCategory: string;
    avgPreis: number;
    value: number;    // anzahl or umsatz
    anzahl: number;
    umsatz: number;
    color: string;
  }

  function getFormPfad(form: string): string {
    return (form || '').trim().split(/\s+/)[0] || '(leer)';
  }

  let bubbles = $derived.by(() => {
    if (!data.length) return [];

    // Group by xField
    const groups = new Map<string, { anzahl: number; umsatz: number; totalPreis: number }>();
    for (const r of data) {
      let key: string;
      if (xField === 'FormPfad') key = getFormPfad(r.Form);
      else if (xField === 'Form') key = r.Form || '(leer)';
      else key = (r as any).Channel || r.Kasse || '(leer)';

      if (!groups.has(key)) groups.set(key, { anzahl: 0, umsatz: 0, totalPreis: 0 });
      const g = groups.get(key)!;
      const an = Number(r.Anzahl) || 0;
      const ep = Number(r.EinzelPreis) || 0;
      g.anzahl += an;
      g.umsatz += ep * an;
      g.totalPreis += ep * an;
    }

    const categories = Array.from(groups.keys()).sort((a, b) => {
      const ga = groups.get(a)!, gb = groups.get(b)!;
      return gb.umsatz - ga.umsatz;
    });

    // Assign colors
    const colorMap = new Map<string, string>();
    categories.forEach((c, i) => colorMap.set(c, COLORS[i % COLORS.length]));

    return categories.map(label => {
      const g = groups.get(label)!;
      return {
        label,
        xCategory: label,
        avgPreis: g.anzahl > 0 ? g.umsatz / g.anzahl : 0,
        value: valMode === 'umsatz' ? g.umsatz : g.anzahl,
        anzahl: g.anzahl,
        umsatz: g.umsatz,
        color: colorMap.get(label)!,
      } satisfies Bubble;
    });
  });

  // Scales
  let chartW = $derived(width - MARGIN.left - MARGIN.right);
  let chartH = $derived(height - MARGIN.top - MARGIN.bottom);

  let xCategories = $derived(bubbles.map(b => b.xCategory));
  let maxPreis = $derived(Math.max(...bubbles.map(b => b.avgPreis), 1));
  let maxVal = $derived(Math.max(...bubbles.map(b => b.value), 1));

  function scaleX(cat: string): number {
    const idx = xCategories.indexOf(cat);
    if (idx < 0) return 0;
    const step = chartW / (xCategories.length || 1);
    return MARGIN.left + step * idx + step / 2;
  }

  function scaleY(preis: number): number {
    const t = preis / maxPreis;
    return MARGIN.top + chartH * (1 - t);
  }

  function scaleR(val: number): number {
    const minR = 6, maxR = Math.min(chartW, chartH) * 0.08;
    return minR + (maxR - minR) * Math.sqrt(val / maxVal);
  }

  // Y axis ticks
  let yTicks = $derived.by(() => {
    const steps = [0, 0.25, 0.5, 0.75, 1];
    return steps.map(s => ({ val: s * maxPreis, y: scaleY(s * maxPreis) }));
  });

  let fmtEUR = $derived.by(() => hideEuro
    ? (_: number) => '\u2022\u2022\u2022'
    : (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }));
  let fmtNum = $derived.by(() => hideEuro
    ? (_: number) => '\u2022\u2022\u2022'
    : (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 0 }));

  onMount(() => {
    if (containerEl) {
      const ro = new ResizeObserver(entries => {
        for (const e of entries) { width = e.contentRect.width; height = Math.max(400, Math.min(700, e.contentRect.width * 0.6)); }
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
        {#each (['FormPfad', 'Form', 'Channel'] as const) as opt}
          <button onclick={() => xField = opt}
            class="px-3 py-1.5 text-[11px] font-medium"
            style="background: {xField === opt ? 'var(--accent)' : 'white'}; color: {xField === opt ? 'white' : 'var(--warm-500)'}; {opt !== 'FormPfad' ? 'border-left: 1px solid var(--warm-200)' : ''};">
            {opt}
          </button>
        {/each}
      </div>
    </div>
    <div>
      <p class="text-[9px] font-semibold uppercase tracking-[0.12em] mb-1.5" style="color: var(--warm-400);">Y-Achse</p>
      <div class="px-3 py-1.5 rounded-lg text-[11px] font-medium" style="background: var(--warm-100); color: var(--warm-500);">⌀ Preis (EinzelPreis)</div>
    </div>
    <div>
      <p class="text-[9px] font-semibold uppercase tracking-[0.12em] mb-1.5" style="color: var(--warm-400);">Blasengröße</p>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
        <button onclick={() => valMode = 'anzahl'}
          class="px-3 py-1.5 text-[11px] font-medium"
          style="background: {valMode === 'anzahl' ? 'var(--accent)' : 'white'}; color: {valMode === 'anzahl' ? 'white' : 'var(--warm-500)'};">
          Anzahl
        </button>
        <button onclick={() => valMode = 'umsatz'}
          class="px-3 py-1.5 text-[11px] font-medium"
          style="background: {valMode === 'umsatz' ? 'var(--accent)' : 'white'}; color: {valMode === 'umsatz' ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">
          Umsatz
        </button>
      </div>
    </div>
  </div>

  <!-- Chart -->
  <div bind:this={containerEl} class="w-full rounded-xl overflow-hidden" style="background: white; border: 1px solid var(--warm-200);">
    <svg {width} {height} style="font-family: var(--font-body);">
      <!-- Grid lines -->
      {#each yTicks as tick}
        <line x1={MARGIN.left} x2={width - MARGIN.right} y1={tick.y} y2={tick.y}
          stroke="var(--warm-100)" stroke-width="1" />
        <text x={MARGIN.left - 8} y={tick.y + 4} text-anchor="end"
          fill="var(--warm-400)" font-size="10">{fmtEUR(tick.val)}</text>
      {/each}

      <!-- X axis labels -->
      {#each bubbles as b, i}
        {@const x = scaleX(b.xCategory)}
        <text x={x} y={height - MARGIN.bottom + 18} text-anchor="end"
          fill="var(--warm-500)" font-size="10"
          transform="rotate(-40 {x} {height - MARGIN.bottom + 18})">
          {b.label.length > 18 ? b.label.slice(0, 16) + '…' : b.label}
        </text>
      {/each}

      <!-- Axis labels -->
      <text x={width / 2} y={height - 8} text-anchor="middle"
        fill="var(--warm-400)" font-size="11" font-weight="500">{xField}</text>
      <text x={14} y={height / 2} text-anchor="middle"
        fill="var(--warm-400)" font-size="11" font-weight="500"
        transform="rotate(-90 14 {height / 2})">⌀ Preis</text>

      <!-- Bubbles -->
      {#each bubbles as b}
        {@const cx = scaleX(b.xCategory)}
        {@const cy = scaleY(b.avgPreis)}
        {@const r = scaleR(b.value)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <circle {cx} {cy} {r}
          fill={b.color} fill-opacity="0.65" stroke={b.color} stroke-width="1.5"
          style="cursor: pointer; transition: all 0.2s ease;"
          onmouseenter={() => hoveredBubble = { label: b.label, x: cx, y: cy, val: b.value, preis: b.avgPreis, anzahl: b.anzahl }}
          onmouseleave={() => hoveredBubble = null} />
        {#if r > 18}
          <text x={cx} y={cy + 3} text-anchor="middle" fill="white" font-size="9" font-weight="600"
            style="pointer-events: none;">
            {b.label.length > 10 ? b.label.slice(0, 8) + '…' : b.label}
          </text>
        {/if}
      {/each}

      <!-- Tooltip -->
      {#if hoveredBubble}
        {@const tx = Math.min(hoveredBubble.x + 15, width - 180)}
        {@const ty = Math.max(hoveredBubble.y - 60, 10)}
        <rect x={tx} y={ty} width="170" height="72" rx="8"
          fill="var(--warm-800)" fill-opacity="0.92" />
        <text x={tx + 12} y={ty + 18} fill="white" font-size="11" font-weight="600">{hoveredBubble.label}</text>
        <text x={tx + 12} y={ty + 34} fill="var(--warm-300)" font-size="10">⌀ Preis: {fmtEUR(hoveredBubble.preis)}</text>
        <text x={tx + 12} y={ty + 48} fill="var(--warm-300)" font-size="10">Anzahl: {fmtNum(hoveredBubble.anzahl)}</text>
        <text x={tx + 12} y={ty + 62} fill="var(--warm-300)" font-size="10">{valMode === 'umsatz' ? 'Umsatz' : 'Stück'}: {valMode === 'umsatz' ? fmtEUR(hoveredBubble.val) : fmtNum(hoveredBubble.val)}</text>
      {/if}
    </svg>
  </div>
</div>
