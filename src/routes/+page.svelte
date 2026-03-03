<script lang="ts">
  import { onMount } from 'svelte';

  // ─── Types ───
  interface RawRow {
    Kollektion: string; BildId: string; Anzahl: number; EinzelPreis: number;
    Umsatz: number; Art: string; Form: string; Nr: string; SubKollektion: string;
    Kasse: string; Monat: string; KW: string; Wochentag: string;
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

  type TabId = 'kollektion' | 'form' | 'art' | 'formpfad' | 'preis' | 'kasse';

  // ─── State ───
  let allData: RawRow[] = $state([]);
  let loading = $state(true);
  let activeTab = $state<TabId>('kollektion');

  // Pre-aggregated data per tab
  let tabData = $state<Record<TabId, GroupNode[]>>({ kollektion: [], form: [], art: [], formpfad: [], preis: [], kasse: [] });
  // For Preis tab: two sub-modes
  let preisSubTab = $state<'formpfad' | 'kollektion'>('formpfad');
  let preisData = $state<Record<'formpfad' | 'kollektion', GroupNode[]>>({ formpfad: [], kollektion: [] });
  // For Kollektion tab: direct articles vs SubKollektion
  let kollSubMode = $state<'artikel' | 'subkollektion'>('artikel');
  let kollData = $state<Record<'artikel' | 'subkollektion', GroupNode[]>>({ artikel: [], subkollektion: [] });
  let totalUmsatz = $state(0);
  let totalAnzahl = $state(0);

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

  // ─── Derived ───
  let currentGroups = $derived(
    activeTab === 'preis' ? preisData[preisSubTab] :
    activeTab === 'kollektion' ? kollData[kollSubMode] :
    tabData[activeTab]
  );

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
  onMount(async () => {
    const res = await fetch('/data.json');
    allData = await res.json();

    let total = 0;
    for (const r of allData) total += (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0);
    totalUmsatz = total;
    totalAnzahl = allData.reduce((s, r) => s + (Number(r.Anzahl) || 0), 0);

    // Tab 1: by Kollektion — two modes: direct articles OR SubKollektion → articles
    const byKoll = new Map<string, RawRow[]>();
    for (const r of allData) { const k = r.Kollektion; if (!byKoll.has(k)) byKoll.set(k, []); byKoll.get(k)!.push(r); }
    kollData.artikel = Array.from(byKoll.entries()).map(([n, rows]) => buildGroup(n, rows, total));
    kollData.subkollektion = Array.from(byKoll.entries()).map(([n, rows]) => buildGroup(n, rows, total, ['SubKollektion']));
    tabData.kollektion = kollData.artikel;

    // Tab 2: by Form → Kollektion
    const byForm = new Map<string, RawRow[]>();
    for (const r of allData) { const k = r.Form || '(leer)'; if (!byForm.has(k)) byForm.set(k, []); byForm.get(k)!.push(r); }
    tabData.form = Array.from(byForm.entries()).map(([n, rows]) => buildGroup(n, rows, total, ['Kollektion']));

    // Tab 3: by Art → subgroup by Kollektion
    const byArt = new Map<string, RawRow[]>();
    for (const r of allData) { const k = r.Art || '(leer)'; if (!byArt.has(k)) byArt.set(k, []); byArt.get(k)!.push(r); }
    tabData.art = Array.from(byArt.entries()).map(([n, rows]) => buildGroup(n, rows, total, ['Kollektion']));

    // Tab 4: by FormPfad (first word of Form) → Form → Kollektion
    const byFormPfad = new Map<string, RawRow[]>();
    for (const r of allData) {
      const form = (r.Form || '').trim();
      const pfad = form.split(/\s+/)[0] || '(leer)';
      if (!byFormPfad.has(pfad)) byFormPfad.set(pfad, []);
      byFormPfad.get(pfad)!.push(r);
    }
    tabData.formpfad = Array.from(byFormPfad.entries()).map(([n, rows]) => buildGroup(n, rows, total, ['Form', 'Kollektion']));

    // Tab 5: by Preisgruppe → FormPfad OR Kollektion
    const preisRanges: [string, number, number][] = [
      ['0 – 20 €', 0, 20], ['20 – 50 €', 20, 50], ['50 – 120 €', 50, 120],
      ['120 – 250 €', 120, 250], ['über 250 €', 250, Infinity],
    ];
    function getPreisgruppe(ep: number): string {
      for (const [label, lo, hi] of preisRanges) { if (ep >= lo && ep < hi) return label; }
      return 'über 250 €';
    }
    // Build both variants for preis tab
    const byPreisFP = new Map<string, RawRow[]>();
    const byPreisKoll = new Map<string, RawRow[]>();
    for (const r of allData) {
      const pg = getPreisgruppe(Number(r.EinzelPreis) || 0);
      if (!byPreisFP.has(pg)) byPreisFP.set(pg, []);
      byPreisFP.get(pg)!.push(r);
      if (!byPreisKoll.has(pg)) byPreisKoll.set(pg, []);
      byPreisKoll.get(pg)!.push(r);
    }
    // Sort by price range order
    const preisOrder = preisRanges.map(p => p[0]);
    preisData.formpfad = preisOrder
      .filter(p => byPreisFP.has(p))
      .map(p => buildGroup(p, byPreisFP.get(p)!, total, ['Form', 'Kollektion']));
    preisData.kollektion = preisOrder
      .filter(p => byPreisKoll.has(p))
      .map(p => buildGroup(p, byPreisKoll.get(p)!, total, ['Kollektion']));
    // Also set tabData.preis to default (will use preisData via currentGroups)
    tabData.preis = preisData.formpfad;

    // Tab 6: by Kasse → Kollektion
    const byKasse = new Map<string, RawRow[]>();
    for (const r of allData) { const k = r.Kasse || '(leer)'; if (!byKasse.has(k)) byKasse.set(k, []); byKasse.get(k)!.push(r); }
    tabData.kasse = Array.from(byKasse.entries()).map(([n, rows]) => buildGroup(n, rows, total, ['Kollektion']));

    loading = false;
  });

  const TABS: { id: TabId; label: string }[] = [
    { id: 'kollektion', label: 'Kollektionen' },
    { id: 'form', label: 'Form' },
    { id: 'art', label: 'Typ' },
    { id: 'formpfad', label: 'FormPfad' },
    { id: 'preis', label: 'Preisgruppe' },
    { id: 'kasse', label: 'Kasse' },
  ];
</script>

<div class="min-h-screen" style="background: var(--warm-50);">
  <!-- Header -->
  <header class="sticky top-0 z-40 backdrop-blur-xl" style="background: rgba(250,248,245,0.85); border-bottom: 1px solid var(--warm-200);">
    <div class="max-w-6xl mx-auto px-5 pt-4 pb-0">
      <div class="flex items-center justify-between gap-4 mb-3">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight" style="font-family: var(--font-display); color: var(--warm-800);">Mirandas Liste</h1>
          <p class="text-xs mt-0.5" style="color: var(--warm-400);">{fmtNum(filtered.length)} Einträge · {fmtEUR(totalUmsatz)} Gesamtumsatz</p>
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
      <!-- Tabs -->
      <div class="flex gap-0 -mb-px overflow-x-auto">
        {#each TABS as tab}
          <button onclick={() => switchTab(tab.id)}
            class="px-4 py-2.5 text-xs font-medium transition-all border-b-2 whitespace-nowrap"
            style="color: {activeTab === tab.id ? 'var(--accent)' : 'var(--warm-400)'}; border-color: {activeTab === tab.id ? 'var(--accent)' : 'transparent'}; font-family: var(--font-body);">
            {tab.label}
          </button>
        {/each}
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
        <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);"><p class="text-[9px] font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">Umsatz</p><p class="text-lg font-bold mt-0.5 tabular-nums" style="color: var(--warm-800);">{fmtEUR(totalUmsatz)}</p></div>
        <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);"><p class="text-[9px] font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">Stück</p><p class="text-lg font-bold mt-0.5 tabular-nums" style="color: var(--warm-800);">{fmtNum(totalAnzahl)}</p></div>
        <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);"><p class="text-[9px] font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">Einträge</p><p class="text-lg font-bold mt-0.5" style="color: var(--warm-800);">{fmtNum(currentGroups.length)}</p></div>
        <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);"><p class="text-[9px] font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">⌀ Preis</p><p class="text-lg font-bold mt-0.5 tabular-nums" style="color: var(--warm-800);">{fmtEUR(totalAnzahl > 0 ? totalUmsatz / totalAnzahl : 0)}</p></div>
      </div>
    </div>

    <!-- Table -->
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
                <p class="text-sm text-right tabular-nums font-medium" style="color: var(--warm-700);">{fmtEUR(g1.umsatz)}</p>
                <p class="text-sm text-right tabular-nums" style="color: var(--warm-600);">{fmtNum(g1.anzahl)}</p>
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
