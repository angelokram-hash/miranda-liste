<script lang="ts">
  interface RawRow {
    Kollektion: string; BildId: string; Anzahl: number; EinzelPreis: number;
    Form: string; Kasse: string; Art: string; Nr: string; KW: string; Monat: string;
  }

  let { data = [], compareData = [], allData = [], currentKW = 'alle', availableKWs = [] as string[], onKWChange = (kw: string) => {} }: {
    data: RawRow[]; compareData: RawRow[]; allData: RawRow[]; currentKW: string; availableKWs: string[]; onKWChange: (kw: string) => void;
  } = $props();

  function imgUrl(bid: string, sz: number): string {
    return 'https://konplott-cdn.com/mytism/image/' + bid + '/' + bid + '.jpg?width=' + sz + '&height=' + sz + '&box=true';
  }
  function fmtEUR(v: number): string { return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }); }
  function fmtNum(v: number): string { return v.toLocaleString('de-DE', { maximumFractionDigits: 0 }); }
  function fmtDelta(cur: number, prev: number): string {
    if (!prev) return '';
    const pct = ((cur / prev) - 1) * 100;
    return (pct > 0 ? '+' : '') + pct.toFixed(1) + '%';
  }
  function deltaColor(cur: number, prev: number): string {
    if (cur > prev) return '#6b8e5a'; if (cur < prev) return '#c06050'; return 'var(--warm-400)';
  }

  const COLORS = ['#b07c3e','#6b8e5a','#5a7ea8','#c06050','#8a6ab0','#c09050','#4a8a8a','#b05a80','#7a7a4a','#508ab0','#a06a40','#6a9a6a'];

  // KW Navigation
  let kwIdx = $derived(availableKWs.indexOf(currentKW));
  let compKWLabel = $derived(kwIdx > 0 ? 'KW ' + availableKWs[kwIdx - 1] : '');
  function goPrev() { if (kwIdx > 0) onKWChange(availableKWs[kwIdx - 1]); }
  function goNext() { if (kwIdx < availableKWs.length - 1) onKWChange(availableKWs[kwIdx + 1]); }
  let hasComp = $derived(compareData.length > 0);

  // KPIs
  let totalUmsatz = $derived(data.reduce((s, r) => s + (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0), 0));
  let totalAnzahl = $derived(data.reduce((s, r) => s + (Number(r.Anzahl) || 0), 0));
  let avgPreis = $derived(totalAnzahl > 0 ? totalUmsatz / totalAnzahl : 0);
  let compUmsatz = $derived(compareData.reduce((s, r) => s + (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0), 0));
  let compAnzahl = $derived(compareData.reduce((s, r) => s + (Number(r.Anzahl) || 0), 0));
  let compAvgPreis = $derived(compAnzahl > 0 ? compUmsatz / compAnzahl : 0);

  // Top Artikel
  interface TopArt { bildId: string; nr: string; koll: string; umsatz: number; anzahl: number; topShops: { name: string; anzahl: number }[]; compUmsatz: number; compAnzahl: number; }
  let artShowAll = $state(false);
  let topArticles = $derived.by((): TopArt[] => {
    const m = new Map<string, { nr: string; koll: string; umsatz: number; anzahl: number; kassen: Map<string, number> }>();
    for (const r of data) {
      const bid = String(r.BildId); if (!bid || bid === '0') continue;
      if (!m.has(bid)) m.set(bid, { nr: String(r.Nr || ''), koll: r.Kollektion, umsatz: 0, anzahl: 0, kassen: new Map() });
      const a = m.get(bid)!; const an = Number(r.Anzahl) || 0;
      a.umsatz += (Number(r.EinzelPreis) || 0) * an; a.anzahl += an;
      a.kassen.set(r.Kasse, (a.kassen.get(r.Kasse) || 0) + an);
    }
    const cm = new Map<string, { umsatz: number; anzahl: number }>();
    for (const r of compareData) {
      const bid = String(r.BildId); if (!bid || bid === '0') continue;
      if (!cm.has(bid)) cm.set(bid, { umsatz: 0, anzahl: 0 });
      const a = cm.get(bid)!; const an = Number(r.Anzahl) || 0;
      a.umsatz += (Number(r.EinzelPreis) || 0) * an; a.anzahl += an;
    }
    return [...m.entries()].map(([bildId, a]) => {
      const comp = cm.get(bildId);
      return { bildId, nr: a.nr, koll: a.koll, umsatz: a.umsatz, anzahl: a.anzahl,
        topShops: [...a.kassen.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([name, anzahl]) => ({ name, anzahl })),
        compUmsatz: comp?.umsatz || 0, compAnzahl: comp?.anzahl || 0 };
    }).sort((a, b) => b.umsatz - a.umsatz).slice(0, 30);
  });

  // Top 10 Kollektionen
  interface TopKoll { name: string; umsatz: number; anzahl: number; anteil: number; compUmsatz: number; rankChange: number; }
  let top10Koll = $derived.by((): TopKoll[] => {
    const m = new Map<string, { umsatz: number; anzahl: number }>(); let total = 0;
    for (const r of data) {
      const k = r.Kollektion; if (!m.has(k)) m.set(k, { umsatz: 0, anzahl: 0 });
      const a = m.get(k)!; const an = Number(r.Anzahl) || 0; const u = (Number(r.EinzelPreis) || 0) * an;
      a.umsatz += u; a.anzahl += an; total += u;
    }
    const cm = new Map<string, number>();
    for (const r of compareData) { const k = r.Kollektion; cm.set(k, (cm.get(k) || 0) + (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0)); }
    const compRank = [...cm.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    const curList = [...m.entries()].map(([name, a]) => ({
      name, umsatz: a.umsatz, anzahl: a.anzahl, anteil: total > 0 ? (a.umsatz / total) * 100 : 0,
      compUmsatz: cm.get(name) || 0, rankChange: 0,
    })).sort((a, b) => b.umsatz - a.umsatz);
    curList.forEach((k, i) => { const ci = compRank.indexOf(k.name); k.rankChange = ci >= 0 ? ci - i : 0; });
    return curList.slice(0, 10);
  });

  // Top 3 Kollektionen pro Typ
  interface TypTop { typ: string; kolls: { name: string; umsatz: number; compUmsatz: number; rankChange: number }[]; totalUmsatz: number; }
  let top3ByTyp = $derived.by((): TypTop[] => {
    const typMap = new Map<string, Map<string, number>>(); const typTotal = new Map<string, number>();
    for (const r of data) {
      const typ = r.Art || '(keine)'; const koll = r.Kollektion;
      if (!typMap.has(typ)) typMap.set(typ, new Map());
      const km = typMap.get(typ)!;
      const u = (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0);
      km.set(koll, (km.get(koll) || 0) + u); typTotal.set(typ, (typTotal.get(typ) || 0) + u);
    }
    const cTypMap = new Map<string, Map<string, number>>();
    for (const r of compareData) {
      const typ = r.Art || '(keine)'; const koll = r.Kollektion;
      if (!cTypMap.has(typ)) cTypMap.set(typ, new Map());
      cTypMap.get(typ)!.set(koll, (cTypMap.get(typ)!.get(koll) || 0) + (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0));
    }
    return [...typMap.entries()].map(([typ, km]) => {
      const ckm = cTypMap.get(typ) || new Map();
      const cRank = [...ckm.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
      const kolls = [...km.entries()].map(([name, umsatz]) => ({
        name, umsatz, compUmsatz: ckm.get(name) || 0, rankChange: 0,
      })).sort((a, b) => b.umsatz - a.umsatz);
      kolls.forEach((k, i) => { const ci = cRank.indexOf(k.name); k.rankChange = ci >= 0 ? ci - i : 0; });
      return { typ, totalUmsatz: typTotal.get(typ) || 0, kolls: kolls.slice(0, 3) };
    }).sort((a, b) => b.totalUmsatz - a.totalUmsatz).filter(t => t.totalUmsatz > 0);
  });

  // Last 30 KWs from allData
  let last30KWData = $derived.by(() => {
    const allKWs = [...new Set(allData.map(r => r.KW))].sort((a, b) => Number(a) - Number(b));
    const last30 = allKWs.slice(-30);
    const kwSet = new Set(last30);
    return allData.filter(r => kwSet.has(r.KW));
  });

  // Top 4 Kolls pro KW (last 30 KWs)
  interface KwTop { kw: string; kolls: { name: string; umsatz: number; color: string }[]; }
  let kwTopKolls = $derived.by((): KwTop[] => {
    const filtered = last30KWData.filter(r => r.Art !== 'Classics' && r.Art !== 'Basic');
    const kwMap = new Map<string, Map<string, number>>();
    for (const r of filtered) { const kw = r.KW; if (!kwMap.has(kw)) kwMap.set(kw, new Map()); kwMap.get(kw)!.set(r.Kollektion, (kwMap.get(kw)!.get(r.Kollektion) || 0) + (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0)); }
    const allTopKolls = new Set<string>();
    for (const km of kwMap.values()) { for (const [name] of [...km.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) allTopKolls.add(name); }
    const kollColorMap = new Map<string, string>(); let ci = 0;
    for (const k of allTopKolls) { kollColorMap.set(k, COLORS[ci % COLORS.length]); ci++; }
    return [...kwMap.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([kw, km]) => ({
      kw, kolls: [...km.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, umsatz]) => ({ name, umsatz, color: kollColorMap.get(name) || '#999' })),
    }));
  });

  // Shop Umsatzverlauf (last 30 KWs)
  let shopTrend = $derived.by(() => {
    const kwShopMap = new Map<string, Map<string, number>>(); const shopTotals = new Map<string, number>();
    for (const r of last30KWData) { const kw = r.KW; const shop = r.Kasse; if (!kwShopMap.has(kw)) kwShopMap.set(kw, new Map()); const sm = kwShopMap.get(kw)!;
      const u = (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0); sm.set(shop, (sm.get(shop) || 0) + u); shopTotals.set(shop, (shopTotals.get(shop) || 0) + u); }
    const topShops = [...shopTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
    const kws = [...kwShopMap.keys()].sort((a, b) => Number(a) - Number(b));
    return { kws, topShops, data: kws.map(kw => { const sm = kwShopMap.get(kw)!; return topShops.map(shop => sm.get(shop) || 0); }) };
  });
  function shopPolyPoints(si: number): string {
    const maxV = Math.max(...shopTrend.data.map(row => Math.max(...row)), 1);
    return shopTrend.data.map((row, ki) => '' + (60 + ki * 70 + 35) + ',' + (20 + (1 - row[si] / maxV) * 230)).join(' ');
  }

  // Treemaps
  type TreemapField = 'Kollektion' | 'FormPfad' | 'Artikel';
  let tmField = $state<TreemapField>('Kollektion');
  let tmTop20 = $state(false);
  let tmHideSonstige = $state(false);
  interface DrillLevel { label: string; field: string; value: string; }
  let tmDrill = $state<DrillLevel[]>([]);
  interface TmNode { label: string; value: number; bildId: string; drillKey: string; compValue: number; }
  function tmDrillPath(field: TreemapField): string[] {
    if (field === 'Kollektion') return ['Kollektion', 'FormPfad', 'Artikel', 'Kasse'];
    if (field === 'FormPfad') return ['FormPfad', 'Kollektion', 'Artikel', 'Kasse'];
    return ['Artikel', 'Kasse'];
  }
  let tmCurrentLevel = $derived(tmDrill.length);
  let tmPathArr = $derived(tmDrillPath(tmField));
  let tmCurrentField = $derived(tmPathArr[tmCurrentLevel] || tmPathArr[tmPathArr.length - 1]);
  let tmCanDrill = $derived(tmCurrentLevel < tmPathArr.length - 1);
  let treemapNodes = $derived.by((): TmNode[] => {
    let rows = data; let cRows = compareData;
    for (const d of tmDrill) {
      const fn = (r: RawRow) => d.field === 'Artikel' ? String(r.BildId) === d.value : (r as any)[d.field] === d.value;
      rows = rows.filter(fn); cRows = cRows.filter(fn);
    }
    const curField = tmCurrentField;
    const m = new Map<string, { value: number; bildId: string }>();
    for (const r of rows) { let key: string; let bildId = '';
      if (curField === 'Artikel') { const bid = String(r.BildId); if (!bid || bid === '0') continue; key = bid; bildId = bid; }
      else if (curField === 'Kasse') { key = r.Kasse || '(leer)'; } else { key = (r as any)[curField] || '(leer)'; }
      if (!m.has(key)) m.set(key, { value: 0, bildId }); const a = m.get(key)!;
      a.value += (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0); if (!a.bildId && bildId) a.bildId = bildId; }
    const cm = new Map<string, number>();
    for (const r of cRows) { let key: string;
      if (curField === 'Artikel') { const bid = String(r.BildId); if (!bid || bid === '0') continue; key = bid; }
      else if (curField === 'Kasse') { key = r.Kasse || '(leer)'; } else { key = (r as any)[curField] || '(leer)'; }
      cm.set(key, (cm.get(key) || 0) + (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0)); }
    let nodes: TmNode[] = [...m.entries()].map(([label, a]) => ({ label, value: a.value, bildId: a.bildId, drillKey: label, compValue: cm.get(label) || 0 })).sort((a, b) => b.value - a.value);
    const limit = tmTop20 ? 20 : nodes.length;
    if (nodes.length > limit) {
      const top = nodes.slice(0, limit);
      if (!tmHideSonstige) { const sv = nodes.slice(limit).reduce((s, n) => s + n.value, 0); const csv = nodes.slice(limit).reduce((s, n) => s + n.compValue, 0);
        if (sv > 0) top.push({ label: 'Sonstige', value: sv, bildId: '', drillKey: '', compValue: csv }); }
      nodes = top;
    }
    return nodes;
  });
  function tmClick(node: TmNode) { if (!tmCanDrill || node.label === 'Sonstige') return; tmDrill = [...tmDrill, { label: node.label, field: tmCurrentField, value: node.drillKey }]; }
  function tmBack(toLevel: number) { tmDrill = tmDrill.slice(0, toLevel); }
  function tmReset() { tmDrill = []; }
  function layoutTreemap(nodes: TmNode[], w: number, h: number): { x: number; y: number; w: number; h: number; node: TmNode }[] {
    const total = nodes.reduce((s, n) => s + n.value, 0); if (total <= 0 || !nodes.length) return [];
    const rects: { x: number; y: number; w: number; h: number; node: TmNode }[] = [];
    let cx = 0, cy = 0, rw = w, rh = h, remaining = [...nodes], remTotal = total;
    while (remaining.length > 0) { const isWide = rw >= rh; const side = isWide ? rh : rw;
      let row: TmNode[] = [], rowTotal = 0;
      for (const n of remaining) { const worstOld = row.length > 0 ? wRatio(row, rowTotal, side, remTotal) : Infinity;
        const worstNew = wRatio([...row, n], rowTotal + n.value, side, remTotal);
        if (row.length === 0 || worstNew <= worstOld) { row.push(n); rowTotal += n.value; } else break; }
      const stripSize = isWide ? rw * (rowTotal / remTotal) : rh * (rowTotal / remTotal); let offset = 0;
      for (const n of row) { const cellSize = side * (n.value / rowTotal);
        if (isWide) rects.push({ x: cx, y: cy + offset, w: stripSize, h: cellSize, node: n });
        else rects.push({ x: cx + offset, y: cy, w: cellSize, h: stripSize, node: n }); offset += cellSize; }
      if (isWide) { cx += stripSize; rw -= stripSize; } else { cy += stripSize; rh -= stripSize; }
      remaining = remaining.slice(row.length); remTotal -= rowTotal; }
    return rects; }
  function wRatio(row: TmNode[], rowTotal: number, side: number, remTotal: number): number {
    const ss = (rowTotal / remTotal) * side; if (ss <= 0) return Infinity; let worst = 0;
    for (const n of row) { const cs = (n.value / rowTotal) * side; const r = Math.max(ss / cs, cs / ss); if (r > worst) worst = r; } return worst; }

  // Artikel-Matrix
  let matrixSort = $state<'umsatz' | 'anzahl'>('umsatz');
  interface MatrixArt { bildId: string; nr: string; koll: string; curUmsatz: number; curAnzahl: number; compUmsatz: number; compAnzahl: number; curRank: number; compRank: number; }
  let matrixArticles = $derived.by((): MatrixArt[] => {
    const m = new Map<string, { nr: string; koll: string; umsatz: number; anzahl: number }>();
    for (const r of data) { const bid = String(r.BildId); if (!bid || bid === '0') continue;
      if (!m.has(bid)) m.set(bid, { nr: String(r.Nr || ''), koll: r.Kollektion, umsatz: 0, anzahl: 0 });
      const a = m.get(bid)!; const an = Number(r.Anzahl) || 0; a.umsatz += (Number(r.EinzelPreis) || 0) * an; a.anzahl += an; }
    const cm = new Map<string, { umsatz: number; anzahl: number }>();
    for (const r of compareData) { const bid = String(r.BildId); if (!bid || bid === '0') continue;
      if (!cm.has(bid)) cm.set(bid, { umsatz: 0, anzahl: 0 }); const a = cm.get(bid)!; const an = Number(r.Anzahl) || 0;
      a.umsatz += (Number(r.EinzelPreis) || 0) * an; a.anzahl += an; }
    const curList = [...m.entries()].map(([bildId, a]) => ({ bildId, nr: a.nr, koll: a.koll, curUmsatz: a.umsatz, curAnzahl: a.anzahl,
      compUmsatz: cm.get(bildId)?.umsatz || 0, compAnzahl: cm.get(bildId)?.anzahl || 0, curRank: 0, compRank: 0 }));
    const sortKey = matrixSort === 'umsatz' ? 'curUmsatz' : 'curAnzahl';
    curList.sort((a, b) => (b as any)[sortKey] - (a as any)[sortKey]);
    curList.forEach((a, i) => a.curRank = i + 1);
    const compSortKey = matrixSort === 'umsatz' ? 'compUmsatz' : 'compAnzahl';
    const compSorted = [...curList].sort((a, b) => (b as any)[compSortKey] - (a as any)[compSortKey]);
    compSorted.forEach((a, i) => a.compRank = i + 1);
    return curList.slice(0, 30);
  });
</script>

<div class="space-y-6">
  <!-- KW Navigation + KPIs -->
  <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
    <div class="flex items-center justify-center gap-4 mb-4">
      <button onclick={goPrev} disabled={kwIdx <= 0} class="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-30" style="border: 1px solid var(--warm-200); color: var(--warm-600);">&#9664;</button>
      <div class="text-center">
        <p class="text-sm font-semibold" style="color: var(--warm-800);">KW {currentKW}</p>
        {#if compKWLabel}<p class="text-[9px]" style="color: var(--warm-400);">Vergleich: {compKWLabel}</p>{/if}
      </div>
      <button onclick={goNext} disabled={kwIdx >= availableKWs.length - 1} class="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-30" style="border: 1px solid var(--warm-200); color: var(--warm-600);">&#9654;</button>
    </div>
    {#if true}
    {@const kpis = [{label:'Umsatz',cur:totalUmsatz,comp:compUmsatz,fmt:fmtEUR},{label:'Stück',cur:totalAnzahl,comp:compAnzahl,fmt:fmtNum},{label:'⌀ Preis',cur:avgPreis,comp:compAvgPreis,fmt:fmtEUR}]}
    <div class="grid grid-cols-3 gap-4">
      {#each kpis as kpi}
        <div class="text-center">
          <p class="text-[9px] font-semibold uppercase tracking-[0.12em] mb-1" style="color: var(--warm-400);">{kpi.label}</p>
          <p class="text-lg font-bold tabular-nums" style="color: var(--warm-800);">{kpi.fmt(kpi.cur)}</p>
          {#if kpi.comp > 0}
            <p class="text-[9px] tabular-nums" style="color: var(--warm-400);">Vgl: {kpi.fmt(kpi.comp)}</p>
            <p class="text-[10px] font-semibold tabular-nums" style="color: {deltaColor(kpi.cur, kpi.comp)};">{fmtDelta(kpi.cur, kpi.comp)}</p>
          {/if}
        </div>
      {/each}
    </div>
    {/if}
  </div>

  <!-- Top Artikel -->
  <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-xs font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">Top {artShowAll ? 30 : 10} Artikel</h3>
      <button onclick={() => artShowAll = !artShowAll} class="text-[10px] font-medium px-3 py-1 rounded-lg" style="color: var(--accent); border: 1px solid var(--warm-200);">{artShowAll ? 'Weniger' : 'Top 30 zeigen'}</button>
    </div>
    <div class="overflow-y-auto" style="max-height: {artShowAll ? '420px' : '210px'};">
      <div class="flex flex-wrap gap-3 content-start">
        {#each (artShowAll ? topArticles : topArticles.slice(0, 10)) as art, i}
          <div class="flex-shrink-0 w-24">
            <div class="relative">
              <div class="w-24 h-24 rounded-xl overflow-hidden shadow-sm" style="border: 1.5px solid var(--warm-200);">
                <img src={imgUrl(art.bildId, 200)} alt="" class="w-full h-full object-cover" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
              </div>
              <div class="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" style="background: var(--accent); color: white;">{i + 1}</div>
            </div>
            <div class="mt-1.5 text-center">
              <p class="text-[10px] font-semibold tabular-nums" style="color: var(--warm-700);">{fmtEUR(art.umsatz)}</p>
              <p class="text-[9px] tabular-nums" style="color: var(--warm-400);">{fmtNum(art.anzahl)} Stk</p>
              {#if art.compUmsatz > 0}
                <p class="text-[8px] tabular-nums" style="color: var(--warm-400);">Vgl: {fmtEUR(art.compUmsatz)}</p>
                <p class="text-[8px] font-semibold tabular-nums" style="color: {deltaColor(art.umsatz, art.compUmsatz)};">{fmtDelta(art.umsatz, art.compUmsatz)}</p>
              {/if}
              {#if art.nr}<a href="https://www.konplott.com/go/{art.nr}" target="_blank" rel="noopener" onclick={(e) => e.stopPropagation()} class="text-[8px] underline" style="color: var(--accent);">Shop &#8599;</a>{/if}
            </div>
            <div class="mt-1 space-y-0">
              {#each art.topShops as shop}<p class="text-[8px] truncate" style="color: var(--warm-400);" title={shop.name}>{shop.name} ({shop.anzahl})</p>{/each}
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
        {#each (['Kollektion', 'FormPfad', 'Artikel'] as const) as opt, oi}
          <button onclick={() => { tmField = opt; tmDrill = []; }} class="px-3 py-1 text-[11px] font-medium"
            style="background: {tmField === opt ? 'var(--accent)' : 'white'}; color: {tmField === opt ? 'white' : 'var(--warm-500)'}; {oi > 0 ? 'border-left: 1px solid var(--warm-200)' : ''};">{opt}</button>
        {/each}
      </div>
      <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" bind:checked={tmTop20} class="accent-[var(--accent)]" /><span class="text-[11px]" style="color: var(--warm-500);">Nur Top 20</span></label>
      <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" bind:checked={tmHideSonstige} class="accent-[var(--accent)]" /><span class="text-[11px]" style="color: var(--warm-500);">Sonstige ausblenden</span></label>
    </div>
    {#if tmDrill.length > 0}
    <div class="flex items-center gap-1.5 mb-3 flex-wrap">
      <!-- svelte-ignore a11y_click_events_have_key_events --><!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="text-[10px] font-medium cursor-pointer hover:underline" style="color: var(--accent);" onclick={() => tmReset()}>{tmField}</span>
      {#each tmDrill as d, di}
        <span class="text-[10px]" style="color: var(--warm-400);">&#8250;</span>
        <!-- svelte-ignore a11y_click_events_have_key_events --><!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="text-[10px] font-medium cursor-pointer hover:underline" style="color: {di < tmDrill.length - 1 ? 'var(--accent)' : 'var(--warm-600)'};" onclick={() => tmBack(di + 1)}>{d.label}</span>
      {/each}
      <span class="text-[10px]" style="color: var(--warm-400);">&#8250; {tmCurrentField}</span>
    </div>
    {/if}
    {#if true}
    {@const tmW = 900}{@const tmH = 420}{@const rects = layoutTreemap(treemapNodes, tmW, tmH)}{@const tmTotal = treemapNodes.reduce((s, n) => s + n.value, 0)}
    <div class="overflow-x-auto">
      <svg viewBox="0 0 {tmW} {tmH}" class="w-full" style="max-height: 460px;">
        {#each rects as rect, i}
          {@const pct = tmTotal > 0 ? (rect.node.value / tmTotal * 100) : 0}
          {@const showLabel = rect.w > 45 && rect.h > 28}
          {@const showImg = tmCurrentField === 'Artikel' && rect.node.bildId && rect.w > 30 && rect.h > 30}
          {@const hasDelta = rect.node.compValue > 0}
          <!-- svelte-ignore a11y_click_events_have_key_events --><!-- svelte-ignore a11y_no_static_element_interactions -->
          <g onclick={() => tmClick(rect.node)} style="cursor: {tmCanDrill && rect.node.label !== 'Sonstige' ? 'pointer' : 'default'};">
            <rect x={rect.x + 1} y={rect.y + 1} width={Math.max(rect.w - 2, 0)} height={Math.max(rect.h - 2, 0)}
              rx="4" fill={rect.node.label === 'Sonstige' ? 'var(--warm-200)' : COLORS[i % COLORS.length]}
              opacity={rect.node.label === 'Sonstige' ? 0.6 : 0.78} />
            {#if showImg}
              <image href={imgUrl(rect.node.bildId, 120)} x={rect.x + rect.w / 2 - Math.min(rect.w - 8, rect.h - 22, 60) / 2} y={rect.y + 3}
                width={Math.min(rect.w - 8, rect.h - 22, 60)} height={Math.min(rect.w - 8, rect.h - 22, 60)} clip-path="inset(0 round 4px)" />
              {#if rect.h > 50}
                <text x={rect.x + rect.w / 2} y={rect.y + rect.h - (hasDelta ? 14 : 6)} text-anchor="middle" fill="white" font-size="8" font-weight="600" style="text-shadow: 0 1px 3px rgba(0,0,0,0.5);">{fmtEUR(rect.node.value)}</text>
                {#if hasDelta}<text x={rect.x + rect.w / 2} y={rect.y + rect.h - 4} text-anchor="middle" fill={deltaColor(rect.node.value, rect.node.compValue)} font-size="7" font-weight="600" style="text-shadow: 0 1px 2px rgba(0,0,0,0.5);">{fmtDelta(rect.node.value, rect.node.compValue)}</text>{/if}
              {/if}
            {:else if showLabel}
              <text x={rect.x + rect.w / 2} y={rect.y + rect.h / 2 - (rect.h > 50 ? 8 : rect.h > 40 ? 5 : 0)} text-anchor="middle" dominant-baseline="central"
                fill="white" font-size={rect.w > 80 ? '9' : '7'} font-weight="600" style="text-shadow: 0 1px 2px rgba(0,0,0,0.4);">
                {rect.node.label.length > (rect.w > 80 ? 18 : 10) ? rect.node.label.slice(0, rect.w > 80 ? 16 : 8) + '...' : rect.node.label}
              </text>
              {#if rect.h > 40}<text x={rect.x + rect.w / 2} y={rect.y + rect.h / 2 + 8} text-anchor="middle" fill="rgba(255,255,255,0.8)" font-size="8">{fmtEUR(rect.node.value)} ({pct.toFixed(1)}%)</text>{/if}
              {#if rect.h > 55 && hasDelta}<text x={rect.x + rect.w / 2} y={rect.y + rect.h / 2 + 20} text-anchor="middle" fill={deltaColor(rect.node.value, rect.node.compValue)} font-size="7" font-weight="600" style="text-shadow: 0 1px 2px rgba(0,0,0,0.4);">{fmtDelta(rect.node.value, rect.node.compValue)}</text>{/if}
            {/if}
            <title>{rect.node.label}: {fmtEUR(rect.node.value)} ({pct.toFixed(1)}%)</title>
          </g>
        {/each}
      </svg>
    </div>
    {/if}
  </div>

  <!-- Top 10 Kollektionen + Top 3 by Typ -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
    <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
      <h3 class="text-xs font-semibold uppercase tracking-[0.15em] mb-3" style="color: var(--warm-400);">Top 10 Kollektionen</h3>
      <div class="space-y-2">
        {#each top10Koll as koll, i}
          <div class="flex items-center gap-2">
            <span class="w-5 text-[10px] font-bold text-right tabular-nums" style="color: var(--warm-400);">{i + 1}</span>
            {#if koll.rankChange !== 0}
              <span class="text-[9px] font-semibold w-6" style="color: {koll.rankChange > 0 ? '#6b8e5a' : '#c06050'};">{koll.rankChange > 0 ? '&#9650;' + koll.rankChange : '&#9660;' + Math.abs(koll.rankChange)}</span>
            {:else}<span class="w-6 text-[9px] text-center" style="color: var(--warm-300);">=</span>{/if}
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2">
                <p class="text-[11px] font-medium truncate" style="color: var(--warm-700);">{koll.name}</p>
                <div class="text-right flex-shrink-0">
                  <p class="text-[11px] font-semibold tabular-nums" style="color: var(--warm-800);">{fmtEUR(koll.umsatz)}</p>
                  {#if koll.compUmsatz > 0}<p class="text-[8px] tabular-nums" style="color: {deltaColor(koll.umsatz, koll.compUmsatz)};">{fmtDelta(koll.umsatz, koll.compUmsatz)}</p>{/if}
                </div>
              </div>
              <div class="w-full h-1 rounded-full mt-0.5 overflow-hidden" style="background: var(--warm-100);"><div class="h-full rounded-full" style="width: {Math.min(koll.anteil * 3, 100)}%; background: {COLORS[i % COLORS.length]};"></div></div>
            </div>
          </div>
        {/each}
      </div>
    </div>
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
                <div class="flex items-center gap-1.5">
                  <span class="text-[10px] truncate" style="color: var(--warm-600); max-width: 150px;">{ki + 1}. {koll.name}</span>
                  {#if koll.rankChange !== 0}<span class="text-[8px] font-semibold" style="color: {koll.rankChange > 0 ? '#6b8e5a' : '#c06050'};">{koll.rankChange > 0 ? '&#9650;' + koll.rankChange : '&#9660;' + Math.abs(koll.rankChange)}</span>{/if}
                </div>
                <div class="text-right">
                  <span class="text-[10px] tabular-nums font-medium" style="color: var(--warm-700);">{fmtEUR(koll.umsatz)}</span>
                  {#if koll.compUmsatz > 0}<span class="text-[8px] tabular-nums ml-1" style="color: {deltaColor(koll.umsatz, koll.compUmsatz)};">{fmtDelta(koll.umsatz, koll.compUmsatz)}</span>{/if}
                </div>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- Top 4 Kolls pro KW -->
  <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
    <h3 class="text-xs font-semibold uppercase tracking-[0.15em] mb-1" style="color: var(--warm-400);">Top 4 Kollektionen pro KW</h3>
    <p class="text-[9px] mb-3" style="color: var(--warm-400);">ohne Classics &amp; Basic</p>
    <div class="overflow-x-auto"><div class="flex gap-3" style="min-width: max-content;">
      {#each kwTopKolls as kwData}
        <div class="flex-shrink-0 w-36">
          <p class="text-[10px] font-semibold mb-2 text-center" style="color: var(--warm-500);">KW {kwData.kw}</p>
          <div class="space-y-1.5">
            {#each kwData.kolls as koll}
              <div class="rounded-lg px-2.5 py-1.5" style="background: {koll.color}15; border-left: 3px solid {koll.color};">
                <p class="text-[9px] font-medium truncate" style="color: var(--warm-700);" title={koll.name}>{koll.name}</p>
                <p class="text-[9px] tabular-nums font-semibold" style="color: {koll.color};">{fmtEUR(koll.umsatz)}</p>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div></div>
  </div>

  <!-- Shop Umsatzverlauf -->
  <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
    <h3 class="text-xs font-semibold uppercase tracking-[0.15em] mb-3" style="color: var(--warm-400);">Umsatzverlauf der Shops (KW)</h3>
    <div class="overflow-x-auto">
      <svg width={Math.max(600, shopTrend.kws.length * 70 + 180)} height={280} style="font-family: var(--font-body);">
        {#each [0, 0.25, 0.5, 0.75, 1] as frac}
          {@const maxV = Math.max(...shopTrend.data.map(row => Math.max(...row)), 1)}
          {@const yy = 20 + (1 - frac) * 230}
          <line x1={60} x2={shopTrend.kws.length * 70 + 60} y1={yy} y2={yy} stroke="var(--warm-100)" stroke-width="1" />
          <text x={56} y={yy + 4} text-anchor="end" fill="var(--warm-400)" font-size="8">{fmtEUR(maxV * frac)}</text>
        {/each}
        {#each shopTrend.kws as kw, ki}<text x={60 + ki * 70 + 35} y={268} text-anchor="middle" fill="var(--warm-500)" font-size="9">KW{kw}</text>{/each}
        {#each shopTrend.topShops as shop, si}
          {@const color = COLORS[si % COLORS.length]}
          <polyline points={shopPolyPoints(si)} fill="none" stroke={color} stroke-width="1.5" opacity="0.7" />
          {#each shopTrend.data as row, ki}
            {@const maxV = Math.max(...shopTrend.data.map(r => Math.max(...r)), 1)}
            <circle cx={60 + ki * 70 + 35} cy={20 + (1 - row[si] / maxV) * 230} r="2.5" fill={color} opacity="0.8" />
          {/each}
        {/each}
        {#each shopTrend.topShops as shop, si}
          {@const lx = shopTrend.kws.length * 70 + 70}
          <rect x={lx} y={20 + si * 16} width="8" height="8" rx="2" fill={COLORS[si % COLORS.length]} />
          <text x={lx + 12} y={20 + si * 16 + 8} fill="var(--warm-600)" font-size="8">{shop}</text>
        {/each}
      </svg>
    </div>
  </div>

  <!-- Artikel-Matrix -->
  <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
    <div class="flex items-center gap-4 mb-3">
      <h3 class="text-xs font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">Artikel-Matrix</h3>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
        <button onclick={() => matrixSort = 'umsatz'} class="px-3 py-1 text-[11px] font-medium" style="background: {matrixSort === 'umsatz' ? 'var(--accent)' : 'white'}; color: {matrixSort === 'umsatz' ? 'white' : 'var(--warm-500)'};">nach Umsatz</button>
        <button onclick={() => matrixSort = 'anzahl'} class="px-3 py-1 text-[11px] font-medium" style="background: {matrixSort === 'anzahl' ? 'var(--accent)' : 'white'}; color: {matrixSort === 'anzahl' ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">nach Anzahl</button>
      </div>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-[10px]" style="border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 2px solid var(--warm-200); background: var(--warm-50);">
            <th class="px-2 py-1.5 text-left font-semibold" style="color: var(--warm-500); width: 32px;">#</th>
            <th class="px-2 py-1.5 text-left font-semibold" style="color: var(--warm-500); width: 36px;">Bild</th>
            <th class="px-2 py-1.5 text-left font-semibold" style="color: var(--warm-500);">Kollektion</th>
            <th class="px-2 py-1.5 text-right font-semibold" style="color: var(--warm-500);">KW {currentKW}</th>
            <th class="px-2 py-1.5 text-right font-semibold" style="color: var(--warm-500);">{compKWLabel || 'Vgl'}</th>
            <th class="px-2 py-1.5 text-right font-semibold" style="color: var(--warm-500);">&#916;</th>
            <th class="px-2 py-1.5 text-center font-semibold" style="color: var(--warm-500);">Rang</th>
            <th class="px-2 py-1.5 text-right font-semibold" style="color: var(--warm-500);">Link</th>
          </tr>
        </thead>
        <tbody>
          {#each matrixArticles as art}
            {@const curVal = matrixSort === 'umsatz' ? art.curUmsatz : art.curAnzahl}
            {@const compVal = matrixSort === 'umsatz' ? art.compUmsatz : art.compAnzahl}
            <tr style="border-bottom: 1px solid var(--warm-100);">
              <td class="px-2 py-1 tabular-nums font-semibold" style="color: var(--warm-500);">{art.curRank}</td>
              <td class="px-2 py-1"><img src={imgUrl(art.bildId, 40)} alt="" class="w-7 h-7 rounded object-cover" loading="lazy" /></td>
              <td class="px-2 py-1 truncate" style="color: var(--warm-700); max-width: 140px;" title={art.koll}>{art.koll}</td>
              <td class="px-2 py-1 text-right tabular-nums font-medium" style="color: var(--warm-800);">{matrixSort === 'umsatz' ? fmtEUR(curVal) : fmtNum(curVal)}</td>
              <td class="px-2 py-1 text-right tabular-nums" style="color: var(--warm-400);">{compVal > 0 ? (matrixSort === 'umsatz' ? fmtEUR(compVal) : fmtNum(compVal)) : '–'}</td>
              <td class="px-2 py-1 text-right tabular-nums font-semibold" style="color: {compVal > 0 ? deltaColor(curVal, compVal) : 'var(--warm-300)'};">{compVal > 0 ? fmtDelta(curVal, compVal) : ''}</td>
              <td class="px-2 py-1 text-center">
                {#if art.compRank > 0 && art.compRank !== art.curRank}
                  <span class="text-[9px] font-semibold" style="color: {art.compRank > art.curRank ? '#6b8e5a' : '#c06050'};">{art.compRank > art.curRank ? '&#9650;' : '&#9660;'}{Math.abs(art.compRank - art.curRank)}</span>
                {:else}<span style="color: var(--warm-300);">=</span>{/if}
              </td>
              <td class="px-2 py-1 text-right">{#if art.nr}<a href="https://www.konplott.com/go/{art.nr}" target="_blank" rel="noopener" class="underline" style="color: var(--accent);">&#8599;</a>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>
