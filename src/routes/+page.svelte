<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import BubbleChart from '$lib/BubbleChart.svelte';
  import BarChart from '$lib/BarChart.svelte';
  import PieChart from '$lib/PieChart.svelte';
  import AreaChart from '$lib/AreaChart.svelte';
  import Dashboard from '$lib/Dashboard.svelte';
  import XTable from '$lib/XTable.svelte';

  // ─── Types ───
  interface RawRow {
    Kollektion: string; BildId: string; Anzahl: number; EinzelPreis: number;
    Art: string; Form: string; FormPfad: string; Nr: string; SubKollektion: string;
    Kasse: string; Monat: string; KW: string; Datum: string;
    Quelle: string;
  }

  interface KasseStat { kasse: string; anzahl: number; }

  interface ArticleNode {
    bildId: string; umsatz: number; anzahl: number;
    nr?: string; kollektion?: string; einzelPreis?: number;
    kassenStats: KasseStat[];
  }

  interface GroupNode {
    name: string; thumbBildId: string; umsatz: number; anzahl: number;
    avgPreis: number; anteil: number;
    articles: ArticleNode[];           // leaf articles
    subGroups?: GroupNode[];           // optional mid-level (Kollektionen inside Form/Art)
  }

  type TabId = 'dashboard' | 'kollektion' | 'artikel' | 'form' | 'art' | 'formpfad' | 'preis' | 'kasse' | 'custom' | 'xtable' | 'bubble' | 'bar' | 'pie' | 'area';

  // ─── Role-based Kasse filter ───
  const ROLE_KASSEN: Record<string, string[] | null> = {
    'all': null,           // null = show all
    'koblenz': ['Koblenz', 'Köln Weiden'],
    'nrw': ['Düsseldorf', 'Essen', 'Bochum'],
    'frankfurt': ['Frankfurt'],
  };
  let userRole = $state('all');
  let allowedKassen = $derived(ROLE_KASSEN[userRole] || null);
  let roleLabel = $derived(allowedKassen ? allowedKassen.join(' + ') : '');

  // ─── State ───
  let allDecodedData: RawRow[] = $state([]);
  let allData: RawRow[] = $state([]);
  let allArtValues: string[] = $state([])
  let allKollValues: string[] = $state([])
  let selectedArt = $state<string[]>([])
  let selectedKollektion = $state<string[]>([])
  let kollDropdownOpen = $state(false)
  let kollSearchTerm = $state('')
  let filterOpen = $state(false)
  let zeitraumOpen = $state(false)
  let loading = $state(true);
  let activeTab = $state<TabId>('dashboard');

  // ─── Auswertungspakete (analysis packages) ───
  interface PackageInfo { id: string; name: string; source: string; file: string; rows: number; from: string; to: string }
  let packages = $state<PackageInfo[]>([]);
  let activePackage = $state<PackageInfo | null>(null);
  let packageLoading = $state(false);

  const ROLE_PACKAGES: Record<string, string[]> = {
    'all': ['*'],
    'nrw': ['eh-2025-2026'],
    'koblenz': ['eh-2025-2026'],
    'frankfurt': ['eh-2025-2026'],
  };
  let allowedPackages = $derived(
    ROLE_PACKAGES[userRole]?.[0] === '*'
      ? packages
      : packages.filter(p => (ROLE_PACKAGES[userRole] || []).includes(p.id))
  );

  // Pre-aggregated data — all derived, no $effect needed
  let preisSubTab = $state<'formpfad' | 'kollektion'>('formpfad');
  let kollSubMode = $state<'artikel' | 'subkollektion'>('artikel');
  // For Custom tab: 4 selectable levels
  type DimOption = 'Kollektion' | 'FormPfad' | 'Channel' | 'SubKollektion' | 'Form' | 'Preisgruppe' | 'Art' | '';
  const DIM_OPTIONS: { value: DimOption; label: string }[] = [
    { value: '', label: '— keine —' },
    { value: 'Kollektion', label: 'Kollektion' },
    { value: 'FormPfad', label: 'FormPfad' },
    { value: 'Art', label: 'Art' },
    { value: 'Channel', label: 'Channel' },
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
  type TimeUnit = 'tag' | 'woche' | 'monat' | 'jahr' | 'alles';
  type CompareType = 'vorperiode' | 'vorjahr';
  let timeUnit = $state<TimeUnit>('monat');
  let timeIdx = $state(0); // 0 = latest period
  let compareType = $state<CompareType>('vorperiode');

  // Today's info label
  const _now = new Date();
  const _oneJan = new Date(_now.getFullYear(), 0, 1);
  const _kw = String(Math.ceil(((_now.getTime() - _oneJan.getTime()) / 86400000 + _oneJan.getDay() + 1) / 7)).padStart(2, '0');
  const todayLabel = `${_now.getDate().toString().padStart(2,'0')}.${(_now.getMonth()+1).toString().padStart(2,'0')}.${_now.getFullYear()} · ${MONAT_ORDER[_now.getMonth()]} · KW ${_kw}`;

  let periods = $derived.by((): string[] => {
    if (timeUnit === 'alles') return ['alles'];
    if (timeUnit === 'tag') return availableDates;
    if (timeUnit === 'woche') return availableKWs;
    if (timeUnit === 'monat') return availableMonths;
    return availableYears;
  });
  let periodIndexMap = $derived(new Map(periods.map((p, i) => [p, i])))
  let currentPeriod = $derived(periods.length > 0 ? periods[periods.length - 1 - timeIdx] : '');
  let comparePeriod = $derived.by((): string => {
    if (!currentPeriod || periods.length < 2 || timeUnit === 'alles') return '';
    const ci = periodIndexMap.get(currentPeriod) ?? -1;
    if (ci < 0) return '';
    if (compareType === 'vorperiode') return ci > 0 ? periods[ci - 1] : '';
    // vorjahr: same period key but previous year
    if (compareType === 'vorjahr') {
      if (timeUnit === 'jahr') {
        const prevY = String(Number(currentPeriod) - 1);
        return periodIndexMap.has(prevY) ? prevY : '';
      }
      const [y, rest] = currentPeriod.split('-');
      const prevYearKey = `${Number(y) - 1}-${rest}`;
      return periodIndexMap.has(prevYearKey) ? prevYearKey : '';
    }
    return '';
  });
  let currentPeriodLabel = $derived.by((): string => {
    if (!currentPeriod) return '';
    if (timeUnit === 'alles') return 'Alle Daten';
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
  function fmtDate2(iso: string): string {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y.slice(2)}`;
  }
  let currentDateRange = $derived.by((): string => {
    if (!currentPeriod || timeUnit === 'tag' || timeUnit === 'alles') return '';
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
  let hideEuro = $state(false);
  // Artikel tab state
  let artikelSortMode = $state<'umsatz' | 'anzahl'>('umsatz');
  let artikelHideLow = $state(false);
  let artikelMinCount = 5;
  let artikelVariantenMode = $state(false);
  let expandedVariants = $state<Set<string>>(new Set());
  function toggleVariant(key: string) {
    const s = new Set(expandedVariants);
    if (s.has(key)) s.delete(key); else s.add(key);
    expandedVariants = s;
  }

  // ─── Pick & Share (named article lists) ───
  interface PickItem { nr: string; bildId: string; kollektion: string; einzelPreis: number; }
  interface PickList { name: string; items: PickItem[]; }
  let savedLists: PickList[] = $state([]);
  let activeListName = $state('');
  let activeItems: Map<string, PickItem> = $state(new Map());
  let pickPanelOpen = $state(false);
  let pickMenuOpen = $state(false);
  let saveAsMode = $state(false);
  let saveAsName = $state('');

  function persistLists() { localStorage.setItem('miranda-picks', JSON.stringify(savedLists)); }
  function togglePick(art: ArticleNode) {
    if (!art.nr) return;
    const m = new Map(activeItems);
    if (m.has(art.nr)) { m.delete(art.nr); }
    else { m.set(art.nr, { nr: art.nr, bildId: art.bildId, kollektion: art.kollektion || '', einzelPreis: art.einzelPreis || 0 }); }
    activeItems = m;
  }
  function removeFromPick(nr: string) { const m = new Map(activeItems); m.delete(nr); activeItems = m; }
  function clearPick() { activeItems = new Map(); activeListName = ''; }
  function savePick() {
    if (!activeListName) { saveAsMode = true; return; }
    const items = Array.from(activeItems.values());
    const idx = savedLists.findIndex(l => l.name === activeListName);
    if (idx >= 0) { savedLists[idx] = { name: activeListName, items }; } else { savedLists = [...savedLists, { name: activeListName, items }]; }
    persistLists();
  }
  function savePickAs(name: string) {
    if (!name.trim()) return;
    activeListName = name.trim();
    const items = Array.from(activeItems.values());
    const existing = savedLists.findIndex(l => l.name === activeListName);
    if (existing >= 0) { savedLists[existing] = { name: activeListName, items }; } else { savedLists = [...savedLists, { name: activeListName, items }]; }
    persistLists(); saveAsMode = false; saveAsName = '';
  }
  function openList(list: PickList) {
    activeListName = list.name;
    const m = new Map<string, PickItem>();
    for (const it of list.items) m.set(it.nr, it);
    activeItems = m;
    pickPanelOpen = true; pickMenuOpen = false;
  }
  function deleteList(name: string) {
    savedLists = savedLists.filter(l => l.name !== name);
    persistLists();
    if (activeListName === name) { activeListName = ''; activeItems = new Map(); }
  }
  function buildPickText(): string {
    return Array.from(activeItems.values()).map(it => it.nr).join('\n');
  }
  function buildKatalogUrl(arr: PickItem[], name: string): string {
    const nrs = arr.map(it => it.nr).join(',');
    const bids = arr.map(it => it.bildId).join(',');
    const kolls = arr.map(it => encodeURIComponent(it.kollektion)).join(',');
    const prices = arr.map(it => it.einzelPreis).join(',');
    const date = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${location.origin}/katalog#name=${encodeURIComponent(name)}&nrs=${nrs}&bids=${bids}&kolls=${kolls}&prices=${prices}&date=${encodeURIComponent(date)}`;
  }
  function copyArticleNumbers() { navigator.clipboard.writeText(buildPickText()); copyFeedback = 'nrs'; setTimeout(() => copyFeedback = '', 1500); }
  function copyKatalogLink() {
    const url = buildKatalogUrl(Array.from(activeItems.values()), activeListName || 'Katalog');
    navigator.clipboard.writeText(url);
    copyFeedback = 'link'; setTimeout(() => copyFeedback = '', 1500);
  }
  function shareArticleNumbers() {
    const text = buildPickText();
    if (navigator.share) { navigator.share({ title: `${activeListName || 'Liste'} — Artikelnummern`, text }); }
    else { navigator.clipboard.writeText(text); copyFeedback = 'nrs'; setTimeout(() => copyFeedback = '', 1500); }
  }
  function shareKatalogLink() {
    const url = buildKatalogUrl(Array.from(activeItems.values()), activeListName || 'Katalog');
    if (navigator.share) { navigator.share({ title: `Konplott — ${activeListName || 'Katalog'}`, url }); }
    else { navigator.clipboard.writeText(url); copyFeedback = 'link'; setTimeout(() => copyFeedback = '', 1500); }
  }
  let copyFeedback = $state<'' | 'nrs' | 'link'>('');
  let shareMenuOpen = $state(false);
  function openKatalogForList(list: PickList) {
    window.open(buildKatalogUrl(list.items, list.name), '_blank');
  }
  function openKatalog() {
    window.open(buildKatalogUrl(Array.from(activeItems.values()), activeListName || 'Katalog'), '_blank');
  }

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
  let totalUmsatz = $derived(filteredData.reduce((s, r) => s + ((r as any).Umsatz || 0), 0));
  let totalAnzahl = $derived(filteredData.reduce((s, r) => s + (r.Anzahl || 0), 0));
  let filteredDateRange = $derived.by(() => {
    if (!filteredData.length) return { min: '', max: '' }
    let min = filteredData[0].Datum, max = min
    for (const r of filteredData) {
      if (r.Datum < min) min = r.Datum
      if (r.Datum > max) max = r.Datum
    }
    return { min, max }
  });

  // Cache: multi-key, only recompute when period changes
  let _groupCache = new Map<string, GroupNode[]>()
  let _groupCachePeriod = ''
  function cachedGroupBy(field: string, subFields?: string[]): GroupNode[] {
    if (_groupCachePeriod !== currentPeriod) {
      _groupCache.clear()
      _groupCachePeriod = currentPeriod
    }
    const key = field + '|' + (subFields?.join(',') || '')
    const cached = _groupCache.get(key)
    if (cached) return cached
    const result = groupByField(filteredData, field, totalUmsatz, subFields)
    _groupCache.set(key, result)
    return result
  }

  // Legacy compat: agg object for Dashboard & other uses
  let agg = $derived.by(() => {
    if (!filteredData.length) return null;
    return { total: totalUmsatz, totalAnzahl };
  });

  let compTotalUmsatz = $derived(compareData.reduce((s, r) => s + ((r as any).Umsatz || 0), 0));
  let compTotalAnzahl = $derived(compareData.reduce((s, r) => s + (r.Anzahl || 0), 0));

  // Pre-filtered data for AreaChart (only last 10 visible periods instead of all 167k)
  let areaChartData = $derived.by(() => {
    if (!allData.length || !currentPeriod || !periods.length) return [];
    const ci = periodIndexMap.get(currentPeriod) ?? -1;
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

  // All articles for Artikel tab (only computed when tab is active)
  let allArticles = $derived.by(() => {
    if (activeTab !== 'artikel' || !filteredData.length) return { items: [] as ArticleNode[], sonstige: null as ArticleNode | null };
    const artMap = new Map<string, { nr: string; kollektion: string; umsatz: number; anzahl: number; kassen: Map<string, number> }>();
    for (const r of filteredData) {
      const bid = String(r.BildId);
      if (!bid || bid === '0') continue;
      if (!artMap.has(bid)) artMap.set(bid, { nr: String(r.Nr || ''), kollektion: r.Kollektion || '', umsatz: 0, anzahl: 0, kassen: new Map() });
      const a = artMap.get(bid)!;
      if (!a.nr && r.Nr) a.nr = String(r.Nr);
      if (!a.kollektion && r.Kollektion) a.kollektion = r.Kollektion;
      const an = r.Anzahl || 0;
      a.umsatz += (r as any).Umsatz || 0;
      a.anzahl += an;
      const ch = (r as any).Channel || r.Kasse;
      a.kassen.set(ch, (a.kassen.get(ch) || 0) + an);
    }
    let items: ArticleNode[] = Array.from(artMap.entries()).map(([bildId, a]) => ({
      bildId, nr: a.nr, kollektion: a.kollektion, einzelPreis: a.anzahl > 0 ? a.umsatz / a.anzahl : undefined,
      umsatz: a.umsatz, anzahl: a.anzahl,
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
    const sonstige: ArticleNode | null = sA > 0 ? { bildId: '', nr: '', kollektion: '', umsatz: sU, anzahl: sA,
      kassenStats: Array.from(sK.entries()).map(([kasse, anzahl]) => ({ kasse, anzahl })).sort((x, y) => y.anzahl - x.anzahl),
    } : null;
    return { items: shown, sonstige };
  });

  // ─── Varianten-Gruppierung für Artikel-Tab ───
  interface VariantGroup {
    key: string; umsatz: number; anzahl: number; count: number;
    thumbBildId: string; thumbNr: string;
    articles: ArticleNode[];
  }

  let artikelVarianten = $derived.by((): VariantGroup[] => {
    if (!artikelVariantenMode) return [];
    if (!filteredData.length) return [];
    // Step 1: build BildId → variantKey mapping from RawRows
    const bildToVariant = new Map<string, string>();
    for (const r of filteredData) {
      const bid = String(r.BildId);
      if (!bid || bid === '0') continue;
      if (!bildToVariant.has(bid)) {
        bildToVariant.set(bid, `${r.Kollektion}|${r.Form}|${(r as any).Preisgruppe}`);
      }
    }
    // Step 2: group allArticles.items by variantKey
    const groups = new Map<string, ArticleNode[]>();
    for (const art of allArticles.items) {
      const vk = bildToVariant.get(art.bildId) || art.bildId;
      if (!groups.has(vk)) groups.set(vk, []);
      groups.get(vk)!.push(art);
    }
    // Step 3: build VariantGroup[]
    return Array.from(groups.entries()).map(([key, arts]) => {
      const top = arts[0];
      return {
        key, thumbBildId: top.bildId, thumbNr: top.nr || '',
        umsatz: arts.reduce((s, a) => s + a.umsatz, 0),
        anzahl: arts.reduce((s, a) => s + a.anzahl, 0),
        count: arts.length, articles: arts,
      };
    }).sort((a, b) => artikelSortMode === 'umsatz' ? b.umsatz - a.umsatz : b.anzahl - a.anzahl);
  });

  // Compare L1 lookup — lazy per-field (only aggregates what's needed for active tab)
  let _compFieldCache = new Map<string, Map<string, { umsatz: number; anzahl: number }>>()
  let _compCacheDataRef: RawRow[] = []

  function getCompLookup(field: string): Map<string, { umsatz: number; anzahl: number }> {
    if (_compCacheDataRef !== compareData) {
      _compFieldCache.clear()
      _compCacheDataRef = compareData
    }
    const cached = _compFieldCache.get(field)
    if (cached) return cached
    const fmap = new Map<string, { umsatz: number; anzahl: number }>()
    for (const r of compareData) {
      const k = (r as any)[field] || '(leer)'
      let g = fmap.get(k)
      if (!g) { g = { umsatz: 0, anzahl: 0 }; fmap.set(k, g) }
      g.umsatz += (r as any).Umsatz || 0
      g.anzahl += r.Anzahl || 0
    }
    _compFieldCache.set(field, fmap)
    return fmap
  }

  // Helper: get L1 compare field for current tab
  function getCompField(): string {
    if (activeTab === 'kollektion') return 'Kollektion'
    if (activeTab === 'form') return 'Form'
    if (activeTab === 'art') return 'Art'
    if (activeTab === 'formpfad') return 'FormPfad'
    if (activeTab === 'preis') return 'Preisgruppe'
    if (activeTab === 'kasse') return 'Channel'
    if (activeTab === 'custom') return customDim1 || 'Kollektion'
    return ''
  }

  function getComp(name: string): { umsatz: number; anzahl: number } | null {
    if (!compareData.length) return null
    const field = getCompField()
    return getCompLookup(field).get(name) || null
  }

  let fmtDelta = $derived.by(() => hideEuro
    ? (_a: number, _b: number) => ''
    : (cur: number, prev: number) => {
        if (!prev || prev === 0) return '';
        const pct = ((cur / prev) - 1) * 100;
        if (pct > 0) return `(+${pct.toFixed(0)}%)`;
        if (pct < 0) return `(${pct.toFixed(0)}%)`;
        return '(\u00b10%)';
      });

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
        ? cachedGroupBy('Kollektion', ['SubKollektion'])
        : cachedGroupBy('Kollektion');
      case 'form': return cachedGroupBy('Form', ['Kollektion']);
      case 'art': return cachedGroupBy('Art', ['Kollektion']);
      case 'formpfad': return cachedGroupBy('FormPfad', ['Form', 'Kollektion']);
      case 'kasse': return cachedGroupBy('Channel', ['Kollektion']);
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
      list = list.filter(c =>
        c.name.toLowerCase().includes(t) ||
        c.subGroups?.some(sg => sg.name.toLowerCase().includes(t))
      );
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
  let fmtEUR = $derived.by(() => hideEuro
    ? (_: number) => '\u2022\u2022\u2022'
    : (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));
  let fmtNum = $derived.by(() => hideEuro
    ? (_: number) => '\u2022\u2022\u2022'
    : (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 0 }));
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
      const an = r.Anzahl || 0;
      a.umsatz += (r as any).Umsatz || 0;
      a.anzahl += an;
      const ch = (r as any).Channel || r.Kasse;
      a.kassen.set(ch, (a.kassen.get(ch) || 0) + an);
    }
    return Array.from(artMap.entries()).map(([bildId, a]) => ({
      bildId, umsatz: a.umsatz, anzahl: a.anzahl,
      kassenStats: Array.from(a.kassen.entries()).map(([kasse, anzahl]) => ({ kasse, anzahl })).sort((x, y) => y.anzahl - x.anzahl),
    })).sort((a, b) => b.umsatz - a.umsatz);
  }

  function buildGroup(name: string, rows: RawRow[], total: number, subGroupFields?: string[]): GroupNode {
    let umsatz = 0, anzahl = 0;
    for (const r of rows) { umsatz += (r as any).Umsatz || 0; anzahl += r.Anzahl || 0; }
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

  function getPreisObergruppe(ep: number): string {
    if (ep < 50) return 'Niedrig (0–50 €)';
    if (ep < 250) return 'Mittel (50–250 €)';
    return 'Premium (über 250 €)';
  }

  // ─── Apply role filter + global Art/Kollektion filter + Channel ───
  function applyFilters(decoded: RawRow[]): RawRow[] {
    let filtered = decoded
    if (allowedKassen) {
      filtered = filtered.filter(r =>
        r.Quelle !== 'Einzelhandel' || allowedKassen!.includes(r.Kasse)
      )
    }
    if (selectedArt.length > 0) {
      const artSet = new Set(selectedArt)
      filtered = filtered.filter(r => artSet.has(r.Art))
    }
    if (selectedKollektion.length > 0) {
      const kollSet = new Set(selectedKollektion)
      filtered = filtered.filter(r => kollSet.has(r.Kollektion))
    }
    for (const r of filtered) {
      ;(r as any).Channel = r.Kasse
    }
    return filtered
  }

  // Re-apply filters when role or global selections change
  $effect(() => {
    const _ = allowedKassen
    const _a = selectedArt.length
    const _k = selectedKollektion.length
    const decoded = untrack(() => allDecodedData)
    if (decoded.length) {
      allData = applyFilters(decoded)
    }
  })

  // ─── Period indices (ALL built in a single pass over allData) ───
  let allIndices = $derived.by(() => {
    const week = new Map<string, number[]>()
    const month = new Map<string, number[]>()
    const day = new Map<string, number[]>()
    const year = new Map<string, number[]>()
    const ranges = new Map<string, { min: string; max: string }>()

    for (let i = 0; i < allData.length; i++) {
      const r = allData[i]
      const y = (r as any).Jahr as string
      const d = r.Datum
      const wk = `${y}-${r.KW}`
      const mk = `${y}-${r.Monat}`

      let arr = week.get(wk)
      if (!arr) { arr = []; week.set(wk, arr) }
      arr.push(i)

      arr = month.get(mk)
      if (!arr) { arr = []; month.set(mk, arr) }
      arr.push(i)

      arr = day.get(d)
      if (!arr) { arr = []; day.set(d, arr) }
      arr.push(i)

      arr = year.get(y)
      if (!arr) { arr = []; year.set(y, arr) }
      arr.push(i)

      for (const key of [wk, mk, d, y]) {
        const rng = ranges.get(key)
        if (!rng) { ranges.set(key, { min: d, max: d }) }
        else { if (d < rng.min) rng.min = d; if (d > rng.max) rng.max = d }
      }
    }
    return { week, month, day, year, ranges }
  })
  let weekIdx = $derived(allIndices.week)
  let monthIdx = $derived(allIndices.month)
  let dayIdx = $derived(allIndices.day)
  let yearIdx = $derived(allIndices.year)
  let periodDateRange = $derived(allIndices.ranges)

  let availableDates = $derived([...dayIdx.keys()].sort())
  let availableKWs = $derived.by(() => [...weekIdx.keys()].sort((a, b) => {
    const [ya, ka] = a.split('-'), [yb, kb] = b.split('-')
    return ya !== yb ? ya.localeCompare(yb) : Number(ka) - Number(kb)
  }))
  let availableMonths = $derived.by(() => [...monthIdx.keys()].sort((a, b) => {
    const [ya, ma] = a.split('-'), [yb, mb] = b.split('-')
    return ya !== yb ? ya.localeCompare(yb) : MONAT_ORDER.indexOf(ma) - MONAT_ORDER.indexOf(mb)
  }))
  let availableYears = $derived([...yearIdx.keys()].sort())

  // ─── Period row cache (avoids creating new arrays on every call) ───
  let _periodCache = new Map<string, { dataRef: RawRow[]; tuRef: TimeUnit; result: RawRow[] }>()

  function getRowsForPeriod(period: string): RawRow[] {
    if (timeUnit === 'alles') return allData
    const cached = _periodCache.get(period)
    if (cached && cached.dataRef === allData && cached.tuRef === timeUnit) return cached.result
    const idx = timeUnit === 'woche' ? weekIdx : timeUnit === 'monat' ? monthIdx : timeUnit === 'tag' ? dayIdx : yearIdx
    const result = (idx.get(period) || []).map(i => allData[i])
    _periodCache.set(period, { dataRef: allData, tuRef: timeUnit, result })
    return result
  }

  function getRowsForPeriods(periodList: string[]): RawRow[] {
    if (timeUnit === 'alles') return allData
    const idx = timeUnit === 'woche' ? weekIdx : timeUnit === 'monat' ? monthIdx : timeUnit === 'tag' ? dayIdx : yearIdx
    const result: RawRow[] = []
    for (const p of periodList) {
      const indices = idx.get(p)
      if (indices) for (const i of indices) result.push(allData[i])
    }
    return result
  }

  // ─── Decode helper (shared by initial load + background year loads) ───
  function decodeRows(d: any, rows: any[][]): RawRow[] {
    const decoded: RawRow[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const ep = row[9], an = row[8], datum = row[12], monat = row[10];
      const jahr = datum ? datum.slice(0, 4) : '2025';
      decoded[i] = {
        Kasse: d.K[row[0]],
        Kollektion: d.L[row[1]],
        SubKollektion: d.S[row[2]],
        Art: d.A[row[3]],
        Nr: d.N[row[4]],
        Form: d.F[row[5]],
        FormPfad: d.P[row[6]],
        BildId: row[7],
        Anzahl: an,
        EinzelPreis: ep,
        Monat: monat,
        KW: row[11],
        Datum: datum,
        Quelle: d.Q ? d.Q[row[13]] : 'Einzelhandel',
      } as RawRow;
      const r = decoded[i] as any;
      r.Preisgruppe = getPreisgruppe(ep);
      r.Jahr = jahr;
      r.JahrMonat = jahr + '-' + monat;
      r.PreisObergruppe = getPreisObergruppe(ep);
      r.Umsatz = ep * an;
    }
    return decoded;
  }

  // ─── Load a package ───
  async function loadPackage(pkg: PackageInfo) {
    packageLoading = true
    activePackage = pkg
    try {
      const res = await fetch(`/${pkg.file}`)
      const { d, r: rows } = await res.json()
      allArtValues = (d.A || []).filter(Boolean).sort()
      allKollValues = (d.L || []).filter(Boolean).sort()
      selectedArt = []
      selectedKollektion = []
      allDecodedData = decodeRows(d, rows)
      allData = applyFilters(allDecodedData)
      // Init time navigation to current month (≈ last 30 days)
      const now = new Date()
      const currentYear = String(now.getFullYear())
      const currentMon = MONAT_ORDER[now.getMonth()]
      const currentYearMon = `${currentYear}-${currentMon}`
      timeUnit = 'monat'
      const monI = availableMonths.indexOf(currentYearMon)
      if (monI >= 0) {
        timeIdx = availableMonths.length - 1 - monI
      } else {
        timeIdx = 0
      }
    } finally {
      packageLoading = false
    }
  }

  // ─── Switch back to package selection ───
  function switchPackage() {
    activePackage = null
    allDecodedData = []
    allData = []
    activeTab = 'dashboard'
  }

  onMount(async () => {
    // Read role from sessionStorage
    const role = sessionStorage.getItem('miranda-role') || 'all'
    userRole = role

    // Load manifest
    try {
      const mRes = await fetch('/data-manifest.json')
      if (!mRes.ok) throw new Error('no manifest')
      const manifest = await mRes.json()

      if (manifest.version >= 3 && manifest.packages) {
        packages = manifest.packages
      } else {
        // Fallback for older manifests: load full data.json
        const res = await fetch('/data.json')
        const raw = await res.json()
        allArtValues = (raw.d.A || []).filter(Boolean).sort()
        allKollValues = (raw.d.L || []).filter(Boolean).sort()
        allDecodedData = decodeRows(raw.d, raw.r)
        allData = applyFilters(allDecodedData)
        // Fake a single package so UI works
        activePackage = { id: 'legacy', name: 'Alle Daten', source: '', file: 'data.json', rows: allDecodedData.length, from: '', to: '' }
      }
    } catch {
      // No manifest at all: load full data.json
      const res = await fetch('/data.json')
      const raw = await res.json()
      allArtValues = (raw.d.A || []).filter(Boolean).sort()
      allKollValues = (raw.d.L || []).filter(Boolean).sort()
      allDecodedData = decodeRows(raw.d, raw.r)
      allData = applyFilters(allDecodedData)
      activePackage = { id: 'legacy', name: 'Alle Daten', source: '', file: 'data.json', rows: allDecodedData.length, from: '', to: '' }
    }

    // If only one allowed package, auto-load it
    if (!activePackage && allowedPackages.length === 1) {
      await loadPackage(allowedPackages[0])
    }

    // Default time unit
    if (activePackage) {
      const now = new Date()
      const currentYear = String(now.getFullYear())
      const oneJan = new Date(now.getFullYear(), 0, 1)
      const currentKW = String(Math.ceil(((now.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7)).padStart(2, '0')
      const currentYearKW = `${currentYear}-${currentKW}`
      timeUnit = 'woche'
      const kwI = availableKWs.indexOf(currentYearKW)
      if (kwI >= 0) {
        timeIdx = availableKWs.length - 1 - kwI
      } else {
        timeIdx = 0
      }
    }

    // ─── Pick & Share: restore from localStorage + hash ───
    try { const stored = localStorage.getItem('miranda-picks'); if (stored) savedLists = JSON.parse(stored); } catch {}
    if (location.hash.includes('pick=') && allData.length) {
      const params = new URLSearchParams(location.hash.slice(1))
      const hashName = decodeURIComponent(params.get('pick') || 'Liste')
      const hashNrs = (params.get('nrs') || '').split(',').filter(Boolean)
      if (hashNrs.length) {
        const nrLookup = new Map<string, { bildId: string; kollektion: string; einzelPreis: number }>()
        for (const r of allData) {
          const nr = String(r.Nr)
          if (nr && !nrLookup.has(nr)) nrLookup.set(nr, { bildId: String(r.BildId), kollektion: r.Kollektion || '', einzelPreis: Number(r.EinzelPreis) || 0 })
        }
        const m = new Map<string, PickItem>()
        for (const nr of hashNrs) {
          const info = nrLookup.get(nr)
          if (info) m.set(nr, { nr, bildId: info.bildId, kollektion: info.kollektion, einzelPreis: info.einzelPreis })
          else m.set(nr, { nr, bildId: '', kollektion: '', einzelPreis: 0 })
        }
        activeItems = m
        activeListName = hashName
        pickPanelOpen = true
        history.replaceState(null, '', location.pathname)
      }
    }

    loading = false
  });

  const HOME_TAB: { id: TabId; label: string } = { id: 'dashboard', label: 'Dashboard' };
  const DRILL_TABS: { id: TabId; label: string }[] = [
    { id: 'kollektion', label: 'Kollektionen' },
    { id: 'artikel', label: 'Artikel' },
    { id: 'form', label: 'Form' },
    { id: 'art', label: 'Art' },
    { id: 'formpfad', label: 'FormPfad' },
    { id: 'preis', label: 'Preisgruppe' },
    { id: 'kasse', label: 'Channel' },
    { id: 'custom', label: 'Individuell' },
    { id: 'xtable', label: 'X-Tabelle' },
  ];
  const CHART_TABS: { id: TabId; label: string }[] = [
    { id: 'bar', label: 'Säulen' },
    { id: 'bubble', label: 'Bubble' },
    { id: 'pie', label: 'Donuts' },
    { id: 'area', label: 'Flächen' },
  ];
</script>

{#if !activePackage && !loading && packages.length > 0}
  <!-- Package Selection Page -->
  <div class="min-h-screen flex items-center justify-center" style="background: var(--warm-50);">
    <div class="w-full max-w-2xl px-6">
      <div class="text-center mb-10">
        <h1 class="text-4xl font-semibold tracking-tight" style="font-family: var(--font-display); color: var(--warm-800);">Mirandas Liste</h1>
        <div class="w-12 h-0.5 mx-auto mt-4 mb-3" style="background: var(--accent);"></div>
        <p class="text-sm" style="font-family: var(--font-body); color: var(--warm-400);">Auswertungspaket wählen</p>
        {#if roleLabel}<p class="text-xs mt-2" style="color: var(--warm-500);"><span class="px-2 py-0.5 rounded-full text-[9px] font-semibold" style="background: var(--accent); color: white;">{roleLabel}</span></p>{/if}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {#each allowedPackages as pkg}
          <button onclick={() => loadPackage(pkg)}
            class="rounded-2xl p-6 text-left shadow-lg transition-all group cursor-pointer"
            style="background: white; border: 2px solid var(--warm-200);"
            onmouseenter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(176,124,62,0.15)'; }}
            onmouseleave={(e) => { e.currentTarget.style.borderColor = 'var(--warm-200)'; e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1)'; }}>
            <h3 class="text-sm font-bold mb-2" style="color: var(--warm-800); font-family: var(--font-heading);">{pkg.name}</h3>
            <p class="text-[11px] font-medium" style="color: var(--accent);">{pkg.rows.toLocaleString('de-DE')} Datensätze</p>
            <p class="text-[10px] mt-1" style="color: var(--warm-400);">{pkg.from} – {pkg.to}</p>
          </button>
        {/each}
      </div>
      {#if packageLoading}
        <p class="text-center mt-6 text-sm animate-pulse" style="color: var(--accent);">Lade Daten…</p>
      {/if}
      <div class="text-center mt-8">
        <button onclick={() => { sessionStorage.removeItem('miranda-auth'); sessionStorage.removeItem('miranda-role'); location.reload(); }}
          class="text-[10px] font-medium underline" style="color: var(--warm-400);">Abmelden</button>
      </div>
    </div>
  </div>
{:else}
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
          <button onclick={() => hideEuro = !hideEuro}
            class="px-2 py-2 rounded-xl transition-all"
            style="border: 1.5px solid {hideEuro ? 'var(--accent)' : 'var(--warm-200)'}; color: {hideEuro ? 'var(--accent)' : 'var(--warm-300)'}; background: white; font-size: 11px; line-height: 1;"
            title="Beträge ausblenden">{hideEuro ? '\u20AC\u0338' : '\u20AC'}</button>
          <button onclick={() => { sessionStorage.removeItem('miranda-auth'); sessionStorage.removeItem('miranda-role'); location.reload(); }}
            class="flex items-center gap-1.5 px-3 py-2 text-[10px] font-medium rounded-xl transition-all"
            style="border: 1.5px solid var(--warm-200); color: var(--warm-500); background: white;"
            onmouseenter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
            onmouseleave={(e) => { e.currentTarget.style.borderColor = 'var(--warm-200)'; e.currentTarget.style.color = 'var(--warm-500)'; }}
            title="Abmelden">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Logout
          </button>
          <!-- Listen dropdown -->
          <div class="relative">
            <button onclick={() => pickMenuOpen = !pickMenuOpen}
              class="flex items-center gap-1.5 px-3 py-2 text-[10px] font-medium rounded-xl transition-all"
              style="border: 1.5px solid {pickMenuOpen ? 'var(--accent)' : 'var(--warm-200)'}; color: {pickMenuOpen ? 'var(--accent)' : 'var(--warm-500)'}; background: white;"
              title="Gespeicherte Listen">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              Listen{#if savedLists.length > 0}<span class="ml-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold" style="background: var(--accent); color: white;">{savedLists.length}</span>{/if}
            </button>
            {#if pickMenuOpen}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="absolute right-0 top-full mt-1 w-56 rounded-xl shadow-lg z-50 py-2" style="background: white; border: 1px solid var(--warm-200);" onclick={(e) => e.stopPropagation()}>
                <p class="px-3 pb-1.5 text-[9px] font-bold uppercase tracking-[0.12em]" style="color: var(--warm-400);">Gespeicherte Listen</p>
                {#if savedLists.length === 0}
                  <p class="px-3 py-2 text-[10px]" style="color: var(--warm-400);">Noch keine Listen gespeichert</p>
                {:else}
                  {#each savedLists as list}
                    <div class="flex items-center justify-between px-3 py-1.5 hover:bg-[var(--warm-50)] group">
                      <button class="text-[11px] font-medium truncate flex-1 text-left" style="color: {activeListName === list.name ? 'var(--accent)' : 'var(--warm-700)'};" onclick={() => openList(list)}>
                        {list.name} <span class="text-[9px]" style="color: var(--warm-400);">({list.items.length})</span>
                      </button>
                      <button class="ml-2 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity" style="color: var(--accent);" onclick={() => openKatalogForList(list)} title="Katalog öffnen">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      </button>
                      <button class="ml-1 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity" style="color: var(--warm-400);" onclick={() => deleteList(list.name)} title="Liste löschen">✕</button>
                    </div>
                  {/each}
                {/if}
                <div style="border-top: 1px solid var(--warm-100);" class="mt-1.5 pt-1.5">
                  <button class="w-full text-left px-3 py-1.5 text-[10px] font-medium hover:bg-[var(--warm-50)]" style="color: var(--accent);" onclick={() => { clearPick(); pickPanelOpen = true; pickMenuOpen = false; }}>+ Neue Liste</button>
                </div>
              </div>
            {/if}
          </div>
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
      <!-- Time Navigation (collapsible) -->
      <div class="mb-2 rounded-xl overflow-hidden" style="background: linear-gradient(135deg, var(--warm-100), #f5efe8); border: 2px solid var(--accent); box-shadow: 0 2px 8px rgba(176,124,62,0.12);">
        <button onclick={() => zeitraumOpen = !zeitraumOpen}
          class="w-full flex items-center gap-2 px-4 py-2.5 cursor-pointer">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"
            class="transition-transform duration-200" style="color: var(--accent); transform: rotate({zeitraumOpen ? '180deg' : '0deg'});">
            <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/>
          </svg>
          <span class="text-[10px] font-bold uppercase tracking-[0.12em]" style="color: var(--accent);">Zeitraum</span>
          <span class="text-[10px] font-semibold" style="color: var(--warm-600);">
            {filteredDateRange.min ? fmtDate2(filteredDateRange.min) + ' – ' + fmtDate2(filteredDateRange.max) : ''}
          </span>
          <span class="text-[9px] font-medium px-2 py-0.5 rounded-full" style="background: var(--accent); color: white;">
            {fmtNum(filteredData.length)} Datensätze
          </span>
          <span class="ml-auto text-[10px] font-semibold" style="color: var(--warm-600);">Heute: {todayLabel}</span>
        </button>
        {#if zeitraumOpen}
          <div class="flex flex-wrap items-center gap-3 px-4 pb-3">
            <div class="flex items-center gap-2">
              <span class="text-[9px] font-bold uppercase tracking-[0.15em]" style="color: var(--accent);">Zeitraum:</span>
              <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
                {#each ([['tag','Tag'],['woche','Woche'],['monat','Monat'],['jahr','Jahr'],['alles','Alles']] as const) as [val, label], pi}
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
            {#if activePackage}
              <div class="flex items-center gap-2 ml-1 pl-2" style="border-left: 1.5px solid var(--warm-300);">
                <span class="text-[9px] font-bold uppercase tracking-[0.12em]" style="color: var(--accent);">Paket:</span>
                <span class="px-2.5 py-1 text-[10px] font-semibold rounded-full" style="border: 1.5px solid var(--accent); color: white; background: var(--accent);">{activePackage.name}</span>
                {#if allowedPackages.length > 1}
                  <button onclick={switchPackage} class="text-[9px] font-medium underline" style="color: var(--warm-400);">wechseln</button>
                {/if}
              </div>
            {/if}
            {#if packageLoading}
              <span class="text-[9px] animate-pulse ml-1" style="color: var(--warm-400);">Lade…</span>
            {/if}
          </div>
        {/if}
      </div>
      <!-- Global Art + Kollektion Filter (collapsible) -->
      {#if allArtValues.length > 0 || allKollValues.length > 0}
        <div class="mb-2 rounded-xl overflow-hidden" style="background: linear-gradient(135deg, #f0ebe4, var(--warm-100)); border: 1.5px solid var(--warm-200);">
          <button onclick={() => filterOpen = !filterOpen}
            class="w-full flex items-center gap-2 px-4 py-2 cursor-pointer"
            style="color: var(--warm-600);">
            <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"
              class="transition-transform duration-200" style="transform: rotate({filterOpen ? '180deg' : '0deg'});">
              <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/>
            </svg>
            <span class="text-[10px] font-bold uppercase tracking-[0.12em]" style="color: var(--accent);">Globale Selektion</span>
            {#if selectedArt.length > 0 || selectedKollektion.length > 0}
              <span class="text-[9px] font-medium px-2 py-0.5 rounded-full" style="background: var(--accent); color: white;">
                {selectedArt.length + selectedKollektion.length} aktiv
              </span>
            {/if}
          </button>
          {#if filterOpen}
            <div class="flex flex-wrap items-center gap-3 px-4 pb-2.5">
              {#if allArtValues.length > 0}
                <div class="flex items-center gap-2">
                  <span class="text-[9px] font-bold uppercase tracking-[0.15em]" style="color: var(--accent);">Art:</span>
                  <div class="flex flex-wrap gap-1">
                    <button onclick={() => selectedArt = []}
                      class="px-2 py-0.5 text-[10px] font-semibold rounded-full transition-all"
                      style="background: {selectedArt.length === 0 ? 'var(--accent)' : 'white'}; color: {selectedArt.length === 0 ? 'white' : 'var(--warm-500)'}; border: 1px solid {selectedArt.length === 0 ? 'var(--accent)' : 'var(--warm-200)'};">
                      Alle
                    </button>
                    {#each allArtValues as art}
                      <button onclick={() => {
                        if (selectedArt.includes(art)) {
                          selectedArt = selectedArt.filter(a => a !== art)
                        } else {
                          selectedArt = [...selectedArt, art]
                        }
                      }}
                        class="px-2 py-0.5 text-[10px] font-medium rounded-full transition-all"
                        style="background: {selectedArt.includes(art) ? 'var(--accent)' : 'white'}; color: {selectedArt.includes(art) ? 'white' : 'var(--warm-500)'}; border: 1px solid {selectedArt.includes(art) ? 'var(--accent)' : 'var(--warm-200)'};">
                        {art}
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
              {#if allKollValues.length > 0}
                <div class="flex items-center gap-2 ml-1 pl-2" style="border-left: 1.5px solid var(--warm-300);">
                  <span class="text-[9px] font-bold uppercase tracking-[0.15em]" style="color: var(--accent);">Kollektion:</span>
                  <div class="relative">
                    <button onclick={() => kollDropdownOpen = !kollDropdownOpen}
                      class="px-3 py-1 text-[10px] font-semibold rounded-lg flex items-center gap-1.5"
                      style="background: {selectedKollektion.length > 0 ? 'var(--accent)' : 'white'}; color: {selectedKollektion.length > 0 ? 'white' : 'var(--warm-500)'}; border: 1px solid {selectedKollektion.length > 0 ? 'var(--accent)' : 'var(--warm-200)'};">
                      {selectedKollektion.length === 0 ? 'Alle' : selectedKollektion.length === 1 ? selectedKollektion[0] : selectedKollektion.length + ' gewählt'}
                      <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
                    </button>
                    {#if kollDropdownOpen}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                      <div class="fixed inset-0 z-40" onclick={() => { kollDropdownOpen = false; kollSearchTerm = '' }}></div>
                      <div class="absolute top-full left-0 mt-1 rounded-xl shadow-lg z-50 overflow-hidden" style="background: white; border: 1.5px solid var(--warm-200); width: 280px; max-height: 340px;">
                        <div class="p-2" style="border-bottom: 1px solid var(--warm-100);">
                          <input type="text" bind:value={kollSearchTerm} placeholder="Suchen…"
                            class="w-full px-2.5 py-1.5 text-[11px] rounded-lg outline-none"
                            style="border: 1px solid var(--warm-200); color: var(--warm-700);"
                            onfocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                            onblur={(e) => e.currentTarget.style.borderColor = 'var(--warm-200)'} />
                        </div>
                        <div class="flex gap-2 px-2 py-1.5" style="border-bottom: 1px solid var(--warm-100);">
                          <button onclick={() => { selectedKollektion = [...allKollValues]; }} class="text-[9px] font-medium underline" style="color: var(--accent);">Alle</button>
                          <button onclick={() => { selectedKollektion = []; }} class="text-[9px] font-medium underline" style="color: var(--warm-400);">Keine</button>
                        </div>
                        <div class="overflow-y-auto" style="max-height: 250px;">
                          {#each allKollValues.filter(k => !kollSearchTerm || k.toLowerCase().includes(kollSearchTerm.toLowerCase())) as koll}
                            <label class="flex items-center gap-2 px-3 py-1.5 text-[11px] cursor-pointer hover:bg-gray-50" style="color: var(--warm-700);">
                              <input type="checkbox" checked={selectedKollektion.includes(koll)}
                                onchange={() => {
                                  if (selectedKollektion.includes(koll)) {
                                    selectedKollektion = selectedKollektion.filter(k => k !== koll)
                                  } else {
                                    selectedKollektion = [...selectedKollektion, koll]
                                  }
                                }}
                                class="rounded" style="accent-color: var(--accent);" />
                              {koll}
                            </label>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}
              {#if selectedArt.length > 0 || selectedKollektion.length > 0}
                <button onclick={() => { selectedArt = []; selectedKollektion = []; }}
                  class="text-[9px] font-medium underline ml-auto" style="color: var(--warm-400);">
                  Filter zurücksetzen
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
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
          currentLabel={currentPeriodLabel} compareLabel={comparePeriodLabel} {hideEuro}
          pickedNrs={new Set(activeItems.keys())} onTogglePick={(art) => {
            const m = new Map(activeItems);
            if (m.has(art.nr)) { m.delete(art.nr); }
            else { m.set(art.nr, { nr: art.nr, bildId: art.bildId, kollektion: art.kollektion, einzelPreis: art.einzelPreis }); }
            activeItems = m;
          }} />
      </div>
    {:else if activeTab === 'bubble'}
      <div class="max-w-6xl mx-auto px-5 pb-10">
        <div class="rounded-2xl p-5" style="background: white; border: 1px solid var(--warm-200); box-shadow: 0 4px 20px rgba(0,0,0,0.03);">
          <BubbleChart data={filteredData} {hideEuro} />
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
    {:else if activeTab === 'xtable'}
      <div class="max-w-6xl mx-auto px-5 pb-10">
        <div class="rounded-2xl p-5" style="background: white; border: 1px solid var(--warm-200); box-shadow: 0 4px 20px rgba(0,0,0,0.03);">
          <XTable data={filteredData} {hideEuro} />
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
            <div class="flex items-center gap-2">
              <p class="text-[10px] font-semibold uppercase tracking-[0.12em]" style="color: var(--warm-400);">Anzeige:</p>
              <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--warm-200);">
                <button onclick={() => (artikelVariantenMode = false, expandedVariants = new Set())} class="px-3 py-1 text-[11px] font-medium"
                  style="background: {!artikelVariantenMode ? 'var(--accent)' : 'white'}; color: {!artikelVariantenMode ? 'white' : 'var(--warm-500)'};">Alle</button>
                <button onclick={() => (artikelVariantenMode = true)} class="px-3 py-1 text-[11px] font-medium"
                  style="background: {artikelVariantenMode ? 'var(--accent)' : 'white'}; color: {artikelVariantenMode ? 'white' : 'var(--warm-500)'}; border-left: 1px solid var(--warm-200);">Varianten</button>
              </div>
            </div>
            {#if artikelVariantenMode}
              <button onclick={() => (expandedVariants = expandedVariants.size > 0 ? new Set() : new Set(artikelVarianten.map(v => v.key)))}
                class="px-2 py-1 text-[10px] rounded-lg" style="border: 1px solid var(--warm-200); color: var(--warm-500); background: white;">
                {expandedVariants.size > 0 ? '↕ Alle zuklappen' : '↕ Alle aufklappen'}
              </button>
            {/if}
            {#if !artikelVariantenMode}
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" bind:checked={artikelHideLow} class="accent-[var(--accent)]" />
                <span class="text-[11px]" style="color: var(--warm-500);">Unter {artikelMinCount} Stk als „Sonstige"</span>
              </label>
            {/if}
            <p class="text-[10px] ml-auto" style="color: var(--warm-400);">
              {#if artikelVariantenMode}{artikelVarianten.length} Varianten · {allArticles.items.length} Artikel{:else}{allArticles.items.length} Artikel{allArticles.sonstige ? ' + Sonstige' : ''}{/if}
            </p>
          </div>
          <div class="flex flex-wrap gap-3">
            {#if artikelVariantenMode}
              <!-- Varianten-Modus -->
              {#each artikelVarianten as vg (vg.key)}
                {@const vOpen = expandedVariants.has(vg.key)}
                <div class="flex flex-col">
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="cursor-pointer" onclick={() => toggleVariant(vg.key)}>
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
                    <div class="mt-2 flex flex-wrap gap-2 p-2 rounded-xl" style="background: var(--warm-50); border: 1px solid var(--warm-200);">
                      {#each vg.articles as art (art.bildId)}
                        <div class="flex flex-col items-center">
                          <!-- svelte-ignore a11y_click_events_have_key_events -->
                          <!-- svelte-ignore a11y_no_static_element_interactions -->
                          <div class="relative w-16 h-16 rounded-lg overflow-hidden shadow-sm cursor-pointer" style="border: 1px solid var(--warm-200);"
                            onclick={(e) => { e.stopPropagation(); lightboxUrl = imgUrl(art.bildId, 1000); }}>
                            <img src={imgUrl(art.bildId, 160)} alt="" class="w-full h-full object-cover" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).parentElement!.style.display='none'; }} />
                            {#if art.nr}<button class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] shadow-sm" style="background: {activeItems.has(art.nr) ? 'var(--accent)' : 'rgba(0,0,0,0.45)'};" onclick={(e) => { e.stopPropagation(); togglePick(art); }} title="Zur Liste">{activeItems.has(art.nr) ? '✓' : '+'}</button>{/if}
                          </div>
                          <p class="text-[9px] font-medium tabular-nums mt-1" style="color: var(--warm-700);">{fmtEUR(art.umsatz)}</p>
                          <p class="text-[8px] tabular-nums" style="color: var(--warm-400);">{fmtNum(art.anzahl)} Stk</p>
                          {#if art.nr}<a href="https://www.konplott.com/go/{art.nr}" target="_blank" rel="noopener" class="text-[7px] underline" style="color: var(--accent);" onclick={(e) => e.stopPropagation()}>Shop ↗</a>{/if}
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            {:else}
              <!-- Alle-Modus (original) -->
              {#each allArticles.items as art (art.bildId)}
                {@const aKey = `all::${art.bildId}`}
                {@const aOpen = expandedArticles.has(aKey)}
                <div class="flex flex-col">
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="cursor-pointer" onclick={() => expandedArticles = toggleSet(expandedArticles, aKey)}>
                    <div class="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden shadow-sm transition-all hover:shadow-lg hover:scale-105" style="border: 1.5px solid {aOpen ? 'var(--accent)' : 'var(--warm-200)'};">
                      <img src={imgUrl(art.bildId, 200)} alt="" class="w-full h-full object-cover" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).parentElement!.style.display='none'; }} />
                      {#if art.nr}<button class="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] shadow-sm" style="background: {activeItems.has(art.nr) ? 'var(--accent)' : 'rgba(0,0,0,0.45)'};" onclick={(e) => { e.stopPropagation(); togglePick(art); }} title="Zur Liste">{activeItems.has(art.nr) ? '✓' : '+'}</button>{/if}
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
                      <p class="text-[9px] font-semibold mb-1.5" style="color: var(--warm-400);">Verkäufe nach Channel</p>
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
                      <p class="text-[9px] font-semibold mb-1.5" style="color: var(--warm-400);">Verkäufe nach Channel</p>
                      {#each allArticles.sonstige.kassenStats as ks}
                        <div class="flex items-center justify-between py-0.5"><span class="text-[10px] truncate" style="color: var(--warm-600); max-width: 120px;" title={ks.kasse}>{ks.kasse}</span><span class="text-[10px] tabular-nums font-medium" style="color: var(--warm-700);">{fmtNum(ks.anzahl)} Stk</span></div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
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
                                                  <div class="relative w-14 h-14 sm:w-18 sm:h-18 rounded-lg overflow-hidden shadow-sm transition-all hover:shadow-md hover:scale-105" style="border: 1.5px solid {aOpen ? 'var(--accent)' : 'var(--warm-200)'};">
                                                    <img src={imgUrl(art.bildId, 140)} alt="" class="w-full h-full object-cover" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).parentElement!.style.display='none'; }} />
                                                    {#if art.nr}<button class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] shadow-sm" style="background: {activeItems.has(art.nr) ? 'var(--accent)' : 'rgba(0,0,0,0.45)'};" onclick={(e) => { e.stopPropagation(); togglePick(art); }} title="Zur Liste">{activeItems.has(art.nr) ? '✓' : '+'}</button>{/if}
                                                  </div>
                                                  <div class="mt-0.5 text-center"><p class="text-[8px] font-medium tabular-nums" style="color: var(--warm-700);">{fmtEUR(art.umsatz)}</p><p class="text-[7px] tabular-nums" style="color: var(--warm-400);">{fmtNum(art.anzahl)} Stk</p></div>
                                                </div>
                                                {#if aOpen}
                                                  <div class="mt-1 w-40 rounded-lg p-2 shadow-md" style="background: white; border: 1px solid var(--warm-200);">
                                                    <p class="text-[8px] font-semibold mb-1" style="color: var(--warm-400);">Verkäufe nach Channel</p>
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
                                        <div class="relative w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden shadow-sm transition-all hover:shadow-md hover:scale-105" style="border: 1.5px solid {aOpen ? 'var(--accent)' : 'var(--warm-200)'};">
                                          <img src={imgUrl(art.bildId, 160)} alt="" class="w-full h-full object-cover" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).parentElement!.style.display='none'; }} />
                                          {#if art.nr}<button class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] shadow-sm" style="background: {activeItems.has(art.nr) ? 'var(--accent)' : 'rgba(0,0,0,0.45)'};" onclick={(e) => { e.stopPropagation(); togglePick(art); }} title="Zur Liste">{activeItems.has(art.nr) ? '✓' : '+'}</button>{/if}
                                        </div>
                                        <div class="mt-1 text-center"><p class="text-[9px] font-medium tabular-nums" style="color: var(--warm-700);">{fmtEUR(art.umsatz)}</p><p class="text-[8px] tabular-nums" style="color: var(--warm-400);">{fmtNum(art.anzahl)} Stk</p></div>
                                      </div>
                                      {#if aOpen}
                                        <div class="mt-1.5 w-44 rounded-lg p-2.5 shadow-md" style="background: white; border: 1px solid var(--warm-200);">
                                          <p class="text-[9px] font-semibold mb-1.5" style="color: var(--warm-400);">Verkäufe nach Channel</p>
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
                            <div class="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden shadow-sm transition-all hover:shadow-lg hover:scale-105" style="border: 1.5px solid {aOpen ? 'var(--accent)' : 'var(--warm-200)'};">
                              <img src={imgUrl(art.bildId, 200)} alt="" class="w-full h-full object-cover" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).parentElement!.style.display='none'; }} />
                              {#if art.nr}<button class="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] shadow-sm" style="background: {activeItems.has(art.nr) ? 'var(--accent)' : 'rgba(0,0,0,0.45)'};" onclick={(e) => { e.stopPropagation(); togglePick(art); }} title="Zur Liste">{activeItems.has(art.nr) ? '✓' : '+'}</button>{/if}
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
                              <p class="text-[9px] font-semibold mb-1.5" style="color: var(--warm-400);">Verkäufe nach Channel</p>
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

<!-- Pick & Share floating panel -->
{#if !pickPanelOpen}
  <button class="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110"
    style="background: var(--accent); color: white;"
    onclick={() => pickPanelOpen = true}
    title="Pick & Share">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
    {#if activeItems.size > 0}
      <span class="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style="background: #ef4444; color: white;">{activeItems.size}</span>
    {/if}
  </button>
{:else}
  <div class="fixed bottom-6 right-6 z-40 w-80 sm:w-96 max-h-[75vh] rounded-2xl shadow-2xl flex flex-col" style="background: white; border: 1px solid var(--warm-200);">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3" style="border-bottom: 1px solid var(--warm-200);">
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent); flex-shrink: 0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <div class="min-w-0">
          <p class="text-xs font-bold" style="color: var(--warm-800);">Pick & Share</p>
          {#if activeListName}
            <p class="text-[9px] truncate" style="color: var(--accent);">{activeListName}</p>
          {:else}
            <p class="text-[9px]" style="color: var(--warm-400);">Neue Liste</p>
          {/if}
        </div>
        {#if activeItems.size > 0}
          <span class="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold" style="background: var(--accent); color: white;">{activeItems.size}</span>
        {/if}
      </div>
      <button class="w-7 h-7 rounded-full flex items-center justify-center text-sm" style="color: var(--warm-400);" onclick={() => { pickPanelOpen = false; shareMenuOpen = false; }}>✕</button>
    </div>

    <!-- Items list -->
    <div class="flex-1 overflow-y-auto px-3 py-2" style="min-height: 60px; max-height: calc(75vh - 140px);">
      {#if activeItems.size === 0}
        <p class="text-center py-6 text-[11px]" style="color: var(--warm-400);">Keine Artikel ausgewählt.<br/>Klicke + auf Artikelbildern.</p>
      {:else}
        {#each Array.from(activeItems.values()) as item (item.nr)}
          <div class="flex items-center gap-2.5 py-2" style="border-bottom: 1px solid var(--warm-100);">
            <img src={imgUrl(item.bildId, 80)} alt="" class="w-10 h-10 rounded-lg object-cover flex-shrink-0" style="border: 1px solid var(--warm-200);" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
            <div class="flex-1 min-w-0">
              <p class="text-[10px] font-semibold truncate" style="color: var(--warm-700);">{item.nr}</p>
              <p class="text-[9px] truncate" style="color: var(--warm-500);">{item.kollektion}{#if item.einzelPreis > 0} · {fmtEUR(item.einzelPreis)}{/if}</p>
              <a href="https://konplott.com/go/{item.nr}" target="_blank" rel="noopener" class="text-[8px] underline" style="color: var(--accent);">konplott.com/go/{item.nr}</a>
            </div>
            <button class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] flex-shrink-0" style="color: var(--warm-400); background: var(--warm-100);" onclick={() => removeFromPick(item.nr)} title="Entfernen">✕</button>
          </div>
        {/each}
      {/if}
    </div>

    <!-- Save-As input -->
    {#if saveAsMode}
      <div class="flex items-center gap-2 px-3 py-2" style="border-top: 1px solid var(--warm-200);">
        <input type="text" bind:value={saveAsName} placeholder="Listenname…" class="flex-1 text-[11px] px-2 py-1.5 rounded-lg outline-none" style="border: 1px solid var(--warm-200);" onkeydown={(e) => { if (e.key === 'Enter') savePickAs(saveAsName); if (e.key === 'Escape') { saveAsMode = false; saveAsName = ''; } }} />
        <button class="px-2 py-1.5 text-[10px] font-medium rounded-lg" style="background: var(--accent); color: white;" onclick={() => savePickAs(saveAsName)}>OK</button>
        <button class="text-[10px]" style="color: var(--warm-400);" onclick={() => { saveAsMode = false; saveAsName = ''; }}>✕</button>
      </div>
    {/if}

    <!-- Footer actions -->
    <div class="flex items-center gap-1 px-3 py-2.5 flex-wrap" style="border-top: 1px solid var(--warm-200);">
      <!-- Share/Copy dropdown -->
      <div class="relative">
        <button onclick={() => shareMenuOpen = !shareMenuOpen} disabled={activeItems.size === 0}
          class="px-2.5 py-1.5 text-[10px] font-medium rounded-lg transition-all disabled:opacity-30 flex items-center gap-1"
          style="border: 1px solid var(--warm-200); color: var(--warm-600); background: white;">
          {#if copyFeedback === 'nrs'}Kopiert!{:else if copyFeedback === 'link'}Link kopiert!{:else}Teilen ▾{/if}
        </button>
        {#if shareMenuOpen}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="absolute bottom-full left-0 mb-1 w-56 rounded-xl shadow-lg z-50 py-1.5" style="background: white; border: 1px solid var(--warm-200);" onclick={(e) => e.stopPropagation()}>
            <button class="w-full text-left px-3 py-1.5 text-[10px] font-medium hover:bg-[var(--warm-50)] flex items-center gap-2" style="color: var(--warm-700);"
              onclick={() => { copyArticleNumbers(); shareMenuOpen = false; }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>
              Copy Art Nr
            </button>
            <button class="w-full text-left px-3 py-1.5 text-[10px] font-medium hover:bg-[var(--warm-50)] flex items-center gap-2" style="color: var(--warm-700);"
              onclick={() => { shareArticleNumbers(); shareMenuOpen = false; }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              Share Art Nr
            </button>
            <div style="border-top: 1px solid var(--warm-100);" class="my-1.5"></div>
            <button class="w-full text-left px-3 py-1.5 text-[10px] font-medium hover:bg-[var(--warm-50)] flex items-center gap-2" style="color: var(--warm-700);"
              onclick={() => { copyKatalogLink(); shareMenuOpen = false; }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              Copy Link
            </button>
            <button class="w-full text-left px-3 py-1.5 text-[10px] font-medium hover:bg-[var(--warm-50)] flex items-center gap-2" style="color: var(--warm-700);"
              onclick={() => { shareKatalogLink(); shareMenuOpen = false; }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              Share Link
            </button>
            <div style="border-top: 1px solid var(--warm-100);" class="my-1.5"></div>
            <button class="w-full text-left px-3 py-1.5 text-[10px] font-medium hover:bg-[var(--warm-50)] flex items-center gap-2" style="color: var(--accent);"
              onclick={() => { openKatalog(); shareMenuOpen = false; }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Katalogansicht
            </button>
          </div>
        {/if}
      </div>
      <button onclick={savePick} disabled={activeItems.size === 0}
        class="px-2.5 py-1.5 text-[10px] font-medium rounded-lg transition-all disabled:opacity-30"
        style="background: var(--accent); color: white;"
        title="Speichern">{activeListName ? 'Speichern' : 'Speichern als…'}</button>
      {#if activeListName}
        <button onclick={() => { saveAsMode = true; saveAsName = ''; }}
          class="px-2.5 py-1.5 text-[10px] font-medium rounded-lg transition-all"
          style="border: 1px solid var(--warm-200); color: var(--warm-600); background: white;">Speichern als…</button>
      {/if}
      <button onclick={clearPick} disabled={activeItems.size === 0}
        class="px-2.5 py-1.5 text-[10px] font-medium rounded-lg transition-all disabled:opacity-30 ml-auto"
        style="color: #ef4444; border: 1px solid #fecaca; background: white;"
        title="Liste leeren">Leeren</button>
    </div>
  </div>
{/if}
{/if}
