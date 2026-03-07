<script lang="ts">
  interface RawRow {
    Kollektion: string; BildId: string; Anzahl: number; EinzelPreis: number;
    Form: string; FormPfad: string; Kasse: string; Art: string; Nr: string; KW: string; Monat: string; Datum: string;
    Quelle: string;
  }

  let { data = [], compareData = [], allData = [], timeUnit = 'woche', periods = [] as string[], currentLabel = '', compareLabel = '', pickedNrs = new Set<string>(), onTogglePick, hideEuro = false }: {
    data: RawRow[]; compareData: RawRow[]; allData: RawRow[]; timeUnit: string; periods: string[]; currentLabel: string; compareLabel: string;
    pickedNrs?: Set<string>; onTogglePick?: (art: { nr: string; bildId: string; kollektion: string; einzelPreis: number }) => void;
    hideEuro?: boolean;
  } = $props();

  function imgUrl(bid: string, sz: number): string {
    return 'https://konplott-cdn.com/mytism/image/' + bid + '/' + bid + '.jpg?width=' + sz + '&height=' + sz + '&box=true';
  }
  let fmtEUR = $derived.by(() => hideEuro
    ? (_: number) => '\u2022\u2022\u2022'
    : (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }));
  let fmtNum = $derived.by(() => hideEuro
    ? (_: number) => '\u2022\u2022\u2022'
    : (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 0 }));
  let fmtDelta = $derived.by(() => hideEuro
    ? (_a: number, _b: number) => ''
    : (cur: number, prev: number) => {
        if (!prev) return '';
        const pct = ((cur / prev) - 1) * 100;
        return (pct > 0 ? '+' : '') + pct.toFixed(1) + '%';
      });
  function deltaColor(cur: number, prev: number): string {
    if (cur > prev) return '#6b8e5a'; if (cur < prev) return '#c06050'; return 'var(--warm-400)';
  }

  const COLORS = ['#b07c3e','#6b8e5a','#5a7ea8','#c06050','#8a6ab0','#c09050','#4a8a8a','#b05a80','#7a7a4a','#508ab0','#a06a40','#6a9a6a'];

  function rankBadgeColor(curRank: number, compRank: number): string {
    if (compRank <= 0) return 'var(--accent)';
    const diff = compRank - curRank; // positive = improved
    if (diff === 0) return 'var(--accent)';
    if (diff > 0) {
      // Improved: green, more intense with bigger jump
      const intensity = Math.min(diff / 10, 1);
      const r = Math.round(60 - intensity * 30);
      const g = Math.round(130 + intensity * 50);
      const b = Math.round(70 - intensity * 30);
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    } else {
      // Declined: red, more intense with bigger drop
      const intensity = Math.min(Math.abs(diff) / 10, 1);
      const r = Math.round(190 + intensity * 40);
      const g = Math.round(90 - intensity * 50);
      const b = Math.round(70 - intensity * 30);
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    }
  }

  const MONAT_ORD = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  function periodKey(r: RawRow): string {
    if (timeUnit === 'tag') return r.Datum;
    const y = (r.Datum || '').slice(0, 4);
    if (timeUnit === 'woche') return `${y}-${r.KW}`;
    if (timeUnit === 'monat') return `${y}-${r.Monat}`;
    return y;
  }

  const MONAT_NUM: Record<string, string> = { 'Jan':'01','Feb':'02','Mär':'03','Apr':'04','Mai':'05','Jun':'06','Jul':'07','Aug':'08','Sep':'09','Okt':'10','Nov':'11','Dez':'12' };

  function periodDisplayLabel(p: string): string {
    if (timeUnit === 'tag') { const [y, m, d] = p.split('-'); return `${d}.${m}`; }
    if (timeUnit === 'woche') { const [y, k] = p.split('-'); return `KW${k}.${y}`; }
    if (timeUnit === 'monat') { const [y, m] = p.split('-'); return `${MONAT_NUM[m] || m}-${y}`; }
    return p;
  }

  // ── KPIs ──
  let totalUmsatz = $derived(data.reduce((s, r) => s + (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0), 0));
  let totalAnzahl = $derived(data.reduce((s, r) => s + (Number(r.Anzahl) || 0), 0));
  let avgPreis = $derived(totalAnzahl > 0 ? totalUmsatz / totalAnzahl : 0);
  let compUmsatz = $derived(compareData.reduce((s, r) => s + (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0), 0));
  let compAnzahl = $derived(compareData.reduce((s, r) => s + (Number(r.Anzahl) || 0), 0));
  let compAvgPreis = $derived(compAnzahl > 0 ? compUmsatz / compAnzahl : 0);

  // Top Artikel
  interface TopArt { bildId: string; nr: string; koll: string; umsatz: number; anzahl: number; topShops: { name: string; anzahl: number }[]; compUmsatz: number; compAnzahl: number; compRank: number; }
  let artShowAll = $state(false);
  let topArticles = $derived.by((): TopArt[] => {
    const m = new Map<string, { nr: string; koll: string; umsatz: number; anzahl: number; kassen: Map<string, number> }>();
    for (const r of data) {
      const bid = String(r.BildId); if (!bid || bid === '0') continue;
      if (!m.has(bid)) m.set(bid, { nr: String(r.Nr || ''), koll: r.Kollektion, umsatz: 0, anzahl: 0, kassen: new Map() });
      const a = m.get(bid)!; const an = Number(r.Anzahl) || 0;
      a.umsatz += (Number(r.EinzelPreis) || 0) * an; a.anzahl += an;
      const ch = (r as any).Channel || r.Kasse;
      a.kassen.set(ch, (a.kassen.get(ch) || 0) + an);
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
        compUmsatz: comp?.umsatz || 0, compAnzahl: comp?.anzahl || 0, compRank: 0 };
    }).sort((a, b) => b.umsatz - a.umsatz).slice(0, 30).map((art, i) => {
      // Compute compare rank: position in compare period sorted by umsatz
      const compAll = [...cm.entries()].sort((a, b) => b[1].umsatz - a[1].umsatz).map(e => e[0]);
      const ci = compAll.indexOf(art.bildId);
      art.compRank = ci >= 0 ? ci + 1 : 0;
      return art;
    });
  });

  // Varianten-Gruppierung
  let variantenMode = $state(false);
  let expandedVariants = $state<Set<string>>(new Set());

  function getPreisgruppe(ep: number): string {
    if (ep < 20) return '0–20'; if (ep < 50) return '20–50'; if (ep < 120) return '50–120'; if (ep < 250) return '120–250'; return '250+';
  }

  function toggleDashVariant(key: string) {
    const s = new Set(expandedVariants);
    if (s.has(key)) s.delete(key); else s.add(key);
    expandedVariants = s;
  }

  interface TopVariant { key: string; umsatz: number; anzahl: number; count: number; thumbBildId: string; articles: TopArt[]; }
  let variantTopArticles = $derived.by((): TopVariant[] => {
    // Build BildId → variantKey mapping from RawRows
    const bildToVk = new Map<string, string>();
    for (const r of data) {
      const bid = String(r.BildId);
      if (!bid || bid === '0' || bildToVk.has(bid)) continue;
      bildToVk.set(bid, `${r.Kollektion}|${r.Form}|${getPreisgruppe(Number(r.EinzelPreis) || 0)}`);
    }
    // Group topArticles by variantKey
    const groups = new Map<string, TopArt[]>();
    for (const art of topArticles) {
      const vk = bildToVk.get(art.bildId) || art.bildId;
      if (!groups.has(vk)) groups.set(vk, []);
      groups.get(vk)!.push(art);
    }
    return Array.from(groups.entries()).map(([key, arts]) => ({
      key, thumbBildId: arts[0].bildId,
      umsatz: arts.reduce((s, a) => s + a.umsatz, 0),
      anzahl: arts.reduce((s, a) => s + a.anzahl, 0),
      count: arts.length, articles: arts,
    })).sort((a, b) => b.umsatz - a.umsatz);
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

  // allData is now pre-filtered to last 30 periods by parent
  let last30Periods = $derived(periods.slice(-30));
  let last30Data = $derived(allData);

  // Top 4 Kolls pro KW (last 30 KWs)
  let kwSelectedTypes = $state<Set<string>>(new Set());
  let kwAllTypes = $derived(kwSelectedTypes.size === 0);
  let kwAvailableTypes = $derived([...new Set(last30Data.map(r => r.Art).filter(Boolean))].sort());
  function toggleKwType(typ: string) {
    const next = new Set(kwSelectedTypes);
    if (next.has(typ)) next.delete(typ); else next.add(typ);
    kwSelectedTypes = next;
  }
  interface KwTop { kw: string; kolls: { name: string; umsatz: number; color: string }[]; }
  let kwTopKolls = $derived.by((): KwTop[] => {
    const filtered = kwAllTypes ? last30Data : last30Data.filter(r => kwSelectedTypes.has(r.Art));
    const kwMap = new Map<string, Map<string, number>>();
    for (const r of filtered) { const kw = periodKey(r); if (!kwMap.has(kw)) kwMap.set(kw, new Map()); kwMap.get(kw)!.set(r.Kollektion, (kwMap.get(kw)!.get(r.Kollektion) || 0) + (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0)); }
    const allTopKolls = new Set<string>();
    for (const km of kwMap.values()) { for (const [name] of [...km.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) allTopKolls.add(name); }
    const kollColorMap = new Map<string, string>(); let ci = 0;
    for (const k of allTopKolls) { kollColorMap.set(k, COLORS[ci % COLORS.length]); ci++; }
    return [...kwMap.entries()].sort((a, b) => periods.indexOf(b[0]) - periods.indexOf(a[0])).map(([kw, km]) => ({
      kw, kolls: [...km.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, umsatz]) => ({ name, umsatz, color: kollColorMap.get(name) || '#999' })),
    }));
  });

  // Shop Umsatzverlauf (last 30 periods)
  let shopTrend = $derived.by(() => {
    const kwShopMap = new Map<string, Map<string, number>>(); const shopTotals = new Map<string, number>();
    for (const r of last30Data) { const kw = periodKey(r); const shop = (r as any).Channel || r.Kasse; if (!kwShopMap.has(kw)) kwShopMap.set(kw, new Map()); const sm = kwShopMap.get(kw)!;
      const u = (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0); sm.set(shop, (sm.get(shop) || 0) + u); shopTotals.set(shop, (shopTotals.get(shop) || 0) + u); }
    const topShops = [...shopTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
    const kws = [...kwShopMap.keys()].sort((a, b) => periods.indexOf(b) - periods.indexOf(a));
    return { kws, topShops, data: kws.map(kw => { const sm = kwShopMap.get(kw)!; return topShops.map(shop => sm.get(shop) || 0); }) };
  });
  function shopPolyPoints(si: number): string {
    const maxV = Math.max(...shopTrend.data.map(row => Math.max(...row)), 1);
    return shopTrend.data.map((row, ki) => '' + (60 + ki * 70 + 35) + ',' + (20 + (1 - row[si] / maxV) * 230)).join(' ');
  }

  // Shop chart controls
  let shopChartMode = $state<'line' | 'bar' | 'bar100'>('line');
  let selectedShops = $state<Set<string>>(new Set());
  let shopAllSelected = $derived(selectedShops.size === 0);
  function toggleShop(shop: string) {
    const next = new Set(selectedShops);
    if (next.has(shop)) next.delete(shop); else next.add(shop);
    selectedShops = next;
  }
  function isShopVisible(shop: string): boolean {
    return shopAllSelected || selectedShops.has(shop);
  }
  let visibleShopIndices = $derived(
    shopTrend.topShops.map((s, i) => ({ s, i })).filter(x => isShopVisible(x.s)).map(x => x.i)
  );

  // Treemaps
  type TreemapField = 'Kollektion' | 'FormPfad' | 'Artikel';
  let tmField = $state<TreemapField>('Kollektion');
  let tmTop20 = $state(false);
  let tmHideSonstige = $state(false);
  interface DrillLevel { label: string; field: string; value: string; }
  let tmDrill = $state<DrillLevel[]>([]);
  interface TmNode { label: string; value: number; bildId: string; drillKey: string; compValue: number; }
  function tmDrillPath(field: TreemapField): string[] {
    if (field === 'Kollektion') return ['Kollektion', 'FormPfad', 'Artikel', 'Channel'];
    if (field === 'FormPfad') return ['FormPfad', 'Kollektion', 'Artikel', 'Channel'];
    return ['Artikel', 'Channel'];
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
      else if (curField === 'Channel') { key = (r as any).Channel || r.Kasse || '(leer)'; } else { key = (r as any)[curField] || '(leer)'; }
      if (!m.has(key)) m.set(key, { value: 0, bildId }); const a = m.get(key)!;
      a.value += (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0); if (!a.bildId && bildId) a.bildId = bildId; }
    const cm = new Map<string, number>();
    for (const r of cRows) { let key: string;
      if (curField === 'Artikel') { const bid = String(r.BildId); if (!bid || bid === '0') continue; key = bid; }
      else if (curField === 'Channel') { key = (r as any).Channel || r.Kasse || '(leer)'; } else { key = (r as any)[curField] || '(leer)'; }
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

  // Artikel-Matrix — uses global timeUnit, last 10 periods
  let mxSortBy = $state<'umsatz' | 'anzahl'>('umsatz');
  let mxSelectedArt = $state<string | null>(null);

  interface MxCol { label: string; rows: MxArt[]; }
  interface MxArt { bildId: string; nr: string; koll: string; formPfad: string; umsatz: number; anzahl: number; }

  // Kassen breakdown for selected article
  interface MxKasseRow { kasse: string; values: number[]; total: number; }
  let mxKassenData = $derived.by((): { labels: string[]; rows: MxKasseRow[] } => {
    if (!mxSelectedArt) return { labels: [], rows: [] };
    const last10 = timeUnit === 'jahr' ? ['2026'] : periods.slice(-10).reverse();
    const labels = last10.map(p => mxPeriodLabel(p));
    const kasseMap = new Map<string, number[]>();
    last10.forEach((p, pi) => {
      const filtered = timeUnit === 'jahr' ? allData : allData.filter(r => periodKey(r) === p);
      for (const r of filtered) {
        if (String(r.BildId) !== mxSelectedArt) continue;
        const k = (r as any).Channel || r.Kasse; const an = Number(r.Anzahl) || 0;
        const val = mxSortBy === 'umsatz' ? (Number(r.EinzelPreis) || 0) * an : an;
        if (!kasseMap.has(k)) kasseMap.set(k, new Array(last10.length).fill(0));
        kasseMap.get(k)![pi] += val;
      }
    });
    const rows = [...kasseMap.entries()].map(([kasse, values]) => ({
      kasse, values, total: values.reduce((s, v) => s + v, 0)
    })).sort((a, b) => b.total - a.total);
    return { labels, rows };
  });

  function mxPeriodLabel(p: string): string {
    return periodDisplayLabel(p);
  }

  let mxColumns = $derived.by((): MxCol[] => {
    const last10 = periods.slice(-10).reverse(); // newest first
    if (timeUnit === 'jahr') {
      const m = new Map<string, { nr: string; koll: string; formPfad: string; umsatz: number; anzahl: number }>();
      for (const r of allData) { const bid = String(r.BildId); if (!bid || bid === '0') continue;
        if (!m.has(bid)) m.set(bid, { nr: String(r.Nr || ''), koll: r.Kollektion, formPfad: (r as any).FormPfad || '', umsatz: 0, anzahl: 0 });
        const a = m.get(bid)!; const an = Number(r.Anzahl) || 0; a.umsatz += (Number(r.EinzelPreis) || 0) * an; a.anzahl += an; }
      return [{ label: '2026', rows: [...m.entries()].map(([bildId, a]) => ({ bildId, ...a })).sort((a, b) => mxSortBy === 'umsatz' ? b.umsatz - a.umsatz : b.anzahl - a.anzahl).slice(0, 15) }];
    }
    return last10.map(p => {
      const filtered = allData.filter(r => periodKey(r) === p);
      const m = new Map<string, { nr: string; koll: string; formPfad: string; umsatz: number; anzahl: number }>();
      for (const r of filtered) { const bid = String(r.BildId); if (!bid || bid === '0') continue;
        if (!m.has(bid)) m.set(bid, { nr: String(r.Nr || ''), koll: r.Kollektion, formPfad: (r as any).FormPfad || '', umsatz: 0, anzahl: 0 });
        const a = m.get(bid)!; const an = Number(r.Anzahl) || 0; a.umsatz += (Number(r.EinzelPreis) || 0) * an; a.anzahl += an; }
      return { label: mxPeriodLabel(p), rows: [...m.entries()].map(([bildId, a]) => ({ bildId, ...a })).sort((a, b) => mxSortBy === 'umsatz' ? b.umsatz - a.umsatz : b.anzahl - a.anzahl).slice(0, 15) };
    });
  });
</script>

<div class="space-y-6">
  <!-- Top Artikel -->
  <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
    <div class="flex items-center gap-3 mb-3">
      <h3 class="text-xs font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">Top {artShowAll ? 30 : 10} {variantenMode ? 'Varianten' : 'Artikel'}</h3>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
        <button onclick={() => (variantenMode = false, expandedVariants = new Set())} class="px-2 py-0.5 text-[9px] font-medium"
          style="background: {!variantenMode ? 'var(--accent)' : 'white'}; color: {!variantenMode ? 'white' : 'var(--warm-500)'};">Alle</button>
        <button onclick={() => variantenMode = true} class="px-2 py-0.5 text-[9px] font-medium"
          style="background: {variantenMode ? 'var(--accent)' : 'white'}; color: {variantenMode ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">Varianten</button>
      </div>
      {#if variantenMode}
        <button onclick={() => (expandedVariants = expandedVariants.size > 0 ? new Set() : new Set(variantTopArticles.map(v => v.key)))}
          class="px-2 py-0.5 text-[9px] rounded-lg" style="border: 1px solid var(--warm-200); color: var(--warm-500); background: white;">
          {expandedVariants.size > 0 ? '↕ Zu' : '↕ Auf'}
        </button>
      {/if}
      <button onclick={() => artShowAll = !artShowAll} class="text-[10px] font-medium px-3 py-1 rounded-lg ml-auto" style="color: var(--accent); border: 1px solid var(--warm-200);">{artShowAll ? 'Weniger' : 'Top 30 zeigen'}</button>
    </div>
    <div class="overflow-y-auto" style="max-height: {artShowAll ? '420px' : '210px'};">
      <div class="flex flex-wrap gap-3 content-start">
        {#if variantenMode}
          {#each (artShowAll ? variantTopArticles : variantTopArticles.slice(0, 10)) as vg, i}
            {@const vOpen = expandedVariants.has(vg.key)}
            <div class="flex-shrink-0">
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="w-24 cursor-pointer" onclick={() => toggleDashVariant(vg.key)}>
                <div class="relative pt-2 pl-2">
                  <div class="relative w-[88px] h-[88px] rounded-xl overflow-hidden shadow-sm" style="border: 1.5px solid {vOpen ? 'var(--accent)' : 'var(--warm-200)'};">
                    <img src={imgUrl(vg.thumbBildId, 200)} alt="" class="w-full h-full object-cover" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
                    {#if vg.count > 1}
                      <span class="absolute bottom-0.5 left-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-bold" style="background: var(--accent); color: white;">{vg.count}×</span>
                    {/if}
                  </div>
                  <div class="absolute top-0 left-0 min-w-5 h-5 px-1 rounded-full flex items-center justify-center text-[8px] font-bold" style="background: var(--accent); color: white;">{i + 1}</div>
                </div>
                <div class="mt-1.5 text-center">
                  <p class="text-[10px] font-semibold tabular-nums" style="color: var(--warm-700);">{fmtEUR(vg.umsatz)}</p>
                  <p class="text-[9px] tabular-nums" style="color: var(--warm-400);">{fmtNum(vg.anzahl)} Stk</p>
                </div>
              </div>
              {#if vOpen}
                <div class="mt-2 flex flex-wrap gap-2 p-2 rounded-xl" style="background: var(--warm-50); border: 1px solid var(--warm-200);">
                  {#each vg.articles as art}
                    <div class="flex flex-col items-center w-16">
                      <div class="relative w-14 h-14 rounded-lg overflow-hidden shadow-sm" style="border: 1px solid var(--warm-200);">
                        <img src={imgUrl(art.bildId, 160)} alt="" class="w-full h-full object-cover" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
                        {#if art.nr && onTogglePick}<button class="absolute top-0 right-0 w-4 h-4 rounded-full flex items-center justify-center text-white text-[7px] shadow-sm" style="background: {pickedNrs.has(art.nr) ? 'var(--accent)' : 'rgba(0,0,0,0.45)'};" onclick={(e) => { e.stopPropagation(); onTogglePick({ nr: art.nr, bildId: art.bildId, kollektion: art.koll, einzelPreis: art.umsatz / (art.anzahl || 1) }); }}>{pickedNrs.has(art.nr) ? '✓' : '+'}</button>{/if}
                      </div>
                      <p class="text-[8px] font-medium tabular-nums mt-0.5" style="color: var(--warm-700);">{fmtEUR(art.umsatz)}</p>
                      <p class="text-[7px] tabular-nums" style="color: var(--warm-400);">{fmtNum(art.anzahl)} Stk</p>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        {:else}
          {#each (artShowAll ? topArticles : topArticles.slice(0, 10)) as art, i}
            <div class="flex-shrink-0 w-24">
              <div class="relative pt-2 pl-2">
                <div class="relative w-[88px] h-[88px] rounded-xl overflow-hidden shadow-sm" style="border: 1.5px solid var(--warm-200);">
                  <img src={imgUrl(art.bildId, 200)} alt="" class="w-full h-full object-cover" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
                  {#if art.nr && onTogglePick}<button class="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] shadow-sm" style="background: {pickedNrs.has(art.nr) ? 'var(--accent)' : 'rgba(0,0,0,0.45)'};" onclick={(e) => { e.stopPropagation(); onTogglePick({ nr: art.nr, bildId: art.bildId, kollektion: art.koll, einzelPreis: art.umsatz / (art.anzahl || 1) }); }} title="Zur Liste">{pickedNrs.has(art.nr) ? '✓' : '+'}</button>{/if}
                </div>
                <div class="absolute top-0 left-0 min-w-5 h-5 px-1 rounded-full flex items-center justify-center text-[8px] font-bold" style="background: {rankBadgeColor(i + 1, art.compRank)}; color: white;">
                  {i + 1}{#if art.compRank > 0}<span class="font-normal opacity-80">({art.compRank})</span>{/if}
                </div>
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
        {/if}
      </div>
    </div>
  </div>

  <!-- Shop Umsatzverlauf -->
  <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
    <div class="flex flex-wrap items-center gap-4 mb-3">
      <h3 class="text-xs font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">Umsatzverlauf der Shops</h3>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
        <button onclick={() => shopChartMode = 'line'} class="px-2.5 py-1 text-[10px] font-medium"
          style="background: {shopChartMode === 'line' ? 'var(--accent)' : 'white'}; color: {shopChartMode === 'line' ? 'white' : 'var(--warm-500)'};">Linien</button>
        <button onclick={() => shopChartMode = 'bar'} class="px-2.5 py-1 text-[10px] font-medium"
          style="background: {shopChartMode === 'bar' ? 'var(--accent)' : 'white'}; color: {shopChartMode === 'bar' ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">Säulen</button>
        <button onclick={() => shopChartMode = 'bar100'} class="px-2.5 py-1 text-[10px] font-medium"
          style="background: {shopChartMode === 'bar100' ? 'var(--accent)' : 'white'}; color: {shopChartMode === 'bar100' ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">100%</button>
      </div>
      {#if !shopAllSelected}
        <!-- svelte-ignore a11y_click_events_have_key_events --><!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="text-[10px] cursor-pointer underline" style="color: var(--accent);" onclick={() => selectedShops = new Set()}>Alle zeigen</span>
      {/if}
    </div>
    <!-- Clickable shop legend -->
    <div class="flex flex-wrap gap-2 mb-3">
      {#each shopTrend.topShops as shop, si}
        <!-- svelte-ignore a11y_click_events_have_key_events --><!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium cursor-pointer transition-opacity"
          style="background: {COLORS[si % COLORS.length]}15; color: {COLORS[si % COLORS.length]}; opacity: {isShopVisible(shop) ? 1 : 0.3}; border: 1px solid {COLORS[si % COLORS.length]}{isShopVisible(shop) ? '40' : '15'};"
          onclick={() => toggleShop(shop)}>
          <span class="w-2 h-2 rounded-full" style="background: {COLORS[si % COLORS.length]};"></span>
          {shop}
        </span>
      {/each}
    </div>
    {#if true}
    {@const chartW = Math.max(600, shopTrend.kws.length * 70 + 40)}
    {@const chartH = 260}
    {@const pad = { l: 60, r: 20, t: 20, b: 30 }}
    {@const plotW = chartW - pad.l - pad.r}
    {@const plotH = chartH - pad.t - pad.b}
    {@const barW = plotW / shopTrend.kws.length}
    <div class="overflow-x-auto">
      <svg width={chartW} height={chartH} style="font-family: var(--font-body);">
        <!-- Y grid + labels -->
        {#each [0, 0.25, 0.5, 0.75, 1] as frac}
          {@const yy = pad.t + (1 - frac) * plotH}
          {@const maxV = shopChartMode === 'bar100' ? 100 : Math.max(...shopTrend.data.map(row => { let s = 0; visibleShopIndices.forEach(si => s += row[si]); return s; }), ...shopTrend.data.map(row => { let mx = 0; visibleShopIndices.forEach(si => { if (row[si] > mx) mx = row[si]; }); return mx; }), 1)}
          <line x1={pad.l} x2={chartW - pad.r} y1={yy} y2={yy} stroke="var(--warm-100)" stroke-width="1" />
          <text x={pad.l - 4} y={yy + 4} text-anchor="end" fill="var(--warm-400)" font-size="8">{shopChartMode === 'bar100' ? (frac * 100).toFixed(0) + '%' : fmtEUR(maxV * frac)}</text>
        {/each}
        <!-- KW labels -->
        {#each shopTrend.kws as kw, ki}
          <text x={pad.l + ki * barW + barW / 2} y={chartH - 5} text-anchor="middle" fill="var(--warm-500)" font-size="9">{periodDisplayLabel(kw)}</text>
        {/each}

        {#if shopChartMode === 'line'}
          <!-- Line chart -->
          {#each shopTrend.topShops as shop, si}
            {#if isShopVisible(shop)}
              {@const color = COLORS[si % COLORS.length]}
              {@const maxV = Math.max(...shopTrend.data.map(row => { let mx = 0; visibleShopIndices.forEach(i => { if (row[i] > mx) mx = row[i]; }); return mx; }), 1)}
              <polyline points={shopTrend.data.map((row, ki) => '' + (pad.l + ki * barW + barW / 2) + ',' + (pad.t + (1 - row[si] / maxV) * plotH)).join(' ')} fill="none" stroke={color} stroke-width="1.5" opacity="0.8" />
              {#each shopTrend.data as row, ki}
                <circle cx={pad.l + ki * barW + barW / 2} cy={pad.t + (1 - row[si] / maxV) * plotH} r="2.5" fill={color} opacity="0.9" />
              {/each}
            {/if}
          {/each}
        {:else if shopChartMode === 'bar'}
          <!-- Stacked bar chart -->
          {#each shopTrend.kws as kw, ki}
            {@const stackMax = (() => { let s = 0; visibleShopIndices.forEach(si => s += shopTrend.data[ki][si]); return s; })()}
            {@const globalMax = Math.max(...shopTrend.data.map(row => { let s = 0; visibleShopIndices.forEach(si => s += row[si]); return s; }), 1)}
            {@const bx = pad.l + ki * barW + 4}
            {@const bw = barW - 8}
            {#each visibleShopIndices as si, vi}
              {@const val = shopTrend.data[ki][si]}
              {@const below = (() => { let s = 0; for (let j = 0; j < vi; j++) s += shopTrend.data[ki][visibleShopIndices[j]]; return s; })()}
              {@const h = (val / globalMax) * plotH}
              {@const y = pad.t + plotH - (below / globalMax) * plotH - h}
              <rect x={bx} y={y} width={bw} height={Math.max(h, 0)} rx="2" fill={COLORS[si % COLORS.length]} opacity="0.78" />
            {/each}
          {/each}
        {:else}
          <!-- 100% stacked bar chart -->
          {#each shopTrend.kws as kw, ki}
            {@const stackTotal = (() => { let s = 0; visibleShopIndices.forEach(si => s += shopTrend.data[ki][si]); return s; })()}
            {@const bx = pad.l + ki * barW + 4}
            {@const bw = barW - 8}
            {#if stackTotal > 0}
              {#each visibleShopIndices as si, vi}
                {@const val = shopTrend.data[ki][si]}
                {@const below = (() => { let s = 0; for (let j = 0; j < vi; j++) s += shopTrend.data[ki][visibleShopIndices[j]]; return s; })()}
                {@const pct = val / stackTotal}
                {@const belowPct = below / stackTotal}
                {@const h = pct * plotH}
                {@const y = pad.t + plotH - belowPct * plotH - h}
                <rect x={bx} y={y} width={bw} height={Math.max(h, 0)} rx="2" fill={COLORS[si % COLORS.length]} opacity="0.78" />
              {/each}
            {/if}
          {/each}
        {/if}
      </svg>
    </div>
    {/if}
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
              <span class="text-[9px] font-semibold w-6" style="color: {koll.rankChange > 0 ? '#6b8e5a' : '#c06050'};">{koll.rankChange > 0 ? '▲' + koll.rankChange : '▼' + Math.abs(koll.rankChange)}</span>
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
                  {#if koll.rankChange !== 0}<span class="text-[8px] font-semibold" style="color: {koll.rankChange > 0 ? '#6b8e5a' : '#c06050'};">{koll.rankChange > 0 ? '▲' + koll.rankChange : '▼' + Math.abs(koll.rankChange)}</span>{/if}
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
    <div class="flex flex-wrap items-center gap-4 mb-3">
      <h3 class="text-xs font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">Top 4 Kollektionen pro {timeUnit === 'tag' ? 'Tag' : timeUnit === 'woche' ? 'KW' : timeUnit === 'monat' ? 'Monat' : 'Jahr'}</h3>
      {#if !kwAllTypes}
        <!-- svelte-ignore a11y_click_events_have_key_events --><!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="text-[10px] cursor-pointer underline" style="color: var(--accent);" onclick={() => kwSelectedTypes = new Set()}>Alle Typen</span>
      {/if}
    </div>
    <div class="flex flex-wrap gap-1.5 mb-3">
      {#each kwAvailableTypes as typ}
        <!-- svelte-ignore a11y_click_events_have_key_events --><!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="px-2 py-0.5 rounded-full text-[9px] font-medium cursor-pointer transition-opacity"
          style="background: var(--accent){kwAllTypes || kwSelectedTypes.has(typ) ? '18' : '08'}; color: var(--accent); opacity: {kwAllTypes || kwSelectedTypes.has(typ) ? 1 : 0.3}; border: 1px solid var(--accent){kwAllTypes || kwSelectedTypes.has(typ) ? '40' : '15'};"
          onclick={() => toggleKwType(typ)}>
          {typ}
        </span>
      {/each}
    </div>
    <div class="overflow-x-auto"><div class="flex gap-3" style="min-width: max-content;">
      {#each kwTopKolls as kwData}
        <div class="flex-shrink-0 w-36">
          <p class="text-[10px] font-semibold mb-2 text-center" style="color: var(--warm-500);">{periodDisplayLabel(kwData.kw)}</p>
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

  <!-- Artikel-Matrix -->
  <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
    <div class="flex flex-wrap items-center gap-4 mb-3">
      <h3 class="text-xs font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">Artikel-Matrix</h3>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
        <button onclick={() => mxSortBy = 'umsatz'} class="px-3 py-1 text-[10px] font-medium"
          style="background: {mxSortBy === 'umsatz' ? 'var(--accent)' : 'white'}; color: {mxSortBy === 'umsatz' ? 'white' : 'var(--warm-500)'};">Umsatz</button>
        <button onclick={() => mxSortBy = 'anzahl'} class="px-3 py-1 text-[10px] font-medium"
          style="background: {mxSortBy === 'anzahl' ? 'var(--accent)' : 'white'}; color: {mxSortBy === 'anzahl' ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">Anzahl</button>
      </div>
    </div>
    <div class="overflow-x-auto">
      <div class="flex gap-3" style="min-width: max-content;">
        {#each mxColumns as col, ci}
          <div class="flex-shrink-0" style="width: 150px;">
            <div class="text-center mb-2 py-1.5 rounded-lg" style="background: {ci === 0 ? 'var(--accent)' : 'var(--warm-100)'};">
              <p class="text-[10px] font-bold" style="color: {ci === 0 ? 'white' : 'var(--warm-600)'};">{col.label}</p>
            </div>
            <div class="space-y-2">
              {#each col.rows as art, ri}
                <!-- svelte-ignore a11y_click_events_have_key_events --><!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="rounded-lg p-1.5 cursor-pointer transition-all" onclick={() => mxSelectedArt = mxSelectedArt === art.bildId ? null : art.bildId}
                  style="border: 1px solid {mxSelectedArt === art.bildId ? 'var(--accent)' : 'var(--warm-100)'}; background: {mxSelectedArt === art.bildId ? '#faf5ed' : ri < 3 ? 'var(--warm-50)' : 'white'}; {mxSelectedArt === art.bildId ? 'box-shadow: 0 0 0 2px var(--accent)' : ''};"
                >                  <div class="flex items-start gap-1.5">
                    <div class="relative flex-shrink-0">
                      <img src={imgUrl(art.bildId, 80)} alt="" class="w-10 h-10 rounded object-cover" loading="lazy" />
                      <div class="absolute -top-1 -left-1 w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold" style="background: {ri < 3 ? 'var(--accent)' : 'var(--warm-300)'}; color: white;">{ri + 1}</div>
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-[9px] font-semibold tabular-nums" style="color: var(--warm-800);">{fmtEUR(art.umsatz)}</p>
                      <p class="text-[8px] tabular-nums" style="color: var(--warm-400);">{fmtNum(art.anzahl)} Stk</p>
                      <p class="text-[8px] truncate" style="color: var(--warm-600);" title={art.koll}>{art.koll}</p>
                      {#if art.formPfad}<p class="text-[7px]" style="color: var(--warm-400);">{art.formPfad}</p>{/if}
                    </div>
                  </div>
                  {#if art.nr}<a href="https://www.konplott.com/go/{art.nr}" target="_blank" rel="noopener" class="text-[7px] underline" style="color: var(--accent);">Shop &#8599;</a>{/if}
                </div>
              {/each}
              {#if col.rows.length === 0}
                <p class="text-[9px] text-center py-4" style="color: var(--warm-300);">Keine Daten</p>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
    <!-- Kassen breakdown for selected article -->
    {#if mxSelectedArt && mxKassenData.rows.length > 0}
      <div class="mt-4 rounded-lg overflow-hidden" style="border: 1px solid var(--accent); background: #faf5ed;">
        <div class="flex items-center gap-2 px-3 py-2" style="background: var(--accent);">
          <img src={imgUrl(mxSelectedArt, 40)} alt="" class="w-6 h-6 rounded object-cover" />
          <span class="text-[10px] font-bold" style="color: white;">Channel-Aufschlüsselung ({mxSortBy === 'umsatz' ? 'Umsatz' : 'Anzahl'})</span>
          <!-- svelte-ignore a11y_click_events_have_key_events --><!-- svelte-ignore a11y_no_static_element_interactions -->
          <span class="ml-auto text-[10px] cursor-pointer px-2 py-0.5 rounded" style="color: white; background: rgba(255,255,255,0.2);" onclick={() => mxSelectedArt = null}>&#10005;</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-[9px]" style="border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1.5px solid var(--warm-200); background: var(--warm-50);">
                <th class="px-2 py-1.5 text-left font-semibold sticky left-0" style="color: var(--warm-500); background: var(--warm-50); min-width: 100px;">Channel</th>
                {#each mxKassenData.labels as label}
                  <th class="px-2 py-1.5 text-right font-semibold" style="color: var(--warm-500); min-width: 65px;">{label}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each mxKassenData.rows as row}
                <tr style="border-bottom: 1px solid var(--warm-100);">
                  <td class="px-2 py-1 font-medium sticky left-0" style="color: var(--warm-700); background: #faf5ed;">{row.kasse}</td>
                  {#each row.values as val}
                    <td class="px-2 py-1 text-right tabular-nums" style="color: {val > 0 ? 'var(--warm-800)' : 'var(--warm-300)'};">{val > 0 ? (mxSortBy === 'umsatz' ? fmtEUR(val) : fmtNum(val)) : '–'}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  </div>
</div>
