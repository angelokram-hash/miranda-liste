<script lang="ts">
  interface RawRow {
    Kollektion: string; BildId: string; Anzahl: number; EinzelPreis: number;
    Form: string; Kasse: string; Art: string; Nr: string; KW: string; Monat: string;
  }

  let { data = [] }: { data: RawRow[] } = $props();

  function imgUrl(bid: string, sz: number): string {
    return `https://konplott-cdn.com/mytism/image/${bid}/${bid}.jpg?width=${sz}&height=${sz}&box=true`;
  }
  function fmtEUR(v: number): string { return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }); }
  function fmtNum(v: number): string { return v.toLocaleString('de-DE', { maximumFractionDigits: 0 }); }

  const COLORS = ['#b07c3e','#6b8e5a','#5a7ea8','#c06050','#8a6ab0','#c09050','#4a8a8a','#b05a80','#7a7a4a','#508ab0','#a06a40','#6a9a6a'];

  // ── Top Artikel ──
  interface TopArt { bildId: string; nr: string; umsatz: number; anzahl: number; topShops: { name: string; anzahl: number }[]; }
  let artShowAll = $state(false);
  let topArticles = $derived.by((): TopArt[] => {
    const m = new Map<string, { nr: string; umsatz: number; anzahl: number; kassen: Map<string, number> }>();
    for (const r of data) {
      const bid = String(r.BildId);
      if (!bid || bid === '0') continue;
      if (!m.has(bid)) m.set(bid, { nr: String(r.Nr || ''), umsatz: 0, anzahl: 0, kassen: new Map() });
      const a = m.get(bid)!;
      const an = Number(r.Anzahl) || 0;
      a.umsatz += (Number(r.EinzelPreis) || 0) * an;
      a.anzahl += an;
      a.kassen.set(r.Kasse, (a.kassen.get(r.Kasse) || 0) + an);
    }
    return [...m.entries()].map(([bildId, a]) => ({
      bildId, nr: a.nr, umsatz: a.umsatz, anzahl: a.anzahl,
      topShops: [...a.kassen.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([name, anzahl]) => ({ name, anzahl })),
    })).sort((a, b) => b.umsatz - a.umsatz).slice(0, 30);
  });

  // ── Top 10 Kollektionen ──
  interface TopKoll { name: string; umsatz: number; anzahl: number; anteil: number; }
  let top10Koll = $derived.by((): TopKoll[] => {
    const m = new Map<string, { umsatz: number; anzahl: number }>();
    let total = 0;
    for (const r of data) {
      const k = r.Kollektion;
      if (!m.has(k)) m.set(k, { umsatz: 0, anzahl: 0 });
      const a = m.get(k)!;
      const an = Number(r.Anzahl) || 0;
      const u = (Number(r.EinzelPreis) || 0) * an;
      a.umsatz += u; a.anzahl += an; total += u;
    }
    return [...m.entries()].map(([name, a]) => ({ name, ...a, anteil: total > 0 ? (a.umsatz / total) * 100 : 0 })).sort((a, b) => b.umsatz - a.umsatz).slice(0, 10);
  });

  // ── Top 3 Kollektionen pro Typ ──
  interface TypTop { typ: string; kolls: { name: string; umsatz: number }[]; totalUmsatz: number; }
  let top3ByTyp = $derived.by((): TypTop[] => {
    const typMap = new Map<string, Map<string, number>>();
    const typTotal = new Map<string, number>();
    for (const r of data) {
      const typ = r.Art || '(keine)';
      const koll = r.Kollektion;
      if (!typMap.has(typ)) typMap.set(typ, new Map());
      const km = typMap.get(typ)!;
      const u = (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0);
      km.set(koll, (km.get(koll) || 0) + u);
      typTotal.set(typ, (typTotal.get(typ) || 0) + u);
    }
    return [...typMap.entries()]
      .map(([typ, km]) => ({
        typ,
        totalUmsatz: typTotal.get(typ) || 0,
        kolls: [...km.entries()].map(([name, umsatz]) => ({ name, umsatz })).sort((a, b) => b.umsatz - a.umsatz).slice(0, 3),
      }))
      .sort((a, b) => b.totalUmsatz - a.totalUmsatz)
      .filter(t => t.totalUmsatz > 0);
  });

  // ── Top 4 Kollektionen pro KW (excl. Classics & Basic) ──
  interface KwTop { kw: string; kolls: { name: string; umsatz: number; color: string }[]; }
  let kwTopKolls = $derived.by((): KwTop[] => {
    const filtered = data.filter(r => r.Art !== 'Classics' && r.Art !== 'Basic');
    const kwMap = new Map<string, Map<string, number>>();
    for (const r of filtered) {
      const kw = r.KW;
      if (!kwMap.has(kw)) kwMap.set(kw, new Map());
      const km = kwMap.get(kw)!;
      km.set(r.Kollektion, (km.get(r.Kollektion) || 0) + (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0));
    }
    // Collect all top kolls to assign consistent colors
    const allTopKolls = new Set<string>();
    for (const km of kwMap.values()) {
      const sorted = [...km.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      for (const [name] of sorted) allTopKolls.add(name);
    }
    const kollColorMap = new Map<string, string>();
    let ci = 0;
    for (const k of allTopKolls) { kollColorMap.set(k, COLORS[ci % COLORS.length]); ci++; }

    return [...kwMap.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([kw, km]) => ({
        kw,
        kolls: [...km.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
          .map(([name, umsatz]) => ({ name, umsatz, color: kollColorMap.get(name) || '#999' })),
      }));
  });

  // ── Shop Umsatzverlauf pro KW ──
  interface ShopKw { kw: string; shops: { name: string; umsatz: number }[]; }
  let shopTrend = $derived.by(() => {
    const kwShopMap = new Map<string, Map<string, number>>();
    const shopTotals = new Map<string, number>();
    for (const r of data) {
      const kw = r.KW;
      const shop = r.Kasse;
      if (!kwShopMap.has(kw)) kwShopMap.set(kw, new Map());
      const sm = kwShopMap.get(kw)!;
      const u = (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0);
      sm.set(shop, (sm.get(shop) || 0) + u);
      shopTotals.set(shop, (shopTotals.get(shop) || 0) + u);
    }
    // Top 10 shops by total
    const topShops = [...shopTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
    const kws = [...kwShopMap.keys()].sort((a, b) => Number(a) - Number(b));

    return { kws, topShops, data: kws.map(kw => {
      const sm = kwShopMap.get(kw)!;
      return topShops.map(shop => sm.get(shop) || 0);
    }) };
  });

  // Mini line chart helpers
  function miniPath(values: number[], w: number, h: number, pad: number): string {
    if (values.length < 2) return '';
    const max = Math.max(...values, 1);
    return values.map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2);
      const y = pad + (1 - v / max) * (h - pad * 2);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    }).join(' ');
  }

  // Treemaps
  type TreemapField = 'Kollektion' | 'FormPfad' | 'Artikel';
  let tmField = $state<TreemapField>('Kollektion');
  let tmTop20 = $state(false);
  let tmHideSonstige = $state(false);
  interface TmNode { label: string; value: number; bildId: string; }
  let treemapNodes = $derived.by((): TmNode[] => {
    const m = new Map<string, { value: number; bildId: string }>();
    for (const r of data) {
      let key: string; let bildId = '';
      if (tmField === 'Artikel') { const bid = String(r.BildId); if (!bid || bid === '0') continue; key = bid; bildId = bid; }
      else { key = (r as any)[tmField] || '(leer)'; }
      if (!m.has(key)) m.set(key, { value: 0, bildId });
      const a = m.get(key)!;
      a.value += (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0);
      if (!a.bildId && bildId) a.bildId = bildId;
    }
    let nodes = [...m.entries()].map(([label, a]) => ({ label, value: a.value, bildId: a.bildId })).sort((a, b) => b.value - a.value);
    const limit = tmTop20 ? 20 : nodes.length;
    if (nodes.length > limit) {
      const top = nodes.slice(0, limit);
      if (!tmHideSonstige) { const sv = nodes.slice(limit).reduce((s, n) => s + n.value, 0); if (sv > 0) top.push({ label: 'Sonstige', value: sv, bildId: '' }); }
      nodes = top;
    }
    return nodes;
  });
  function layoutTreemap(nodes: TmNode[], w: number, h: number): { x: number; y: number; w: number; h: number; node: TmNode }[] {
    const total = nodes.reduce((s, n) => s + n.value, 0);
    if (total <= 0 || !nodes.length) return [];
    const rects: { x: number; y: number; w: number; h: number; node: TmNode }[] = [];
    let cx = 0, cy = 0, rw = w, rh = h, remaining = [...nodes], remTotal = total;
    while (remaining.length > 0) {
      const isWide = rw >= rh; const side = isWide ? rh : rw;
      let row: TmNode[] = [], rowTotal = 0;
      for (const n of remaining) {
        const worstOld = row.length > 0 ? wRatio(row, rowTotal, side, remTotal) : Infinity;
        const worstNew = wRatio([...row, n], rowTotal + n.value, side, remTotal);
        if (row.length === 0 || worstNew <= worstOld) { row.push(n); rowTotal += n.value; } else break;
      }
      const stripSize = isWide ? rw * (rowTotal / remTotal) : rh * (rowTotal / remTotal);
      let offset = 0;
      for (const n of row) {
        const cellSize = side * (n.value / rowTotal);
        if (isWide) rects.push({ x: cx, y: cy + offset, w: stripSize, h: cellSize, node: n });
        else rects.push({ x: cx + offset, y: cy, w: cellSize, h: stripSize, node: n });
        offset += cellSize;
      }
      if (isWide) { cx += stripSize; rw -= stripSize; } else { cy += stripSize; rh -= stripSize; }
      remaining = remaining.slice(row.length); remTotal -= rowTotal;
    }
    return rects;
  }
  function wRatio(row: TmNode[], rowTotal: number, side: number, remTotal: number): number {
    const ss = (rowTotal / remTotal) * side; if (ss <= 0) return Infinity;
    let worst = 0;
    for (const n of row) { const cs = (n.value / rowTotal) * side; const r = Math.max(ss / cs, cs / ss); if (r > worst) worst = r; }
    return worst;
  }
</script>

<div class="space-y-6">
  <!-- Row 1: Top Artikel -->
  <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-xs font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">Top {artShowAll ? 30 : 10} Artikel</h3>
      <button onclick={() => artShowAll = !artShowAll} class="text-[10px] font-medium px-3 py-1 rounded-lg" style="color: var(--accent); border: 1px solid var(--warm-200);">
        {artShowAll ? 'Weniger' : 'Top 30 zeigen'}
      </button>
    </div>
    <div class="overflow-y-auto" style="max-height: {artShowAll ? '420px' : '210px'};">
      <div class="flex flex-wrap gap-3 content-start">
        {#each (artShowAll ? topArticles : topArticles.slice(0, 10)) as art, i}
          <div class="flex-shrink-0 w-24">
            <div class="relative">
              <div class="w-24 h-24 rounded-xl overflow-hidden shadow-sm" style="border: 1.5px solid var(--warm-200);">
                <img src={imgUrl(art.bildId, 200)} alt="" class="w-full h-full object-cover" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
              </div>
              <div class="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" style="background: var(--accent); color: white;">
                {i + 1}
              </div>
            </div>
            <div class="mt-1.5 text-center">
              <p class="text-[10px] font-semibold tabular-nums" style="color: var(--warm-700);">{fmtEUR(art.umsatz)}</p>
              <p class="text-[9px] tabular-nums" style="color: var(--warm-400);">{fmtNum(art.anzahl)} Stk</p>
              {#if art.nr}<a href="https://www.konplott.com/go/{art.nr}" target="_blank" rel="noopener" class="text-[8px] underline" style="color: var(--accent);">Shop ↗</a>{/if}
            </div>
            <div class="mt-1 space-y-0">
              {#each art.topShops as shop}
                <p class="text-[8px] truncate" style="color: var(--warm-400);" title={shop.name}>{shop.name} ({shop.anzahl})</p>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- Treemaps -->
  <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
    <div class="flex flex-wrap items-center gap-4 mb-3">
      <h3 class="text-xs font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">Treemap</h3>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
        {#each (["Kollektion", "FormPfad", "Artikel"] as const) as opt, i}
          <button onclick={() => tmField = opt} class="px-3 py-1 text-[11px] font-medium"
            style="background: {tmField === opt ? "var(--accent)" : "white"}; color: {tmField === opt ? "white" : "var(--warm-500)"}; {i > 0 ? "border-left: 1px solid var(--warm-200)" : ""};">
            {opt}
          </button>
        {/each}
      </div>
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" bind:checked={tmTop20} class="accent-[var(--accent)]" />
        <span class="text-[11px]" style="color: var(--warm-500);">Nur Top 20</span>
      </label>
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" bind:checked={tmHideSonstige} class="accent-[var(--accent)]" />
        <span class="text-[11px]" style="color: var(--warm-500);">Sonstige ausblenden</span>
      </label>
    </div>
    {#if true}
    {@const tmW = 900}
    {@const tmH = 420}
    {@const rects = layoutTreemap(treemapNodes, tmW, tmH)}
    {@const tmTotal = treemapNodes.reduce((s, n) => s + n.value, 0)}
    <div class="overflow-x-auto">
      <svg viewBox="0 0 {tmW} {tmH}" class="w-full" style="max-height: 460px;">
        {#each rects as rect, i}
          {@const pct = tmTotal > 0 ? (rect.node.value / tmTotal * 100) : 0}
          {@const showLabel = rect.w > 45 && rect.h > 28}
          {@const showImg = tmField === "Artikel" && rect.node.bildId && rect.w > 30 && rect.h > 30}
          <g>
            <rect x={rect.x + 1} y={rect.y + 1} width={Math.max(rect.w - 2, 0)} height={Math.max(rect.h - 2, 0)}
              rx="4" fill={rect.node.label === "Sonstige" ? "var(--warm-200)" : COLORS[i % COLORS.length]}
              opacity={rect.node.label === "Sonstige" ? 0.6 : 0.78} />
            {#if showImg}
              <image href={imgUrl(rect.node.bildId, 120)}
                x={rect.x + rect.w / 2 - Math.min(rect.w - 8, rect.h - 22, 60) / 2}
                y={rect.y + 3}
                width={Math.min(rect.w - 8, rect.h - 22, 60)}
                height={Math.min(rect.w - 8, rect.h - 22, 60)}
                clip-path="inset(0 round 4px)" />
              {#if rect.h > 50}
                <text x={rect.x + rect.w / 2} y={rect.y + rect.h - 6} text-anchor="middle"
                  fill="white" font-size="8" font-weight="600" style="text-shadow: 0 1px 3px rgba(0,0,0,0.5);">{fmtEUR(rect.node.value)}</text>
              {/if}
            {:else if showLabel}
              <text x={rect.x + rect.w / 2} y={rect.y + rect.h / 2 - (rect.h > 40 ? 5 : 0)} text-anchor="middle" dominant-baseline="central"
                fill="white" font-size={rect.w > 80 ? "9" : "7"} font-weight="600" style="text-shadow: 0 1px 2px rgba(0,0,0,0.4);">
                {rect.node.label.length > (rect.w > 80 ? 18 : 10) ? rect.node.label.slice(0, rect.w > 80 ? 16 : 8) + "…" : rect.node.label}
              </text>
              {#if rect.h > 40}
                <text x={rect.x + rect.w / 2} y={rect.y + rect.h / 2 + 10} text-anchor="middle"
                  fill="rgba(255,255,255,0.8)" font-size="8">{fmtEUR(rect.node.value)} ({pct.toFixed(1)}%)</text>
              {/if}
            {/if}
            <title>{rect.node.label}: {fmtEUR(rect.node.value)} ({pct.toFixed(1)}%)</title>
          </g>
        {/each}
      </svg>
    </div>
    {/if}
  </div>

  <!-- Row 2: Top 10 Kollektionen + Top 3 by Typ -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
    <!-- Top 10 Kollektionen -->
    <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
      <h3 class="text-xs font-semibold uppercase tracking-[0.15em] mb-3" style="color: var(--warm-400);">Top 10 Kollektionen</h3>
      <div class="space-y-2">
        {#each top10Koll as koll, i}
          <div class="flex items-center gap-2">
            <span class="w-5 text-[10px] font-bold text-right tabular-nums" style="color: var(--warm-400);">{i + 1}</span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2">
                <p class="text-[11px] font-medium truncate" style="color: var(--warm-700);">{koll.name}</p>
                <p class="text-[11px] font-semibold tabular-nums flex-shrink-0" style="color: var(--warm-800);">{fmtEUR(koll.umsatz)}</p>
              </div>
              <div class="w-full h-1 rounded-full mt-0.5 overflow-hidden" style="background: var(--warm-100);">
                <div class="h-full rounded-full" style="width: {Math.min(koll.anteil * 3, 100)}%; background: {COLORS[i % COLORS.length]};"></div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Top 3 Kollektionen pro Typ -->
    <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
      <h3 class="text-xs font-semibold uppercase tracking-[0.15em] mb-3" style="color: var(--warm-400);">Top 3 Kollektionen nach Typ</h3>
      <div class="space-y-3 max-h-80 overflow-y-auto pr-1">
        {#each top3ByTyp.slice(0, 8) as t}
          <div>
            <div class="flex items-center justify-between mb-1">
              <p class="text-[10px] font-semibold uppercase tracking-wider" style="color: var(--accent);">{t.typ}</p>
              <p class="text-[9px] tabular-nums" style="color: var(--warm-400);">{fmtEUR(t.totalUmsatz)}</p>
            </div>
            {#each t.kolls as koll, ki}
              <div class="flex items-center justify-between py-0.5 pl-3">
                <span class="text-[10px] truncate" style="color: var(--warm-600); max-width: 180px;">{ki + 1}. {koll.name}</span>
                <span class="text-[10px] tabular-nums font-medium" style="color: var(--warm-700);">{fmtEUR(koll.umsatz)}</span>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- Row 3: Top 4 Kolls pro KW (excl. Classics/Basic) -->
  <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
    <h3 class="text-xs font-semibold uppercase tracking-[0.15em] mb-1" style="color: var(--warm-400);">Top 4 Kollektionen pro KW</h3>
    <p class="text-[9px] mb-3" style="color: var(--warm-400);">ohne Classics & Basic</p>
    <div class="overflow-x-auto">
      <div class="flex gap-3" style="min-width: max-content;">
        {#each kwTopKolls as kwData}
          <div class="flex-shrink-0 w-36">
            <p class="text-[10px] font-semibold mb-2 text-center" style="color: var(--warm-500);">KW {kwData.kw}</p>
            <div class="space-y-1.5">
              {#each kwData.kolls as koll, ki}
                <div class="rounded-lg px-2.5 py-1.5" style="background: {koll.color}15; border-left: 3px solid {koll.color};">
                  <p class="text-[9px] font-medium truncate" style="color: var(--warm-700);" title={koll.name}>{koll.name}</p>
                  <p class="text-[9px] tabular-nums font-semibold" style="color: {koll.color};">{fmtEUR(koll.umsatz)}</p>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- Row 4: Shop Umsatzverlauf -->
  <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
    <h3 class="text-xs font-semibold uppercase tracking-[0.15em] mb-3" style="color: var(--warm-400);">Umsatzverlauf der Shops (KW)</h3>
    <div class="overflow-x-auto">
      <svg width={Math.max(600, shopTrend.kws.length * 70 + 180)} height={280} style="font-family: var(--font-body);">
        <!-- Grid -->
        {#each [0, 0.25, 0.5, 0.75, 1] as frac}
          {@const maxShopKw = Math.max(...shopTrend.data.map(row => Math.max(...row)), 1)}
          {@const yy = 20 + (1 - frac) * 230}
          <line x1={60} x2={shopTrend.kws.length * 70 + 60} y1={yy} y2={yy} stroke="var(--warm-100)" stroke-width="1" />
          <text x={56} y={yy + 4} text-anchor="end" fill="var(--warm-400)" font-size="8">{fmtEUR(maxShopKw * frac)}</text>
        {/each}

        <!-- KW labels -->
        {#each shopTrend.kws as kw, ki}
          <text x={60 + ki * 70 + 35} y={268} text-anchor="middle" fill="var(--warm-500)" font-size="9">KW{kw}</text>
        {/each}

        <!-- Lines per shop -->
        {#each shopTrend.topShops as shop, si}
          {@const maxShopKw = Math.max(...shopTrend.data.map(row => Math.max(...row)), 1)}
          {@const color = COLORS[si % COLORS.length]}
          {@const points = shopTrend.data.map((row, ki) => `${60 + ki * 70 + 35},${20 + (1 - row[si] / maxShopKw) * 230}`)}
          <polyline points={points.join(' ')} fill="none" stroke={color} stroke-width="1.5" opacity="0.7" />
          {#each shopTrend.data as row, ki}
            <circle cx={60 + ki * 70 + 35} cy={20 + (1 - row[si] / maxShopKw) * 230} r="2.5" fill={color} opacity="0.8" />
          {/each}
        {/each}

        <!-- Legend -->
        {#each shopTrend.topShops as shop, si}
          {@const lx = shopTrend.kws.length * 70 + 70}
          <rect x={lx} y={20 + si * 16} width="8" height="8" rx="2" fill={COLORS[si % COLORS.length]} />
          <text x={lx + 12} y={20 + si * 16 + 8} fill="var(--warm-600)" font-size="8">{shop}</text>
        {/each}
      </svg>
    </div>
  </div>
</div>
