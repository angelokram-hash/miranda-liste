<script lang="ts">
  import { onMount } from 'svelte';

  interface RawRow {
    Kollektion: string; BildId: string; Anzahl: number; EinzelPreis: number;
    Form: string; Kasse: string; Art: string;
  }

  let { data = [] }: { data: RawRow[] } = $props();

  type ValueField = 'Kollektion' | 'FormPfad' | 'Preisgruppe' | 'Kasse';
  type SubField = 'Kollektion' | 'FormPfad' | 'Preisgruppe' | '';

  let valueField = $state<ValueField>('Kollektion');
  let subField = $state<SubField>('FormPfad');
  let yMode = $state<'umsatz' | 'anzahl'>('umsatz');
  let hoveredSlice = $state<{ label: string; value: number; pct: number; x: number; y: number; sub?: string } | null>(null);
  let containerEl: HTMLDivElement | undefined = $state();
  let size = $state(500);

  const COLORS = [
    '#b07c3e','#6b8e5a','#5a7ea8','#c06050','#8a6ab0','#c09050',
    '#4a8a8a','#b05a80','#7a7a4a','#508ab0','#a06a40','#6a9a6a',
    '#9a5a9a','#4a6a9a','#b08a60','#5a9a80','#9a7a5a','#6a5a8a',
    '#7ab05a','#b0505a','#5a5ab0','#8ab060','#b07060','#607ab0',
  ];

  const SUB_COLORS = [
    '#d4a76a','#8bb47a','#7a9ec8','#d88070','#a88ac0','#d0b070',
    '#6aaaa0','#d07a98','#9a9a6a','#70aac8','#c08a60','#8aba8a',
    '#ba7aba','#6a8aba','#d0aa80','#7abaa0','#baa07a','#8a7aaa',
    '#9ac07a','#c0707a','#7a7ac0','#aac080','#c09080','#80aac0',
  ];

  function getFieldVal(r: RawRow, field: string): string {
    if (field === 'FormPfad') return ((r.Form || '').trim().split(/\s+/)[0]) || '(leer)';
    if (field === 'Preisgruppe') {
      const ep = Number(r.EinzelPreis) || 0;
      if (ep < 20) return '0–20€'; if (ep < 50) return '20–50€'; if (ep < 120) return '50–120€'; if (ep < 250) return '120–250€'; return '250€+';
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

  interface Slice { label: string; value: number; pct: number; startAngle: number; endAngle: number; color: string; }

  function buildSlices(rows: RawRow[], field: string, colors: string[]): Slice[] {
    const map = new Map<string, number>();
    for (const r of rows) {
      const k = getFieldVal(r, field);
      map.set(k, (map.get(k) || 0) + getRowVal(r));
    }
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, e) => s + e[1], 0);
    let angle = -Math.PI / 2;
    return sorted.map(([label, value], i) => {
      const pct = total > 0 ? (value / total) * 100 : 0;
      const sweep = (pct / 100) * Math.PI * 2;
      const slice: Slice = { label, value, pct, startAngle: angle, endAngle: angle + sweep, color: colors[i % colors.length] };
      angle += sweep;
      return slice;
    });
  }

  let outerSlices = $derived(buildSlices(data, valueField, COLORS));

  let innerSlices = $derived.by(() => {
    if (!subField) return [];
    return buildSlices(data, subField, SUB_COLORS);
  });

  let cx = $derived(size / 2);
  let cy = $derived(size / 2);
  let outerR = $derived(size * 0.40);
  let outerInnerR = $derived(size * 0.26);
  let innerR = $derived(subField ? size * 0.23 : 0);
  let innerInnerR = $derived(size * 0.10);

  function arcPath(cxv: number, cyv: number, r: number, rInner: number, start: number, end: number): string {
    const clamp = Math.min(end - start, Math.PI * 2 - 0.001);
    const actualEnd = start + clamp;
    const x1 = cxv + r * Math.cos(start);
    const y1 = cyv + r * Math.sin(start);
    const x2 = cxv + r * Math.cos(actualEnd);
    const y2 = cyv + r * Math.sin(actualEnd);
    const x3 = cxv + rInner * Math.cos(actualEnd);
    const y3 = cyv + rInner * Math.sin(actualEnd);
    const x4 = cxv + rInner * Math.cos(start);
    const y4 = cyv + rInner * Math.sin(start);
    const large = clamp > Math.PI ? 1 : 0;
    return `M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${x3},${y3} A${rInner},${rInner} 0 ${large},0 ${x4},${y4} Z`;
  }

  function midAngle(s: Slice): { x: number; y: number } {
    const mid = (s.startAngle + s.endAngle) / 2;
    const r = (outerR + outerInnerR) / 2;
    return { x: cx + r * Math.cos(mid), y: cy + r * Math.sin(mid) };
  }

  onMount(() => {
    if (containerEl) {
      const ro = new ResizeObserver(entries => {
        for (const e of entries) { size = Math.min(560, Math.max(320, e.contentRect.width * 0.65)); }
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
      <p class="text-[9px] font-semibold uppercase tracking-[0.12em] mb-1.5" style="color: var(--warm-400);">Werte (außen)</p>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
        {#each (['Kollektion', 'FormPfad', 'Preisgruppe', 'Kasse'] as const) as opt, i}
          <button onclick={() => valueField = opt}
            class="px-3 py-1.5 text-[11px] font-medium"
            style="background: {valueField === opt ? 'var(--accent)' : 'white'}; color: {valueField === opt ? 'white' : 'var(--warm-500)'}; {i > 0 ? 'border-left: 1px solid var(--warm-200)' : ''};">
            {opt}
          </button>
        {/each}
      </div>
    </div>
    <div>
      <p class="text-[9px] font-semibold uppercase tracking-[0.12em] mb-1.5" style="color: var(--warm-400);">Unterwerte (innen)</p>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
        {#each ([['', '— keine —'], ['Kollektion', 'Kollektion'], ['FormPfad', 'FormPfad'], ['Preisgruppe', 'Preisgruppe']] as const) as [val, label], i}
          <button onclick={() => subField = val as SubField}
            class="px-3 py-1.5 text-[11px] font-medium"
            style="background: {subField === val ? 'var(--accent)' : 'white'}; color: {subField === val ? 'white' : 'var(--warm-500)'}; {i > 0 ? 'border-left: 1px solid var(--warm-200)' : ''};">
            {label}
          </button>
        {/each}
      </div>
    </div>
    <div>
      <p class="text-[9px] font-semibold uppercase tracking-[0.12em] mb-1.5" style="color: var(--warm-400);">Wert</p>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
        <button onclick={() => yMode = 'umsatz'} class="px-3 py-1.5 text-[11px] font-medium"
          style="background: {yMode === 'umsatz' ? 'var(--accent)' : 'white'}; color: {yMode === 'umsatz' ? 'white' : 'var(--warm-500)'};">Umsatz</button>
        <button onclick={() => yMode = 'anzahl'} class="px-3 py-1.5 text-[11px] font-medium"
          style="background: {yMode === 'anzahl' ? 'var(--accent)' : 'white'}; color: {yMode === 'anzahl' ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">Anzahl</button>
      </div>
    </div>
  </div>

  <!-- Chart + Legend side by side -->
  <div bind:this={containerEl} class="flex flex-wrap gap-6 items-start">
    <div class="rounded-xl overflow-hidden p-4" style="background: white; border: 1px solid var(--warm-200);">
      <svg width={size} height={size} style="font-family: var(--font-body);">
        <!-- Outer ring -->
        {#each outerSlices as slice}
          {@const path = arcPath(cx, cy, outerR, outerInnerR, slice.startAngle, slice.endAngle)}
          {@const mid = midAngle(slice)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <path d={path} fill={slice.color}
            style="cursor: pointer; transition: opacity 0.15s;"
            opacity={hoveredSlice && hoveredSlice.label !== slice.label ? 0.4 : 0.85}
            stroke="white" stroke-width="1.5"
            onmouseenter={() => hoveredSlice = { label: slice.label, value: slice.value, pct: slice.pct, x: mid.x, y: mid.y }}
            onmouseleave={() => hoveredSlice = null} />
          {#if slice.pct > 5}
            <text x={mid.x} y={mid.y + 3} text-anchor="middle" fill="white" font-size="8" font-weight="600" style="pointer-events: none;">
              {slice.label.length > 8 ? slice.label.slice(0, 7) + '…' : slice.label}
            </text>
          {/if}
        {/each}

        <!-- Inner ring -->
        {#if subField}
          {#each innerSlices as slice}
            {@const path = arcPath(cx, cy, innerR, innerInnerR, slice.startAngle, slice.endAngle)}
            {@const midA = (slice.startAngle + slice.endAngle) / 2}
            {@const midR = (innerR + innerInnerR) / 2}
            {@const mx = cx + midR * Math.cos(midA)}
            {@const my = cy + midR * Math.sin(midA)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <path d={path} fill={slice.color}
              style="cursor: pointer; transition: opacity 0.15s;"
              opacity={hoveredSlice?.sub === 'inner' && hoveredSlice?.label !== slice.label ? 0.4 : 0.75}
              stroke="white" stroke-width="1"
              onmouseenter={() => hoveredSlice = { label: slice.label, value: slice.value, pct: slice.pct, x: mx, y: my, sub: 'inner' }}
              onmouseleave={() => hoveredSlice = null} />
          {/each}
        {/if}

        <!-- Center label -->
        <text x={cx} y={cy - 4} text-anchor="middle" fill="var(--warm-500)" font-size="10" font-weight="500">{valueField}</text>
        {#if subField}
          <text x={cx} y={cy + 10} text-anchor="middle" fill="var(--warm-400)" font-size="8">/ {subField}</text>
        {/if}

        <!-- Tooltip -->
        {#if hoveredSlice}
          {@const tx = Math.min(Math.max(hoveredSlice.x - 70, 5), size - 150)}
          {@const ty = Math.max(hoveredSlice.y - 52, 5)}
          <rect x={tx} y={ty} width="145" height="46" rx="8" fill="var(--warm-800)" fill-opacity="0.92" />
          <text x={tx + 10} y={ty + 17} fill="white" font-size="10" font-weight="600">{hoveredSlice.label}</text>
          <text x={tx + 10} y={ty + 34} fill="var(--warm-300)" font-size="9">{fmtVal(hoveredSlice.value)} · {hoveredSlice.pct.toFixed(1)}%</text>
        {/if}
      </svg>
    </div>

    <!-- Legend -->
    <div class="space-y-3">
      <div>
        <p class="text-[9px] font-semibold uppercase tracking-[0.12em] mb-1.5" style="color: var(--warm-400);">{valueField} (außen)</p>
        <div class="space-y-0.5">
          {#each outerSlices.slice(0, 16) as slice, i}
            <div class="flex items-center gap-2 text-[10px]" style="color: var(--warm-600);">
              <span class="w-2.5 h-2.5 rounded-sm flex-shrink-0" style="background: {slice.color};"></span>
              <span class="truncate" style="max-width: 140px;">{slice.label}</span>
              <span class="tabular-nums ml-auto" style="color: var(--warm-400);">{slice.pct.toFixed(1)}%</span>
            </div>
          {/each}
          {#if outerSlices.length > 16}
            <p class="text-[9px]" style="color: var(--warm-400);">+{outerSlices.length - 16} weitere</p>
          {/if}
        </div>
      </div>
      {#if subField && innerSlices.length > 0}
        <div>
          <p class="text-[9px] font-semibold uppercase tracking-[0.12em] mb-1.5" style="color: var(--warm-400);">{subField} (innen)</p>
          <div class="space-y-0.5">
            {#each innerSlices.slice(0, 10) as slice}
              <div class="flex items-center gap-2 text-[10px]" style="color: var(--warm-600);">
                <span class="w-2.5 h-2.5 rounded-sm flex-shrink-0" style="background: {slice.color};"></span>
                <span class="truncate" style="max-width: 140px;">{slice.label}</span>
                <span class="tabular-nums ml-auto" style="color: var(--warm-400);">{slice.pct.toFixed(1)}%</span>
              </div>
            {/each}
            {#if innerSlices.length > 10}
              <p class="text-[9px]" style="color: var(--warm-400);">+{innerSlices.length - 10} weitere</p>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
