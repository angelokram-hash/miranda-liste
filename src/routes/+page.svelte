<script lang="ts">
  import { onMount } from 'svelte';
  import BubbleChart from '$lib/BubbleChart.svelte';
  import BarChart from '$lib/BarChart.svelte';
  import PieChart from '$lib/PieChart.svelte';
  import AreaChart from '$lib/AreaChart.svelte';
  import Dashboard from '$lib/Dashboard.svelte';

  // ─── Types ───
  interface RawRow {
    Kollektion: string; BildId: string; Anzahl: number; EinzelPreis: number;
    Art: string; Form: string; FormPfad: string; Nr: string; SubKollektion: string;
    Kasse: string; Monat: string; KW: string; Datum: string;
  }

  interface KasseStat { kasse: string; anzahl: number; }

  interface ArticleNode {
    bildId: string; umsatz: number; anzahl: number;
    kassenStats: KasseStat[];
  }

  interface GroupNode {
    name: string; thumbBildId: string; umsatz: number; anzahl: number;
    avgPreis: number; anteil: number;
    articles: ArticleNode[];           // leaf articles
    subGroups?: GroupNode[];           // optional mid-level (Kollektionen inside Form/Art)
  }

  type TabId = 'dashboard' | 'kollektion' | 'artikel' | 'form' | 'art' | 'formpfad' | 'preis' | 'kasse' | 'custom' | 'bubble' | 'bar' | 'pie' | 'area';

  // ─── Role-based Kasse filter ───
  const ROLE_KASSEN: Record<string, string[] | null> = {
    'all': null,           // null = show all
    'koblenz': ['Koblenz', 'Köln Weiden'],
  };
  let userRole = $state('all');
  let allowedKassen = $derived(ROLE_KASSEN[userRole] || null);
  let roleLabel = $derived(allowedKassen ? allowedKassen.join(' + ') : '');

  // ─── State ───
  let allData: RawRow[] = $state([]);
  let loading = $state(true);
  let activeTab = $state<TabId>('dashboard');

  // Pre-aggregated data — all derived, no $effect needed
  let preisSubTab = $state<'formpfad' | 'kollektion'>('formpfad');
  let kollSubMode = $state<'artikel' | 'subkollektion'>('artikel');
  // For Custom tab: 4 selectable levels
  type DimOption = 'Kollektion' | 'FormPfad' | 'Kasse' | 'SubKollektion' | 'Form' | 'Preisgruppe' | '';
  const DIM_OPTIONS: { value: DimOption; label: string }[] = [
    { value: '', label: '— keine —' },
    { value: 'Kollektion', label: 'Kollektion' },
    { value: 'FormPfad', label: 'FormPfad' },
    { value: 'Kasse', label: 'Kasse' },
    { value: 'SubKollektion', label: 'SubKollektion' },
    { value: 'Form', label: 'Form' },
    { value: 'Preisgruppe', label: 'Preisgruppe' },
  ];
  let customDim1 = $state<DimOption>('Kollektion');
  let customDim2 = $state<DimOption>('Form');
  let customDim3 = $state<DimOption>('');
  let customDim4 = $state<DimOption>('');
  // Time filters
  const MONAT_ORDER = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

  // ── Unified time navigation ──
  type TimeUnit = 'tag' | 'woche' | 'monat' | 'jahr';
  type CompareType = 'vorperiode' | 'vorjahr';
  let timeUnit = $state<TimeUnit>('woche');
  let timeIdx = $state(0); // 0 = latest period
  let compareType = $state<CompareType>('vorperiode');

  let availableDates = $state<string[]>([]);
  let availableKWs = $state<string[]>([]);
  let availableMonths = $state<string[]>([]);
  let availableYears = $state<string[]>([]);

  // Today's info label
  const _now = new Date();
  const _oneJan = new Date(_now.getFullYear(), 0, 1);
  const _kw = String(Math.ceil(((_now.getTime() - _oneJan.getTime()) / 86400000 + _oneJan.getDay() + 1) / 7)).padStart(2, '0');
  const todayLabel = `${_now.getDate().toString().padStart(2,'0')}.${(_now.getMonth()+1).toString().padStart(2,'0')}.${_now.getFullYear()} · ${MONAT_ORDER[_now.getMonth()]} · KW ${_kw}`;

  let periods = $derived.by((): string[] => {
    if (timeUnit === 'tag') return availableDates;
    if (timeUnit === 'woche') return availableKWs;
    if (timeUnit === 'monat') return availableMonths;
    return availableYears;
  });
  let currentPeriod = $derived(periods.length > 0 ? periods[periods.length - 1 - timeIdx] : '');
  let comparePeriod = $derived.by((): string => {
    if (!currentPeriod || periods.length < 2) return '';
    const ci = periods.indexOf(currentPeriod);
    if (compareType === 'vorperiode') return ci > 0 ? periods[ci - 1] : '';
    // vorjahr: same period key but previous year
    if (compareType === 'vorjahr') {
      if (timeUnit === 'jahr') {
        const prevY = String(Number(currentPeriod) - 1);
        return periods.includes(prevY) ? prevY : '';
      }
      const [y, rest] = currentPeriod.split('-');
      const prevYearKey = `${Number(y) - 1}-${rest}`;
      return periods.includes(prevYearKey) ? prevYearKey : '';
    }
    return '';
  });
  let currentPeriodLabel = $derived.by((): string => {
    if (!currentPeriod) return '';
    if (timeUnit === 'tag') { const [y, m, d] = currentPeriod.split('-'); return `${d}.${m}.${y}`; }
    if (timeUnit === 'woche') { const [y, k] = currentPeriod.split('-'); return `KW ${k} · ${y}`; }
    if (timeUnit === 'monat') { const [y, m] = currentPeriod.split('-'); return `${m} ${y}`; }
    return currentPeriod;
  });
  let comparePeriodLabel = $derived.by((): string => {
    if (!comparePeriod) return '';
    if (timeUnit === 'tag') { const [y, m, d] = comparePeriod.split('-'); return `${d}.${m}.${y}`; }
    if (timeUnit === 'woche') { const [y, k] = comparePeriod.split('-'); return `KW ${k} · ${y}`; }
    if (timeUnit === 'monat') { const [y, m] = comparePeriod.split('-'); return `${m} ${y}`; }
    return comparePeriod;
  });
  // Date range formatting: "2026-03-02" → "02.03."
  function fmtDateShort(iso: string): string {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.`;
  }
  function fmtDateFull(iso: string): string {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }
  let currentDateRange = $derived.by((): string => {
    if (!currentPeriod || timeUnit === 'tag') return '';
    const range = periodDateRange.get(currentPeriod);
    if (!range) return '';
    return `${fmtDateShort(range.min)} – ${fmtDateShort(range.max)}`;
  });
  let compareDateRange = $derived.by((): string => {
    if (!comparePeriod || timeUnit === 'tag') return '';
    const range = periodDateRange.get(comparePeriod);
    if (!range) return '';
    return `${fmtDateShort(range.min)} – ${fmtDateShort(range.max)}`;
  });
  function periodFilter(r: RawRow, p: string): boolean {
    if (timeUnit === 'tag') return r.Datum === p;
    if (timeUnit === 'woche') { const [y, k] = p.split('-'); return (r as any).Jahr === y && r.KW === k; }
    if (timeUnit === 'monat') { const [y, m] = p.split('-'); return (r as any).Jahr === y && r.Monat === m; }
    if (timeUnit === 'jahr') return (r as any).Jahr === p;
    return true;
  }
  function goPrev() { if (timeIdx < periods.length - 1) timeIdx++; }
  function goNext() { if (timeIdx > 0) timeIdx--; }
  function switchTimeUnit(u: TimeUnit) { timeUnit = u; timeIdx = 0; }

  // UI state
  let expandedL1 = $state(new Set<string>());
  let expandedL2 = $state(new Set<string>());
  let expandedL3 = $state(new Set<string>());
  let expandedArticles = $state(new Set<string>());
  let subGroupSort = $state(new Map<string, 'umsatz' | 'anzahl'>());
  let articleSort = $state(new Map<string, 'umsatz' | 'anzahl'>());
  let searchTerm = $state('');
  let sortKey = $state<'umsatz' | 'anzahl' | 'avgPreis' | 'name' | 'anteil'>('umsatz');
  let sortDir = $state<'asc' | 'desc'>('desc');
  let lightboxUrl = $state('');
  // Artikel tab state
  let artikelSortMode = $state<'umsatz' | 'anzahl'>('umsatz');
  let artikelHideLow = $state(false);
  let artikelMinCount = 5;

  // ─── Derived: filtered data ───
  let hasFilter = $derived(currentPeriod !== '');

  let filteredData = $derived.by(() => {
    if (!allData.length || !currentPeriod) return allData;
    return getRowsForPeriod(currentPeriod);
  });

  let compareData = $derived.by(() => {
    if (!allData.length || !comparePeriod) return [];
    return getRowsForPeriod(comparePeriod);
  });

  // Comparison lookup: key → { umsatz, anzahl } for L1 groups
  let compLookup = $derived.by(() => {
    const map = new Map<string, { umsatz: number; anzahl: number }>();
    if (!compareData.length) return map;
    // Build for all possible L1 groupings across tabs
    // We use a general approach: for current tab's L1 field, aggregate compare data
    return map; // Will be computed per-tab in display
  });

  // ─── Reactive aggregation (all $derived, no $effect) ───
  function groupByField(rows: RawRow[], field: string, total: number, subFields?: string[]): GroupNode[] {
    const map = new Map<string, RawRow[]>();
    for (const r of rows) { const k = (r as any)[field] || '(leer)'; if (!map.has(k)) map.set(k, []); map.get(k)!.push(r); }
    return Array.from(map.entries()).map(([n, rr]) => buildGroup(n, rr, total, subFields)).sort((a, b) => b.umsatz - a.umsatz);
  }

  // ─── Lazy per-tab aggregation (only compute what's visible) ───
  let totalUmsatz = $derived(filteredData.reduce((s, r) => s + (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0), 0));
  let totalAnzahl = $derived(filteredData.reduce((s, r) => s + (Number(r.Anzahl) || 0), 0));

  // Cache: only recompute when period changes, not when tab changes
  let _aggCache = $state<{ period: string; field: string; result: GroupNode[] } | null>(null);
  function lazyGroupBy(field: string, subFields?: string[]): GroupNode[] {
    if (_aggCache && _aggCache.period === currentPeriod && _aggCache.field === field) return _aggCache.result;
    const result = groupByField(filteredData, field, totalUmsatz, subFields);
    _aggCache = { period: currentPeriod, field, result };
    return result;
  }

  // Legacy compat: agg object for Dashboard & other uses
  let agg = $derived.by(() => {
    if (!filteredData.length) return null;
    return { total: totalUmsatz, totalAnzahl };
  });

  let compTotalUmsatz = $derived(compareData.reduce((s, r) => s + (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0), 0));
  let compTotalAnzahl = $derived(compareData.reduce((s, r) => s + (Number(r.Anzahl) || 0), 0));

  // Pre-filtered data for AreaChart (only last 10 visible periods instead of all 167k)
  let areaChartData = $derived.by(() => {
    if (!allData.length || !currentPeriod || !periods.length) return [];
    const ci = periods.indexOf(currentPeriod);
    if (ci < 0) return [];
    const start = Math.max(0, ci - 9);
    const visiblePeriods = periods.slice(start, ci + 1);
    return getRowsForPeriods(visiblePeriods);
  });

  // Pre-filtered last30 data for Dashboard (using index, not scanning 167k)
  let last30Rows = $derived.by(() => {
    if (!allData.length || !periods.length) return [];
    const last30 = periods.slice(-30);
    return getRowsForPeriods(last30);
  });

  // All articles for Artikel tab
  let allArticles = $derived.by(() => {
    if (!filteredData.length) return { items: [] as ArticleNode[], sonstige: null as ArticleNode | null };
    const artMap = new Map<string, { nr: string; umsatz: number; anzahl: number; kassen: Map<string, number> }>();
    for (const r of filteredData) {
      const bid = String(r.BildId);
      if (!bid || bid === '0') continue;
      if (!artMap.has(bid)) artMap.set(bid, { nr: String(r.Nr || ''), umsatz: 0, anzahl: 0, kassen: new Map() });
      const a = artMap.get(bid)!;
      if (!a.nr && r.Nr) a.nr = String(r.Nr);
      const an = Number(r.Anzahl) || 0;
      a.umsatz += (Number(r.EinzelPreis) || 0) * an;
      a.anzahl += an;
      a.kassen.set(r.Kasse, (a.kassen.get(r.Kasse) || 0) + an);
    }
    let items: ArticleNode[] = Array.from(artMap.entries()).map(([bildId, a]) => ({
      bildId, nr: a.nr, umsatz: a.umsatz, anzahl: a.anzahl,
      kassenStats: Array.from(a.kassen.entries()).map(([kasse, anzahl]) => ({ kasse, anzahl })).sort((x, y) => y.anzahl - x.anzahl),
    }));
    items.sort((a, b) => artikelSortMode === 'umsatz' ? b.umsatz - a.umsatz : b.anzahl - a.anzahl);
    if (!artikelHideLow) return { items, sonstige: null };
    const shown: ArticleNode[] = [];
    let sU = 0, sA = 0;
    const sK = new Map<string, number>();
    for (const art of items) {
      if (art.anzahl >= artikelMinCount) { shown.push(art); }
      else { sU += art.umsatz; sA += art.anzahl; for (const ks of art.kassenStats) sK.set(ks.kasse, (sK.get(ks.kasse) || 0) + ks.anzahl); }
    }
    const sonstige: ArticleNode | null = sA > 0 ? { bildId: '', nr: '', umsatz: sU, anzahl: sA,
      kassenStats: Array.from(sK.entries()).map(([kasse, anzahl]) => ({ kasse, anzahl })).sort((x, y) => y.anzahl - x.anzahl),
    } : null;
    return { items: shown, sonstige };
  });

  // Compare L1 lookup for showing (vergleich) in the table
  let compGroupLookup = $derived.by(() => {
    const map = new Map<string, Map<string, { umsatz: number; anzahl: number }>>();
    if (!compareData.length) return map;
    // Build for common L1 fields
    for (const field of ['Kollektion', 'Form', 'Art', 'FormPfad', 'Kasse', 'Preisgruppe', 'SubKollektion']) {
      const fmap = new Map<string, { umsatz: number; anzahl: number }>();
      for (const r of compareData) {
        const k = (r as any)[field] || '(leer)';
        if (!fmap.has(k)) fmap.set(k, { umsatz: 0, anzahl: 0 });
        const g = fmap.get(k)!;
        const an = Number(r.Anzahl) || 0;
        g.umsatz += (Number(r.EinzelPreis) || 0) * an;
        g.anzahl += an;
      }
      map.set(field, fmap);
    }
    return map;
  });

  // Helper: get L1 compare field for current tab
  function getCompField(): string {
    if (activeTab === 'kollektion') return 'Kollektion';
    if (activeTab === 'form') return 'Form';
    if (activeTab === 'art') return 'Art';
    if (activeTab === 'formpfad') return 'FormPfad';
    if (activeTab === 'preis') return 'Preisgruppe';
    if (activeTab === 'kasse') return 'Kasse';
    if (activeTab === 'custom') return customDim1 || 'Kollektion';
    return '';
  }

  function getComp(name: string): { umsatz: number; anzahl: number } | null {
    if (!compareData.length) return null;
    const field = getCompField();
    return compGroupLookup.get(field)?.get(name) || null;
  }

  function fmtDelta(cur: number, prev: number): string {
    if (!prev || prev === 0) return '';
    const pct = ((cur / prev) - 1) * 100;
    if (pct > 0) return `(+${pct.toFixed(0)}%)`;
    if (pct < 0) return `(${pct.toFixed(0)}%)`;
    return '(±0%)';
  }

  // Custom tab: build dynamically
  let customGroups = $derived.by(() => {
    if (activeTab !== 'custom' || !filteredData.length || !customDim1) return [];
    const dims = [customDim1, customDim2, customDim3, customDim4].filter(d => d !== '') as string[];
    if (dims.length === 0) return [];
    let total = totalUmsatz;
    const byFirst = new Map<string, RawRow[]>();
    for (const r of filteredData) { const k = (r as any)[dims[0]] || '(leer)'; if (!byFirst.has(k)) byFirst.set(k, []); byFirst.get(k)!.push(r); }
    return Array.from(byFirst.entries())
      .map(([n, rows]) => buildGroup(n, rows, total, dims.length > 1 ? dims.slice(1) : undefined))
      .sort((a, b) => b.umsatz - a.umsatz);
  });

  let currentGroups = $derived.by((): GroupNode[] => {
    if (!filteredData.length) return [];
    switch (activeTab) {
      case 'kollektion': return kollSubMode === 'subkollektion'
        ? groupByField(filteredData, 'Kollektion', totalUmsatz, ['SubKollektion'])
        : groupByField(filteredData, 'Kollektion', totalUmsatz);
      case 'form': return groupByField(filteredData, 'Form', totalUmsatz, ['Kollektion']);
      case 'art': return groupByField(filteredData, 'Art', totalUmsatz, ['Kollektion']);
      case 'formpfad': return groupByField(filteredData, 'FormPfad', totalUmsatz, ['Form', 'Kollektion']);
      case 'kasse': return groupByField(filteredData, 'Kasse', totalUmsatz, ['Kollektion']);
      case 'preis': {
        const preisRanges = ['0 – 20 €', '20 – 50 €', '50 – 120 €', '120 – 250 €', 'über 250 €'];
        const byPreis = new Map<string, RawRow[]>();
        for (const r of filteredData) { const pg = (r as any).Preisgruppe; if (!byPreis.has(pg)) byPreis.set(pg, []); byPreis.get(pg)!.push(r); }
        const sub = preisSubTab === 'kollektion' ? ['Kollektion'] : ['Form', 'Kollektion'];
        return preisRanges.filter(p => byPreis.has(p)).map(p => buildGroup(p, byPreis.get(p)!, totalUmsatz, sub));
      }
      case 'custom': return customGroups;
      default: return [];
    }
  });

  let filtered = $derived.by(() => {
    let list = currentGroups;
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(t));
    }
    list = [...list].sort((a, b) => {
      let cmp: number;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name, 'de');
      else cmp = (a as any)[sortKey] - (b as any)[sortKey];
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return list;
  });

  // ─── Helpers ───
  function imgUrl(bid: string | number, size = 200): string {
    const id = typeof bid === 'number' ? Math.round(bid) : bid;
    return `https://konplott-cdn.com/mytism/image/${id}/${id}.jpg?width=${size}&height=${size}&box=true`;
  }
  function fmtEUR(v: number) { return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }); }
  function fmtNum(v: number) { return v.toLocaleString('de-DE', { maximumFractionDigits: 0 }); }
  function fmtPct(v: number) { return v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %'; }

  function toggleSet(set: Set<string>, key: string): Set<string> {
    const s = new Set(set);
    if (s.has(key)) s.delete(key); else s.add(key);
    return s;
  }
  function getMapVal(map: Map<string, 'umsatz' | 'anzahl'>, key: string) { return map.get(key) || 'umsatz'; }
  function setMapVal(map: Map<string, 'umsatz' | 'anzahl'>, key: string, v: 'umsatz' | 'anzahl') { const m = new Map(map); m.set(key, v); return m; }

  function setSort(key: typeof sortKey) {
    if (sortKey === key) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
    else { sortKey = key; sortDir = 'desc'; }
  }

  function switchTab(t: TabId) {
    activeTab = t;
    expandedL1 = new Set(); expandedL2 = new Set(); expandedL3 = new Set(); expandedArticles = new Set();
    searchTerm = '';
  }

  function sortItems<T extends { umsatz: number; anzahl: number }>(items: T[], mode: 'umsatz' | 'anzahl'): T[] {
    return [...items].sort((a, b) => mode === 'umsatz' ? b.umsatz - a.umsatz : b.anzahl - a.anzahl);
  }

  // ─── Build articles from raw rows ───
  function buildArticles(rows: RawRow[], total: number): ArticleNode[] {
    const artMap = new Map<string, { umsatz: number; anzahl: number; kassen: Map<string, number> }>();
    for (const r of rows) {
      const bid = String(r.BildId);
      if (!bid || bid === '0') continue;
      if (!artMap.has(bid)) artMap.set(bid, { umsatz: 0, anzahl: 0, kassen: new Map() });
      const a = artMap.get(bid)!;
      const an = Number(r.Anzahl) || 0;
      a.umsatz += (Number(r.EinzelPreis) || 0) * an;
      a.anzahl += an;
      a.kassen.set(r.Kasse, (a.kassen.get(r.Kasse) || 0) + an);
    }
    return Array.from(artMap.entries()).map(([bildId, a]) => ({
      bildId, umsatz: a.umsatz, anzahl: a.anzahl,
      kassenStats: Array.from(a.kassen.entries()).map(([kasse, anzahl]) => ({ kasse, anzahl })).sort((x, y) => y.anzahl - x.anzahl),
    })).sort((a, b) => b.umsatz - a.umsatz);
  }

  function buildGroup(name: string, rows: RawRow[], total: number, subGroupFields?: string[]): GroupNode {
    let umsatz = 0, anzahl = 0;
    for (const r of rows) { const an = Number(r.Anzahl) || 0; umsatz += (Number(r.EinzelPreis) || 0) * an; anzahl += an; }
    const articles = buildArticles(rows, total);
    const node: GroupNode = {
      name, thumbBildId: articles[0]?.bildId || '',
      umsatz, anzahl, avgPreis: anzahl > 0 ? umsatz / anzahl : 0,
      anteil: total > 0 ? (umsatz / total) * 100 : 0, articles,
    };
    if (subGroupFields && subGroupFields.length > 0) {
      const field = subGroupFields[0];
      const rest = subGroupFields.slice(1);
      const subMap = new Map<string, RawRow[]>();
      for (const r of rows) { const k = (r as any)[field] || '(leer)'; if (!subMap.has(k)) subMap.set(k, []); subMap.get(k)!.push(r); }
      node.subGroups = Array.from(subMap.entries())
        .map(([sn, sr]) => buildGroup(sn, sr, total, rest.length > 0 ? rest : undefined))
        .sort((a, b) => b.umsatz - a.umsatz);
    }
    return node;
  }

  // ─── Init ───
  function getPreisgruppe(ep: number): string {
    if (ep < 20) return '0 – 20 €';
    if (ep < 50) return '20 – 50 €';
    if (ep < 120) return '50 – 120 €';
    if (ep < 250) return '120 – 250 €';
    return 'über 250 €';
  }

  // ─── Period indices (built once at load, used for O(1) filtering) ───
  let weekIdx = $state(new Map<string, number[]>());
  let monthIdx = $state(new Map<string, number[]>());
  let dayIdx = $state(new Map<string, number[]>());
  let yearIdx = $state(new Map<string, number[]>());
  // Date range per period key: { min: "2026-03-02", max: "2026-03-08" }
  let periodDateRange = $state(new Map<string, { min: string; max: string }>());

  function getRowsForPeriod(period: string): RawRow[] {
    const idx = timeUnit === 'woche' ? weekIdx : timeUnit === 'monat' ? monthIdx : timeUnit === 'tag' ? dayIdx : yearIdx;
    return (idx.get(period) || []).map(i => allData[i]);
  }

  function getRowsForPeriods(periodList: string[]): RawRow[] {
    const idx = timeUnit === 'woche' ? weekIdx : timeUnit === 'monat' ? monthIdx : timeUnit === 'tag' ? dayIdx : yearIdx;
    const result: RawRow[] = [];
    for (const p of periodList) {
      const indices = idx.get(p);
      if (indices) for (const i of indices) result.push(allData[i]);
    }
    return result;
  }

  onMount(async () => {
    const res = await fetch('/data.json');
    const raw = await res.json();

    // Decode dictionary-encoded format
    const { d, r: rows } = raw;
    const decoded: RawRow[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      decoded[i] = {
        Kasse: d.K[row[0]],
        Kollektion: d.L[row[1]],
        SubKollektion: d.S[row[2]],
        Art: d.A[row[3]],
        Nr: d.N[row[4]],
        Form: d.F[row[5]],
        FormPfad: d.P[row[6]],
        BildId: row[7],
        Anzahl: row[8],
        EinzelPreis: row[9],
        Monat: row[10],
        KW: row[11],
        Datum: row[12],
      } as RawRow;
    }

    // Add computed fields
    for (const r of decoded) {
      (r as any).Preisgruppe = getPreisgruppe(Number(r.EinzelPreis) || 0);
      (r as any).Jahr = r.Datum ? r.Datum.slice(0, 4) : '2025';
    }

    // Read role from sessionStorage and filter by allowed Kassen
    const role = sessionStorage.getItem('miranda-role') || 'all';
    userRole = role;
    const kassenFilter = ROLE_KASSEN[role] || null;
    const filtered = kassenFilter
      ? decoded.filter(r => kassenFilter.includes(r.Kasse))
      : decoded;

    allData = filtered;

    // Build period indices for O(1) lookup
    const _wk = new Map<string, number[]>();
    const _mo = new Map<string, number[]>();
    const _dy = new Map<string, number[]>();
    const _yr = new Map<string, number[]>();

    for (let i = 0; i < allData.length; i++) {
      const r = allData[i];
      const y = (r as any).Jahr;

      const wKey = `${y}-${r.KW}`;
      if (!_wk.has(wKey)) _wk.set(wKey, []);
      _wk.get(wKey)!.push(i);

      const mKey = `${y}-${r.Monat}`;
      if (!_mo.has(mKey)) _mo.set(mKey, []);
      _mo.get(mKey)!.push(i);

      if (!_dy.has(r.Datum)) _dy.set(r.Datum, []);
      _dy.get(r.Datum)!.push(i);

      if (!_yr.has(y)) _yr.set(y, []);
      _yr.get(y)!.push(i);
    }

    weekIdx = _wk;
    monthIdx = _mo;
    dayIdx = _dy;
    yearIdx = _yr;

    // Build date ranges per period (min/max Datum for each period key)
    const _ranges = new Map<string, { min: string; max: string }>();
    function updateRange(key: string, datum: string) {
      const r = _ranges.get(key);
      if (!r) { _ranges.set(key, { min: datum, max: datum }); return; }
      if (datum < r.min) r.min = datum;
      if (datum > r.max) r.max = datum;
    }
    for (const r of allData) {
      const y = (r as any).Jahr;
      const d = r.Datum;
      updateRange(`${y}-${r.KW}`, d);   // week
      updateRange(`${y}-${r.Monat}`, d); // month
      updateRange(d, d);                 // day
      updateRange(y, d);                 // year
    }
    periodDateRange = _ranges;

    // Populate filter options (year-scoped for months & KWs)
    availableYears = [..._yr.keys()].sort();
    availableMonths = [..._mo.keys()].sort((a, b) => {
      const [ya, ma] = a.split('-'), [yb, mb] = b.split('-');
      return ya !== yb ? ya.localeCompare(yb) : MONAT_ORDER.indexOf(ma) - MONAT_ORDER.indexOf(mb);
    });
    availableKWs = [..._wk.keys()].sort((a, b) => {
      const [ya, ka] = a.split('-'), [yb, kb] = b.split('-');
      return ya !== yb ? ya.localeCompare(yb) : Number(ka) - Number(kb);
    });
    availableDates = [..._dy.keys()].sort();

    // Default: current KW in current year
    const now = new Date();
    const currentYear = String(now.getFullYear());
    const oneJan = new Date(now.getFullYear(), 0, 1);
    const currentKW = String(Math.ceil(((now.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7)).padStart(2, '0');
    const currentYearKW = `${currentYear}-${currentKW}`;
    timeUnit = 'woche';
    const kwI = availableKWs.indexOf(currentYearKW);
    if (kwI >= 0) {
      timeIdx = availableKWs.length - 1 - kwI;
    } else {
      timeIdx = 0;
    }

    loading = false;
  });

  const HOME_TAB: { id: TabId; label: string } = { id: 'dashboard', label: 'Dashboard' };
  const DRILL_TABS: { id: TabId; label: string }[] = [
    { id: 'kollektion', label: 'Kollektionen' },
    { id: 'artikel', label: 'Artikel' },
    { id: 'form', label: 'Form' },
    { id: 'art', label: 'Typ' },
    { id: 'formpfad', label: 'FormPfad' },
    { id: 'preis', label: 'Preisgruppe' },
    { id: 'kasse', label: 'Kasse' },
    { id: 'custom', label: 'Individuell' },
  ];
  const CHART_TABS: { id: TabId; label: string }[] = [
    { id: 'bar', label: 'Säulen' },
    { id: 'bubble', label: 'Bubble' },
    { id: 'pie', label: 'Donuts' },
    { id: 'area', label: 'Flächen' },
  ];
</script>

<div class="min-h-screen" style="background: var(--warm-50);">
  <!-- Header -->
  <header class="sticky top-0 z-40 backdrop-blur-xl" style="background: rgba(250,248,245,0.85); border-bottom: 1px solid var(--warm-200);">
    <div class="max-w-6xl mx-auto px-5 pt-4 pb-0">
      <div class="flex items-center justify-between gap-4 mb-3">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight" style="font-family: var(--font-display); color: var(--warm-800);">Mirandas Liste</h1>
          <p class="text-xs mt-0.5" style="color: var(--warm-400);">
            {fmtNum(filtered.length)} Einträge · {fmtEUR(totalUmsatz)} Gesamtumsatz
            {#if roleLabel}<span class="ml-1 px-2 py-0.5 rounded-full text-[9px] font-semibold" style="background: var(--accent); color: white;">{roleLabel}</span>{/if}
          </p>
        </div>
        <div class="flex items-center gap-3">
          <button onclick={() => { sessionStorage.removeItem('miranda-auth'); sessionStorage.removeItem('miranda-role'); location.reload(); }}
            class="flex items-center gap-1.5 px-3 py-2 text-[10px] font-medium rounded-xl transition-all"
            style="border: 1.5px solid var(--warm-200); color: var(--warm-500); background: white;"
            onmouseenter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
            onmouseleave={(e) => { e.currentTarget.style.borderColor = 'var(--warm-200)'; e.currentTarget.style.color = 'var(--warm-500)'; }}
            title="Abmelden / Kasse wechseln">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Logout
          </button>
          <div class="relative">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style="color: var(--warm-400);" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <input type="text" bind:value={searchTerm} placeholder="Suchen..."
              class="pl-10 pr-4 py-2 text-sm rounded-xl w-56 outline-none transition-all"
              style="border: 1.5px solid var(--warm-200); font-family: var(--font-body); background: white;"
              onfocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
              onblur={(e) => e.currentTarget.style.borderColor = 'var(--warm-200)'} />
          </div>
        </div>
      </div>
      <!-- Time Navigation -->
      <div class="flex flex-wrap items-center gap-3 mb-2 py-3 rounded-xl px-4" style="background: linear-gradient(135deg, var(--warm-100), #f5efe8); border: 2px solid var(--accent); box-shadow: 0 2px 8px rgba(176,124,62,0.12);">
        <div class="flex items-center gap-2">
          <span class="text-[9px] font-bold uppercase tracking-[0.15em]" style="color: var(--accent);">Zeitraum:</span>
          <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
            {#each ([['tag','Tag'],['woche','Woche'],['monat','Monat'],['jahr','Jahr']] as const) as [val, label], pi}
              <button onclick={() => switchTimeUnit(val)} class="px-3 py-1 text-[10px] font-semibold"
                style="background: {timeUnit === val ? 'var(--accent)' : 'white'}; color: {timeUnit === val ? 'white' : 'var(--warm-500)'}; {pi > 0 ? 'border-left: 1px solid var(--warm-200)' : ''};">{label}</button>
            {/each}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button onclick={goPrev} disabled={timeIdx >= periods.length - 1} class="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold disabled:opacity-25" style="background: var(--accent); color: white;">&#9664;</button>
          <div class="text-center min-w-20">
            <p class="text-sm font-bold" style="color: var(--warm-800); font-family: var(--font-heading);">{currentPeriodLabel}</p>
            {#if currentDateRange}<p class="text-[8px]" style="color: var(--warm-400);">{currentDateRange}</p>{/if}
          </div>
          <button onclick={goNext} disabled={timeIdx <= 0} class="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold disabled:opacity-25" style="background: var(--accent); color: white;">&#9654;</button>
          {#if comparePeriodLabel}
            <div class="text-center min-w-20 ml-1 pl-2" style="border-left: 1px solid var(--warm-300);">
              <p class="text-[9px] font-medium" style="color: var(--warm-400);">vs {comparePeriodLabel}</p>
              {#if compareDateRange}<p class="text-[8px]" style="color: var(--warm-300);">{compareDateRange}</p>{/if}
            </div>
          {/if}
        </div>
        <div class="flex items-center gap-2 ml-1 pl-2" style="border-left: 1.5px solid var(--warm-300);">
          <span class="text-[9px] font-bold uppercase tracking-[0.12em]" style="color: var(--accent);">Vergleich:</span>
          <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
            <button onclick={() => compareType = 'vorperiode'} class="px-2.5 py-1 text-[10px] font-medium"
              style="background: {compareType === 'vorperiode' ? 'var(--accent)' : 'white'}; color: {compareType === 'vorperiode' ? 'white' : 'var(--warm-500)'};">Vorperiode</button>
            <button onclick={() => compareType = 'vorjahr'} class="px-2.5 py-1 text-[10px] font-medium"
              style="background: {compareType === 'vorjahr' ? 'var(--accent)' : 'white'}; color: {compareType === 'vorjahr' ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">Jahresvergleich</button>
          </div>
        </div>
        {#if compareData.length > 0}
          <span class="text-[9px] px-2 py-0.5 rounded-full" style="background: var(--warm-200); color: var(--warm-600);">
            Vgl: {compTotalAnzahl > 0 ? fmtNum(compTotalAnzahl) + ' Stk' : 'keine Daten'}
          </span>
        {/if}
        <div class="ml-auto text-right">
          <p class="text-[10px] font-semibold" style="color: var(--warm-600);">Heute: {todayLabel}</p>
        </div>
      </div>
      <!-- Tabs -->
      <div class="flex flex-col gap-0 -mb-px overflow-x-auto">
        <!-- Line 1: Home + Dashboard -->
        <div class="flex items-center gap-0">
          <button onclick={() => switchTab(HOME_TAB.id)}
            class="px-4 py-2 text-xs font-bold transition-all border-b-2 whitespace-nowrap flex items-center gap-1.5"
            style="color: {activeTab === HOME_TAB.id ? 'var(--accent)' : 'var(--warm-400)'}; border-color: {activeTab === HOME_TAB.id ? 'var(--accent)' : 'transparent'}; font-family: var(--font-body);">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            {HOME_TAB.label}
          </button>
        </div>
        <!-- Line 2: Drill Down -->
        <div class="flex items-center gap-0">
          <span class="px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.15em] whitespace-nowrap" style="color: var(--warm-400);">Drill Down</span>
          {#each DRILL_TABS as tab}
            <button onclick={() => switchTab(tab.id)}
              class="px-3 py-1.5 text-[11px] font-semibold transition-all border-b-2 whitespace-nowrap hover:text-[var(--accent)]"
              style="color: {activeTab === tab.id ? 'var(--accent)' : 'var(--warm-600)'}; border-color: {activeTab === tab.id ? 'var(--accent)' : 'transparent'}; font-family: var(--font-body); {activeTab !== tab.id ? 'text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--warm-300);' : ''} cursor: pointer;">
              {tab.label}
            </button>
          {/each}
        </div>
        <!-- Line 3: Diagramme -->
        <div class="flex items-center gap-0">
          <span class="px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.15em] whitespace-nowrap" style="color: var(--warm-400);">Diagramme</span>
          {#each CHART_TABS as tab}
            <button onclick={() => switchTab(tab.id)}
              class="px-3 py-1.5 text-[11px] font-semibold transition-all border-b-2 whitespace-nowrap hover:text-[var(--accent)]"
              style="color: {activeTab === tab.id ? 'var(--accent)' : 'var(--warm-600)'}; border-color: {activeTab === tab.id ? 'var(--accent)' : 'transparent'}; font-family: var(--font-body); {activeTab !== tab.id ? 'text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--warm-300);' : ''} cursor: pointer;">
              {tab.label}
            </button>
          {/each}
        </div>
      </div>
      {#if activeTab === 'preis'}
        <div class="flex items-center gap-2 py-2 border-t" style="border-color: var(--warm-100);">
          <p class="text-[10px] font-medium" style="color: var(--warm-400);">Aufschlüsseln nach:</p>
          <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
            <button onclick={() => { preisSubTab = 'formpfad'; expandedL1 = new Set(); expandedL2 = new Set(); expandedL3 = new Set(); expandedArticles = new Set(); }}
              class="px-3 py-1 text-[11px] font-medium"
              style="background: {preisSubTab === 'formpfad' ? 'var(--accent)' : 'white'}; color: {preisSubTab === 'formpfad' ? 'white' : 'var(--warm-500)'};">
              FormPfad
            </button>
            <button onclick={() => { preisSubTab = 'kollektion'; expandedL1 = new Set(); expandedL2 = new Set(); expandedL3 = new Set(); expandedArticles = new Set(); }}
              class="px-3 py-1 text-[11px] font-medium"
              style="background: {preisSubTab === 'kollektion' ? 'var(--accent)' : 'white'}; color: {preisSubTab === 'kollektion' ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">
              Kollektion
            </button>
          </div>
        </div>
      {/if}
      {#if activeTab === 'kollektion'}
        <div class="flex items-center gap-2 py-2 border-t" style="border-color: var(--warm-100);">
          <p class="text-[10px] font-medium" style="color: var(--warm-400);">Aufklappen zeigt:</p>
          <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
            <button onclick={() => { kollSubMode = 'artikel'; expandedL1 = new Set(); expandedL2 = new Set(); expandedL3 = new Set(); expandedArticles = new Set(); }}
              class="px-3 py-1 text-[11px] font-medium"
              style="background: {kollSubMode === 'artikel' ? 'var(--accent)' : 'white'}; color: {kollSubMode === 'artikel' ? 'white' : 'var(--warm-500)'};">
              Artikel
            </button>
            <button onclick={() => { kollSubMode = 'subkollektion'; expandedL1 = new Set(); expandedL2 = new Set(); expandedL3 = new Set(); expandedArticles = new Set(); }}
              class="px-3 py-1 text-[11px] font-medium"
              style="background: {kollSubMode === 'subkollektion' ? 'var(--accent)' : 'white'}; color: {kollSubMode === 'subkollektion' ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">
              SubKollektion
            </button>
          </div>
        </div>
      {/if}
      {#if activeTab === 'custom'}
        <div class="flex flex-wrap items-center gap-3 py-2 border-t" style="border-color: var(--warm-100);">
          {#each [
            { label: 'Ebene 1', idx: 0 },
            { label: 'Ebene 2', idx: 1 },
            { label: 'Ebene 3', idx: 2 },
            { label: 'Ebene 4', idx: 3 },
          ] as lvl}
            {@const vals = [customDim1, customDim2, customDim3, customDim4]}
            {@const cur = vals[lvl.idx]}
            {@const prevEmpty = lvl.idx > 0 && vals[lvl.idx - 1] === ''}
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] font-semibold" style="color: var(--warm-400);">{lvl.label}:</span>
              <select
                value={cur}
                onchange={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value as DimOption;
                  if (lvl.idx === 0) customDim1 = v;
                  else if (lvl.idx === 1) customDim2 = v;
                  else if (lvl.idx === 2) customDim3 = v;
                  else customDim4 = v;
                  // Clear deeper levels if set to empty
                  if (v === '') { if (lvl.idx <= 1) customDim2 = ''; if (lvl.idx <= 2) customDim3 = ''; customDim4 = ''; }
                  expandedL1 = new Set(); expandedL2 = new Set(); expandedL3 = new Set(); expandedArticles = new Set();
                }}
                class="text-[11px] py-1 px-2 rounded-lg outline-none"
                style="border: 1px solid var(--warm-200); font-family: var(--font-body); color: var(--warm-700); background: {prevEmpty ? 'var(--warm-50)' : 'white'};"
                disabled={prevEmpty}>
                {#if lvl.idx > 0}<option value="">— keine —</option>{/if}
                {#each DIM_OPTIONS.filter(o => o.value !== '') as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </header>

  {#if loading}
    <div class="flex items-center justify-center h-80">
      <div class="w-10 h-10 rounded-full animate-spin mx-auto" style="border: 3px solid var(--warm-200); border-top-color: var(--accent);"></div>
    </div>
  {:else}
    <!-- KPIs -->
    <div class="max-w-6xl mx-auto px-5 pt-5 pb-4">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
          <p class="text-[9px] font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">Umsatz</p>
          <p class="text-lg font-bold mt-0.5 tabular-nums" style="color: var(--warm-800);">{fmtEUR(totalUmsatz)}</p>
          {#if compTotalUmsatz > 0}<p class="text-[10px] tabular-nums" style="color: {totalUmsatz > compTotalUmsatz ? '#6b8e5a' : totalUmsatz < compTotalUmsatz ? '#c06050' : 'var(--warm-400)'};">Vgl: {fmtEUR(compTotalUmsatz)} {fmtDelta(totalUmsatz, compTotalUmsatz)}</p>{/if}
        </div>
        <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
          <p class="text-[9px] font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">Stück</p>
          <p class="text-lg font-bold mt-0.5 tabular-nums" style="color: var(--warm-800);">{fmtNum(totalAnzahl)}</p>
          {#if compTotalAnzahl > 0}<p class="text-[10px] tabular-nums" style="color: {totalAnzahl > compTotalAnzahl ? '#6b8e5a' : totalAnzahl < compTotalAnzahl ? '#c06050' : 'var(--warm-400)'};">Vgl: {fmtNum(compTotalAnzahl)} {fmtDelta(totalAnzahl, compTotalAnzahl)}</p>{/if}
        </div>
        <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);"><p class="text-[9px] font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">Einträge</p><p class="text-lg font-bold mt-0.5" style="color: var(--warm-800);">{fmtNum(currentGroups.length)}</p></div>
        <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);"><p class="text-[9px] font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">⌀ Preis</p><p class="text-lg font-bold mt-0.5 tabular-nums" style="color: var(--warm-800);">{fmtEUR(totalAnzahl > 0 ? totalUmsatz / totalAnzahl : 0)}</p></div>
      </div>
    </div>

    <!-- Table / Charts -->
    {#if activeTab === 'dashboard'}
      <div class="max-w-6xl mx-auto px-5 pb-10">
        <Dashboard data={filteredData} compareData={compareData} allData={last30Rows} {timeUnit} {periods}
          currentLabel={currentPeriodLabel} compareLabel={comparePeriodLabel} />
      </div>
    {:else if activeTab === 'bubble'}
      <div class="max-w-6xl mx-auto px-5 pb-10">
        <div class="rounded-2xl p-5" style="background: white; border: 1px solid var(--warm-200); box-shadow: 0 4px 20px rgba(0,0,0,0.03);">
          <BubbleChart data={filteredData} />
        </div>
      </div>
    {:else if activeTab === 'bar'}
      <div class="max-w-6xl mx-auto px-5 pb-10">
        <div class="rounded-2xl p-5" style="background: white; border: 1px solid var(--warm-200); box-shadow: 0 4px 20px rgba(0,0,0,0.03);">
          <BarChart data={filteredData} compareData={compareData} />
        </div>
      </div>
    {:else if activeTab === 'pie'}
      <div class="max-w-6xl mx-auto px-5 pb-10">
        <div class="rounded-2xl p-5" style="background: white; border: 1px solid var(--warm-200); box-shadow: 0 4px 20px rgba(0,0,0,0.03);">
          <PieChart data={filteredData} />
        </div>
      </div>
        {:else if activeTab === 'area'}
      <div class="max-w-6xl mx-auto px-5 pb-10">
        <div class="rounded-2xl p-5" style="background: white; border: 1px solid var(--warm-200); box-shadow: 0 4px 20px rgba(0,0,0,0.03);">
          <AreaChart data={areaChartData} {timeUnit} {currentPeriod} {periods} />
        </div>
      </div>
    {:else if activeTab === 'artikel'}
      <div class="max-w-6xl mx-auto px-5 pb-10">
        <div class="rounded-2xl p-5" style="background: white; border: 1px solid var(--warm-200); box-shadow: 0 4px 20px rgba(0,0,0,0.03);">
          <div class="flex flex-wrap items-center gap-4 mb-4">
            <div class="flex items-center gap-2">
              <p class="text-[10px] font-semibold uppercase tracking-[0.12em]" style="color: var(--warm-400);">Sortierung:</p>
              <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
                <button onclick={() => artikelSortMode = 'umsatz'} class="px-3 py-1 text-[11px] font-medium"
                  style="background: {artikelSortMode === 'umsatz' ? 'var(--accent)' : 'white'}; color: {artikelSortMode === 'umsatz' ? 'white' : 'var(--warm-500)'};">Umsatz</button>
                <button onclick={() => artikelSortMode = 'anzahl'} class="px-3 py-1 text-[11px] font-medium"
                  style="background: {artikelSortMode === 'anzahl' ? 'var(--accent)' : 'white'}; color: {artikelSortMode === 'anzahl' ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">Anzahl</button>
              </div>
            </div>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" bind:checked={artikelHideLow} class="accent-[var(--accent)]" />
              <span class="text-[11px]" style="color: var(--warm-500);">Unter {artikelMinCount} Stk als „Sonstige“</span>
            </label>
            <p class="text-[10px] ml-auto" style="color: var(--warm-400);">{allArticles.items.length} Artikel{allArticles.sonstige ? ' + Sonstige' : ''}</p>
          </div>
          <div class="flex flex-wrap gap-3">
            {#each allArticles.items as art (art.bildId)}
              {@const aKey = `all::${art.bildId}`}
              {@const aOpen = expandedArticles.has(aKey)}
              <div class="flex flex-col">
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="cursor-pointer" onclick={() => expandedArticles = toggleSet(expandedArticles, aKey)}>
                  <div class="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden shadow-sm transition-all hover:shadow-lg hover:scale-105" style="border: 1.5px solid {aOpen ? 'var(--accent)' : 'var(--warm-200)'};">
                    <img src={imgUrl(art.bildId, 200)} alt="" class="w-full h-full object-cover" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).parentElement!.style.display='none'; }} />
                  </div>
                  <div class="mt-1.5 text-center">
                    <p class="text-[10px] font-medium tabular-nums" style="color: var(--warm-700);">{fmtEUR(art.umsatz)}</p>
                    <p class="text-[9px] tabular-nums" style="color: var(--warm-400);">{fmtNum(art.anzahl)} Stk</p>
                    {#if art.nr}<a href="https://www.konplott.com/go/{art.nr}" target="_blank" rel="noopener" class="text-[8px] underline hover:no-underline" style="color: var(--accent);" onclick={(e) => e.stopPropagation()}>Shop ↗</a>{/if}
                  </div>
                </div>
                {#if aOpen}
                  <div class="mt-2 w-52 sm:w-60 rounded-xl p-3 shadow-md" style="background: white; border: 1px solid var(--warm-200);">
                    <div class="flex items-center gap-2 mb-2">
                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                      <img src={imgUrl(art.bildId, 60)} alt="" class="w-7 h-7 rounded object-cover cursor-pointer" onclick={(e) => { e.stopPropagation(); lightboxUrl = imgUrl(art.bildId, 1000); }} />
                      <div>
                        <p class="text-[10px] font-semibold" style="color: var(--warm-700);">{fmtEUR(art.umsatz)} · {fmtNum(art.anzahl)} Stk</p>
                        {#if art.nr}<a href="https://www.konplott.com/go/{art.nr}" target="_blank" rel="noopener" class="text-[9px] underline" style="color: var(--accent);">konplott.com/go/{art.nr}</a>{/if}
                      </div>
                    </div>
                    <p class="text-[9px] font-semibold mb-1.5" style="color: var(--warm-400);">Verkäufe nach Kasse</p>
                    {#each art.kassenStats as ks}
                      <div class="flex items-center justify-between py-0.5"><span class="text-[10px] truncate" style="color: var(--warm-600); max-width: 120px;" title={ks.kasse}>{ks.kasse}</span><span class="text-[10px] tabular-nums font-medium" style="color: var(--warm-700);">{fmtNum(ks.anzahl)} Stk</span></div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
            {#if allArticles.sonstige}
              {@const sKey = 'all::sonstige'}
              {@const sOpen = expandedArticles.has(sKey)}
              <div class="flex flex-col">
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="cursor-pointer" onclick={() => expandedArticles = toggleSet(expandedArticles, sKey)}>
                  <div class="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden shadow-sm flex items-center justify-center" style="border: 1.5px solid {sOpen ? 'var(--accent)' : 'var(--warm-200)'}; background: var(--warm-100);">
                    <span class="text-xs font-bold" style="color: var(--warm-400);">Sonstige</span>
                  </div>
                  <div class="mt-1.5 text-center"><p class="text-[10px] font-medium tabular-nums" style="color: var(--warm-700);">{fmtEUR(allArticles.sonstige.umsatz)}</p><p class="text-[9px] tabular-nums" style="color: var(--warm-400);">{fmtNum(allArticles.sonstige.anzahl)} Stk</p></div>
                </div>
                {#if sOpen}
                  <div class="mt-2 w-52 sm:w-60 rounded-xl p-3 shadow-md" style="background: white; border: 1px solid var(--warm-200);">
                    <p class="text-[10px] font-semibold mb-1" style="color: var(--warm-700);">{fmtEUR(allArticles.sonstige.umsatz)} · {fmtNum(allArticles.sonstige.anzahl)} Stk</p>
                    <p class="text-[9px] font-semibold mb-1.5" style="color: var(--warm-400);">Verkäufe nach Kasse</p>
                    {#each allArticles.sonstige.kassenStats as ks}
                      <div class="flex items-center justify-between py-0.5"><span class="text-[10px] truncate" style="color: var(--warm-600); max-width: 120px;" title={ks.kasse}>{ks.kasse}</span><span class="text-[10px] tabular-nums font-medium" style="color: var(--warm-700);">{fmtNum(ks.anzahl)} Stk</span></div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </div>
    {:else}
    <div class="max-w-6xl mx-auto px-5 pb-10">
      <div class="rounded-2xl overflow-hidden" style="background: white; border: 1px solid var(--warm-200); box-shadow: 0 4px 20px rgba(0,0,0,0.03);">
        <!-- Headers -->
        <div class="grid items-center gap-2 px-5 py-3" style="grid-template-columns: 56px 1fr repeat(4, minmax(90px, auto)); border-bottom: 2px solid var(--warm-200); background: var(--warm-100);">
          <div></div>
          {#each [['name','Name'],['umsatz','Umsatz'],['anzahl','Stück'],['avgPreis','⌀ Preis'],['anteil','Anteil']] as [k, label]}
            <button onclick={() => setSort(k as any)} class="text-[10px] font-semibold uppercase tracking-[0.12em] cursor-pointer hover:opacity-70 transition-opacity {k === 'name' ? 'text-left' : 'text-right'}" style="color: var(--warm-500);">
              {label} {sortKey === k ? (sortDir === 'desc' ? '↓' : '↑') : ''}
            </button>
          {/each}
        </div>

        <!-- L1 Rows -->
        <div class="divide-y" style="border-color: var(--warm-100);">
          {#each filtered as g1 (g1.name)}
            {@const l1Open = expandedL1.has(g1.name)}
            {@const hasSubGroups = !!g1.subGroups && g1.subGroups.length > 0}
            {@const comp = getComp(g1.name)}
            <div>
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="grid items-center gap-2 px-5 py-3 cursor-pointer transition-colors hover:bg-[var(--warm-100)]/40"
                style="grid-template-columns: 56px 1fr repeat(4, minmax(90px, auto));"
                onclick={() => expandedL1 = toggleSet(expandedL1, g1.name)}>
                <div class="relative">
                  {#if g1.thumbBildId}
                    <img src={imgUrl(g1.thumbBildId, 100)} alt="" class="w-11 h-11 object-cover rounded-lg shadow-sm" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
                  {:else}
                    <div class="w-11 h-11 rounded-lg flex items-center justify-center text-xs font-bold" style="background: var(--warm-100); color: var(--warm-400);">{g1.name.slice(0,2)}</div>
                  {/if}
                  <div class="absolute -right-1 -bottom-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px] transition-transform" style="background: var(--accent); color: white;" class:rotate-180={l1Open}>▾</div>
                </div>
                <div class="min-w-0">
                  <p class="text-sm font-medium truncate" style="color: var(--warm-800);">{g1.name}</p>
                  <p class="text-[10px]" style="color: var(--warm-400);">{hasSubGroups ? `${g1.subGroups?.length} Kollektionen · ` : ''}{g1.articles.length} Artikel</p>
                </div>
                <p class="text-sm text-right tabular-nums font-medium" style="color: var(--warm-700);">{fmtEUR(g1.umsatz)}{#if comp && comp.umsatz > 0}<span class="text-[9px] ml-1" style="color: {g1.umsatz > comp.umsatz ? '#6b8e5a' : g1.umsatz < comp.umsatz ? '#c06050' : 'var(--warm-400)'};">{fmtDelta(g1.umsatz, comp.umsatz)}</span>{/if}</p>
                <p class="text-sm text-right tabular-nums" style="color: var(--warm-600);">{fmtNum(g1.anzahl)}{#if comp && comp.anzahl > 0}<span class="text-[9px] ml-1" style="color: {g1.anzahl > comp.anzahl ? '#6b8e5a' : g1.anzahl < comp.anzahl ? '#c06050' : 'var(--warm-400)'};">{fmtDelta(g1.anzahl, comp.anzahl)}</span>{/if}</p>
                <p class="text-sm text-right tabular-nums" style="color: var(--warm-600);">{fmtEUR(g1.avgPreis)}</p>
                <div class="text-right">
                  <p class="text-sm tabular-nums font-medium" style="color: var(--accent);">{fmtPct(g1.anteil)}</p>
                  <div class="w-full h-1 rounded-full mt-1 overflow-hidden" style="background: var(--warm-100);"><div class="h-full rounded-full" style="width: {Math.min(g1.anteil * 3, 100)}%; background: var(--accent);"></div></div>
                </div>
              </div>

              {#if l1Open}
                <div class="px-5 pb-5 pt-3" style="background: var(--warm-100); border-top: 1px solid var(--warm-200);">
                  {#if hasSubGroups}
                    <!-- L2: SubGroups -->
                    {@const sg1Sort = getMapVal(subGroupSort, g1.name)}
                    <div class="flex items-center gap-3 mb-3">
                      <p class="text-[10px] font-semibold uppercase tracking-[0.12em]" style="color: var(--warm-400);">{g1.subGroups?.[0]?.subGroups ? 'Formen' : 'Kollektionen'} — sortiert nach</p>
                      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
                        <button onclick={() => subGroupSort = setMapVal(subGroupSort, g1.name, 'umsatz')} class="px-3 py-1 text-[11px] font-medium" style="background: {sg1Sort === 'umsatz' ? 'var(--accent)' : 'white'}; color: {sg1Sort === 'umsatz' ? 'white' : 'var(--warm-500)'};">Umsatz</button>
                        <button onclick={() => subGroupSort = setMapVal(subGroupSort, g1.name, 'anzahl')} class="px-3 py-1 text-[11px] font-medium" style="background: {sg1Sort === 'anzahl' ? 'var(--accent)' : 'white'}; color: {sg1Sort === 'anzahl' ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">Anzahl</button>
                      </div>
                    </div>
                    <div class="space-y-1">
                      {#each sortItems(g1.subGroups || [], sg1Sort) as sg (sg.name)}
                        {@const l2Key = `${g1.name}::${sg.name}`}
                        {@const l2Open = expandedL2.has(l2Key)}
                        {@const sgHasSubGroups = !!sg.subGroups && sg.subGroups.length > 0}
                        <div class="rounded-xl overflow-hidden" style="border: 1px solid var(--warm-200); background: white;">
                          <!-- svelte-ignore a11y_click_events_have_key_events -->
                          <!-- svelte-ignore a11y_no_static_element_interactions -->
                          <div class="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[var(--warm-50)] transition-colors"
                            onclick={() => expandedL2 = toggleSet(expandedL2, l2Key)}>
                            {#if sg.thumbBildId}
                              <img src={imgUrl(sg.thumbBildId, 80)} alt="" class="w-9 h-9 object-cover rounded-lg" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
                            {:else}
                              <div class="w-9 h-9 rounded-lg flex items-center justify-center text-[9px] font-bold" style="background: var(--warm-100); color: var(--warm-400);">{sg.name.slice(0,2)}</div>
                            {/if}
                            <div class="flex-1 min-w-0">
                              <p class="text-xs font-medium truncate" style="color: var(--warm-700);">{sg.name}</p>
                              <p class="text-[9px]" style="color: var(--warm-400);">{sgHasSubGroups ? `${sg.subGroups?.length} Kollektionen · ` : ''}{sg.articles.length} Artikel</p>
                            </div>
                            <p class="text-xs tabular-nums font-medium" style="color: var(--warm-700);">{fmtEUR(sg.umsatz)}</p>
                            <p class="text-[11px] tabular-nums" style="color: var(--warm-500);">{fmtNum(sg.anzahl)} Stk</p>
                            <div class="text-[10px] transition-transform" class:rotate-180={l2Open} style="color: var(--accent);">▾</div>
                          </div>
                          {#if l2Open}
                            {#if sgHasSubGroups}
                              <!-- L3: SubGroups inside SubGroup (Kollektionen inside Form) -->
                              {@const sg2Sort = getMapVal(subGroupSort, l2Key)}
                              <div class="px-4 pb-4 pt-2" style="background: var(--warm-50); border-top: 1px solid var(--warm-100);">
                                <div class="flex items-center gap-3 mb-3">
                                  <p class="text-[9px] font-semibold uppercase tracking-[0.12em]" style="color: var(--warm-400);">Kollektionen — sortiert nach</p>
                                  <div class="flex rounded-md overflow-hidden" style="border: 1px solid var(--warm-200);">
                                    <button onclick={() => subGroupSort = setMapVal(subGroupSort, l2Key, 'umsatz')} class="px-2.5 py-0.5 text-[10px] font-medium" style="background: {sg2Sort === 'umsatz' ? 'var(--accent)' : 'white'}; color: {sg2Sort === 'umsatz' ? 'white' : 'var(--warm-500)'};">Umsatz</button>
                                    <button onclick={() => subGroupSort = setMapVal(subGroupSort, l2Key, 'anzahl')} class="px-2.5 py-0.5 text-[10px] font-medium" style="background: {sg2Sort === 'anzahl' ? 'var(--accent)' : 'white'}; color: {sg2Sort === 'anzahl' ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">Anzahl</button>
                                  </div>
                                </div>
                                <div class="space-y-1">
                                  {#each sortItems(sg.subGroups || [], sg2Sort) as sg3 (sg3.name)}
                                    {@const l3Key = `${l2Key}::${sg3.name}`}
                                    {@const l3Open = expandedL3.has(l3Key)}
                                    <div class="rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200); background: white;">
                                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                                      <div class="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-[var(--warm-50)] transition-colors"
                                        onclick={() => expandedL3 = toggleSet(expandedL3, l3Key)}>
                                        {#if sg3.thumbBildId}
                                          <img src={imgUrl(sg3.thumbBildId, 60)} alt="" class="w-7 h-7 object-cover rounded-md" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
                                        {:else}
                                          <div class="w-7 h-7 rounded-md flex items-center justify-center text-[8px] font-bold" style="background: var(--warm-100); color: var(--warm-400);">{sg3.name.slice(0,2)}</div>
                                        {/if}
                                        <div class="flex-1 min-w-0">
                                          <p class="text-[11px] font-medium truncate" style="color: var(--warm-700);">{sg3.name}</p>
                                          <p class="text-[8px]" style="color: var(--warm-400);">{sg3.articles.length} Artikel</p>
                                        </div>
                                        <p class="text-[11px] tabular-nums font-medium" style="color: var(--warm-700);">{fmtEUR(sg3.umsatz)}</p>
                                        <p class="text-[10px] tabular-nums" style="color: var(--warm-500);">{fmtNum(sg3.anzahl)} Stk</p>
                                        <div class="text-[9px] transition-transform" class:rotate-180={l3Open} style="color: var(--accent);">▾</div>
                                      </div>
                                      {#if l3Open}
                                        <!-- Articles inside L3 -->
                                        {@const artSortKey3 = `${l3Key}::art`}
                                        {@const aSort3 = getMapVal(articleSort, artSortKey3)}
                                        <div class="px-3 pb-3 pt-2" style="background: var(--warm-100); border-top: 1px solid var(--warm-100);">
                                          <div class="flex items-center gap-2 mb-2">
                                            <p class="text-[8px] font-semibold uppercase tracking-[0.12em]" style="color: var(--warm-400);">Artikel —</p>
                                            <div class="flex rounded-md overflow-hidden" style="border: 1px solid var(--warm-200);">
                                              <button onclick={() => articleSort = setMapVal(articleSort, artSortKey3, 'umsatz')} class="px-2 py-0.5 text-[9px] font-medium" style="background: {aSort3 === 'umsatz' ? 'var(--accent)' : 'white'}; color: {aSort3 === 'umsatz' ? 'white' : 'var(--warm-500)'};">Umsatz</button>
                                              <button onclick={() => articleSort = setMapVal(articleSort, artSortKey3, 'anzahl')} class="px-2 py-0.5 text-[9px] font-medium" style="background: {aSort3 === 'anzahl' ? 'var(--accent)' : 'white'}; color: {aSort3 === 'anzahl' ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">Anzahl</button>
                                            </div>
                                          </div>
                                          <div class="flex flex-wrap gap-2">
                                            {#each sortItems(sg3.articles, aSort3) as art}
                                              {@const aKey = `${l3Key}::${art.bildId}`}
                                              {@const aOpen = expandedArticles.has(aKey)}
                                              <div class="flex flex-col">
                                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                                <div class="cursor-pointer" onclick={(e) => { e.stopPropagation(); expandedArticles = toggleSet(expandedArticles, aKey); }}>
                                                  <div class="w-14 h-14 sm:w-18 sm:h-18 rounded-lg overflow-hidden shadow-sm transition-all hover:shadow-md hover:scale-105" style="border: 1.5px solid {aOpen ? 'var(--accent)' : 'var(--warm-200)'};">
                                                    <img src={imgUrl(art.bildId, 140)} alt="" class="w-full h-full object-cover" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).parentElement!.style.display='none'; }} />
                                                  </div>
                                                  <div class="mt-0.5 text-center"><p class="text-[8px] font-medium tabular-nums" style="color: var(--warm-700);">{fmtEUR(art.umsatz)}</p><p class="text-[7px] tabular-nums" style="color: var(--warm-400);">{fmtNum(art.anzahl)} Stk</p></div>
                                                </div>
                                                {#if aOpen}
                                                  <div class="mt-1 w-40 rounded-lg p-2 shadow-md" style="background: white; border: 1px solid var(--warm-200);">
                                                    <p class="text-[8px] font-semibold mb-1" style="color: var(--warm-400);">Verkäufe nach Kasse</p>
                                                    {#each art.kassenStats as ks}
                                                      <div class="flex items-center justify-between py-0.5"><span class="text-[9px] truncate" style="color: var(--warm-600); max-width: 90px;" title={ks.kasse}>{ks.kasse}</span><span class="text-[9px] tabular-nums font-medium" style="color: var(--warm-700);">{fmtNum(ks.anzahl)}</span></div>
                                                    {/each}
                                                  </div>
                                                {/if}
                                              </div>
                                            {/each}
                                          </div>
                                        </div>
                                      {/if}
                                    </div>
                                  {/each}
                                </div>
                              </div>
                            {:else}
                              <!-- Articles directly inside L2 (no further subGroups) -->
                              {@const artSortKey = `${l2Key}::art`}
                              {@const aSort = getMapVal(articleSort, artSortKey)}
                              <div class="px-4 pb-4 pt-2" style="background: var(--warm-50); border-top: 1px solid var(--warm-100);">
                                <div class="flex items-center gap-3 mb-3">
                                  <p class="text-[9px] font-semibold uppercase tracking-[0.12em]" style="color: var(--warm-400);">Artikel — sortiert nach</p>
                                  <div class="flex rounded-md overflow-hidden" style="border: 1px solid var(--warm-200);">
                                    <button onclick={() => articleSort = setMapVal(articleSort, artSortKey, 'umsatz')} class="px-2.5 py-0.5 text-[10px] font-medium" style="background: {aSort === 'umsatz' ? 'var(--accent)' : 'white'}; color: {aSort === 'umsatz' ? 'white' : 'var(--warm-500)'};">Umsatz</button>
                                    <button onclick={() => articleSort = setMapVal(articleSort, artSortKey, 'anzahl')} class="px-2.5 py-0.5 text-[10px] font-medium" style="background: {aSort === 'anzahl' ? 'var(--accent)' : 'white'}; color: {aSort === 'anzahl' ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">Anzahl</button>
                                  </div>
                                </div>
                                <div class="flex flex-wrap gap-2.5">
                                  {#each sortItems(sg.articles, aSort) as art}
                                    {@const aKey = `${l2Key}::${art.bildId}`}
                                    {@const aOpen = expandedArticles.has(aKey)}
                                    <div class="flex flex-col">
                                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                                      <div class="cursor-pointer" onclick={(e) => { e.stopPropagation(); expandedArticles = toggleSet(expandedArticles, aKey); }}>
                                        <div class="w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden shadow-sm transition-all hover:shadow-md hover:scale-105" style="border: 1.5px solid {aOpen ? 'var(--accent)' : 'var(--warm-200)'};">
                                          <img src={imgUrl(art.bildId, 160)} alt="" class="w-full h-full object-cover" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).parentElement!.style.display='none'; }} />
                                        </div>
                                        <div class="mt-1 text-center"><p class="text-[9px] font-medium tabular-nums" style="color: var(--warm-700);">{fmtEUR(art.umsatz)}</p><p class="text-[8px] tabular-nums" style="color: var(--warm-400);">{fmtNum(art.anzahl)} Stk</p></div>
                                      </div>
                                      {#if aOpen}
                                        <div class="mt-1.5 w-44 rounded-lg p-2.5 shadow-md" style="background: white; border: 1px solid var(--warm-200);">
                                          <p class="text-[9px] font-semibold mb-1.5" style="color: var(--warm-400);">Verkäufe nach Kasse</p>
                                          {#each art.kassenStats as ks}
                                            <div class="flex items-center justify-between py-0.5"><span class="text-[10px] truncate" style="color: var(--warm-600); max-width: 100px;" title={ks.kasse}>{ks.kasse}</span><span class="text-[10px] tabular-nums font-medium" style="color: var(--warm-700);">{fmtNum(ks.anzahl)} Stk</span></div>
                                          {/each}
                                        </div>
                                      {/if}
                                    </div>
                                  {/each}
                                </div>
                              </div>
                            {/if}
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <!-- Direct Articles (Tab 1: Kollektion — no subgroups) -->
                    {@const artSortKey = `${g1.name}::art`}
                    {@const aSort = getMapVal(articleSort, artSortKey)}
                    <div class="flex items-center gap-3 mb-4">
                      <p class="text-[10px] font-semibold uppercase tracking-[0.12em]" style="color: var(--warm-400);">Verkaufte Artikel — sortiert nach</p>
                      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
                        <button onclick={() => articleSort = setMapVal(articleSort, artSortKey, 'umsatz')} class="px-3 py-1 text-[11px] font-medium" style="background: {aSort === 'umsatz' ? 'var(--accent)' : 'white'}; color: {aSort === 'umsatz' ? 'white' : 'var(--warm-500)'};">Umsatz</button>
                        <button onclick={() => articleSort = setMapVal(articleSort, artSortKey, 'anzahl')} class="px-3 py-1 text-[11px] font-medium" style="background: {aSort === 'anzahl' ? 'var(--accent)' : 'white'}; color: {aSort === 'anzahl' ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">Anzahl</button>
                      </div>
                    </div>
                    <div class="flex flex-wrap gap-3">
                      {#each sortItems(g1.articles, aSort) as art}
                        {@const aKey = `${g1.name}::${art.bildId}`}
                        {@const aOpen = expandedArticles.has(aKey)}
                        <div class="flex flex-col">
                          <!-- svelte-ignore a11y_click_events_have_key_events -->
                          <!-- svelte-ignore a11y_no_static_element_interactions -->
                          <div class="cursor-pointer" onclick={(e) => { e.stopPropagation(); expandedArticles = toggleSet(expandedArticles, aKey); }}>
                            <div class="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden shadow-sm transition-all hover:shadow-lg hover:scale-105" style="border: 1.5px solid {aOpen ? 'var(--accent)' : 'var(--warm-200)'};">
                              <img src={imgUrl(art.bildId, 200)} alt="" class="w-full h-full object-cover" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).parentElement!.style.display='none'; }} />
                            </div>
                            <div class="mt-1.5 text-center"><p class="text-[10px] font-medium tabular-nums" style="color: var(--warm-700);">{fmtEUR(art.umsatz)}</p><p class="text-[9px] tabular-nums" style="color: var(--warm-400);">{fmtNum(art.anzahl)} Stk</p></div>
                          </div>
                          {#if aOpen}
                            <div class="mt-2 w-52 sm:w-60 rounded-xl p-3 shadow-md" style="background: white; border: 1px solid var(--warm-200);">
                              <div class="flex items-center gap-2 mb-2">
                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                                <img src={imgUrl(art.bildId, 60)} alt="" class="w-7 h-7 rounded object-cover cursor-pointer" onclick={(e) => { e.stopPropagation(); lightboxUrl = imgUrl(art.bildId, 1000); }} />
                                <div><p class="text-[10px] font-semibold" style="color: var(--warm-700);">{fmtEUR(art.umsatz)} · {fmtNum(art.anzahl)} Stk</p></div>
                              </div>
                              <p class="text-[9px] font-semibold mb-1.5" style="color: var(--warm-400);">Verkäufe nach Kasse</p>
                              {#each art.kassenStats as ks}
                                <div class="flex items-center justify-between py-0.5"><span class="text-[10px] truncate" style="color: var(--warm-600); max-width: 120px;" title={ks.kasse}>{ks.kasse}</span><span class="text-[10px] tabular-nums font-medium" style="color: var(--warm-700);">{fmtNum(ks.anzahl)} Stk</span></div>
                              {/each}
                            </div>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>
    {/if}
  {/if}
</div>

<!-- Lightbox -->
{#if lightboxUrl}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md" style="background: rgba(31,26,18,0.7);" onclick={() => lightboxUrl = ''}>
    <img src={lightboxUrl} alt="Produkt" class="max-w-[90vw] max-h-[90vh] rounded-2xl shadow-2xl" />
    <button class="absolute top-6 right-6 w-10 h-10 rounded-full flex items-center justify-center text-white text-xl" style="background: rgba(0,0,0,0.4);" onclick={() => lightboxUrl = ''}>✕</button>
  </div>
{/if}
