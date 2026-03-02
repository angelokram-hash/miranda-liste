<script lang="ts">
  import { onMount } from 'svelte';

  interface RawRow {
    Kollektion: string;
    BildId: string;
    Anzahl: number;
    EinzelPreis: number;
    Umsatz: number;
    Art: string;
    Form: string;
    Nr: string;
    SubKollektion: string;
  }

  interface Article {
    bildId: string;
    umsatz: number;
    anzahl: number;
  }

  interface Collection {
    name: string;
    thumbBildId: string;
    umsatz: number;
    anzahl: number;
    avgPreis: number;
    anteil: number; // % of total
    articles: Article[];
  }

  let loading = $state(true);
  let collections = $state<Collection[]>([]);
  let totalUmsatz = $state(0);
  let totalAnzahl = $state(0);
  let expandedSet = $state(new Set<string>());
  let searchTerm = $state('');
  let sortKey = $state<'umsatz' | 'anzahl' | 'avgPreis' | 'name' | 'anteil'>('umsatz');
  let sortDir = $state<'asc' | 'desc'>('desc');
  let lightboxUrl = $state('');

  let filtered = $derived.by(() => {
    let list = collections;
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(t));
    }
    const dir = sortDir === 'desc' ? -1 : 1;
    list = [...list].sort((a, b) => {
      if (sortKey === 'name') return dir * -1 * a.name.localeCompare(b.name, 'de');
      return dir * ((b as any)[sortKey] - (a as any)[sortKey]);
    });
    return list;
  });

  function imgUrl(bid: string | number, size = 200): string {
    const id = typeof bid === 'number' ? Math.round(bid) : bid;
    return `https://konplott-cdn.com/mytism/image/${id}/${id}.jpg?width=${size}&height=${size}&box=true`;
  }

  function fmtEUR(v: number): string { return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }); }
  function fmtNum(v: number): string { return v.toLocaleString('de-DE', { maximumFractionDigits: 0 }); }
  function fmtPct(v: number): string { return v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %'; }

  function toggleExpand(name: string) {
    const s = new Set(expandedSet);
    if (s.has(name)) s.delete(name); else s.add(name);
    expandedSet = s;
  }

  function setSort(key: typeof sortKey) {
    if (sortKey === key) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
    else { sortKey = key; sortDir = 'desc'; }
  }

  onMount(async () => {
    const res = await fetch('/data.json');
    const data: RawRow[] = await res.json();

    // Aggregate by Kollektion
    const map = new Map<string, { umsatz: number; anzahl: number; articles: Map<string, { umsatz: number; anzahl: number }> }>();

    for (const r of data) {
      const k = r.Kollektion;
      if (!map.has(k)) map.set(k, { umsatz: 0, anzahl: 0, articles: new Map() });
      const col = map.get(k)!;
      const ep = Number(r.EinzelPreis) || 0;
      const an = Number(r.Anzahl) || 0;
      const lineUmsatz = ep * an;
      col.umsatz += lineUmsatz;
      col.anzahl += an;

      const bid = String(r.BildId);
      if (bid && bid !== '0' && bid !== '') {
        if (!col.articles.has(bid)) col.articles.set(bid, { umsatz: 0, anzahl: 0 });
        const art = col.articles.get(bid)!;
        art.umsatz += lineUmsatz;
        art.anzahl += an;
      }
    }

    const total = Array.from(map.values()).reduce((s, c) => s + c.umsatz, 0);
    totalUmsatz = total;
    totalAnzahl = Array.from(map.values()).reduce((s, c) => s + c.anzahl, 0);

    collections = Array.from(map.entries()).map(([name, c]) => {
      const articles = Array.from(c.articles.entries())
        .map(([bildId, a]) => ({ bildId, umsatz: a.umsatz, anzahl: a.anzahl }))
        .sort((a, b) => b.umsatz - a.umsatz);

      return {
        name,
        thumbBildId: articles[0]?.bildId || '',
        umsatz: c.umsatz,
        anzahl: c.anzahl,
        avgPreis: c.anzahl > 0 ? c.umsatz / c.anzahl : 0,
        anteil: total > 0 ? (c.umsatz / total) * 100 : 0,
        articles,
      };
    });

    loading = false;
  });
</script>

<div class="min-h-screen" style="background: var(--warm-50);">
  <!-- Header -->
  <header class="sticky top-0 z-40 backdrop-blur-xl" style="background: rgba(250,248,245,0.85); border-bottom: 1px solid var(--warm-200);">
    <div class="max-w-6xl mx-auto px-5 py-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight" style="font-family: var(--font-display); color: var(--warm-800);">Mirandas Liste</h1>
          <p class="text-xs mt-0.5" style="color: var(--warm-400);">{fmtNum(filtered.length)} Kollektionen · {fmtEUR(totalUmsatz)} Gesamtumsatz</p>
        </div>
        <div class="relative">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style="color: var(--warm-400);" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input type="text" bind:value={searchTerm} placeholder="Kollektion suchen..."
            class="pl-10 pr-4 py-2.5 text-sm rounded-xl w-64 outline-none transition-all"
            style="border: 1.5px solid var(--warm-200); font-family: var(--font-body); background: white;"
            onfocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
            onblur={(e) => e.currentTarget.style.borderColor = 'var(--warm-200)'} />
        </div>
      </div>
    </div>
  </header>

  {#if loading}
    <div class="flex items-center justify-center h-80">
      <div class="text-center">
        <div class="w-10 h-10 rounded-full animate-spin mx-auto mb-4" style="border: 3px solid var(--warm-200); border-top-color: var(--accent);"></div>
        <p style="color: var(--warm-400); font-family: var(--font-body);">Daten werden geladen...</p>
      </div>
    </div>
  {:else}
    <!-- KPIs -->
    <div class="max-w-6xl mx-auto px-5 pt-5 pb-4">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
          <p class="text-[9px] font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">Umsatz</p>
          <p class="text-lg font-bold mt-0.5 tabular-nums" style="color: var(--warm-800);">{fmtEUR(totalUmsatz)}</p>
        </div>
        <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
          <p class="text-[9px] font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">Stück</p>
          <p class="text-lg font-bold mt-0.5 tabular-nums" style="color: var(--warm-800);">{fmtNum(totalAnzahl)}</p>
        </div>
        <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
          <p class="text-[9px] font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">Kollektionen</p>
          <p class="text-lg font-bold mt-0.5" style="color: var(--warm-800);">{fmtNum(collections.length)}</p>
        </div>
        <div class="rounded-xl p-4" style="background: white; border: 1px solid var(--warm-200);">
          <p class="text-[9px] font-semibold uppercase tracking-[0.15em]" style="color: var(--warm-400);">⌀ Preis</p>
          <p class="text-lg font-bold mt-0.5 tabular-nums" style="color: var(--warm-800);">{fmtEUR(totalAnzahl > 0 ? totalUmsatz / totalAnzahl : 0)}</p>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div class="max-w-6xl mx-auto px-5 pb-10">
      <div class="rounded-2xl overflow-hidden" style="background: white; border: 1px solid var(--warm-200); box-shadow: 0 4px 20px rgba(0,0,0,0.03);">
        <!-- Column Headers -->
        <div class="grid items-center gap-2 px-5 py-3" style="grid-template-columns: 56px 1fr repeat(4, minmax(90px, auto)); border-bottom: 2px solid var(--warm-200); background: var(--warm-100);">
          <div></div>
          <button onclick={() => setSort('name')} class="text-left text-[10px] font-semibold uppercase tracking-[0.12em] cursor-pointer hover:opacity-70 transition-opacity" style="color: var(--warm-500);">
            Kollektion {sortKey === 'name' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
          </button>
          <button onclick={() => setSort('umsatz')} class="text-right text-[10px] font-semibold uppercase tracking-[0.12em] cursor-pointer hover:opacity-70 transition-opacity" style="color: var(--warm-500);">
            Umsatz {sortKey === 'umsatz' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
          </button>
          <button onclick={() => setSort('anzahl')} class="text-right text-[10px] font-semibold uppercase tracking-[0.12em] cursor-pointer hover:opacity-70 transition-opacity" style="color: var(--warm-500);">
            Stück {sortKey === 'anzahl' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
          </button>
          <button onclick={() => setSort('avgPreis')} class="text-right text-[10px] font-semibold uppercase tracking-[0.12em] cursor-pointer hover:opacity-70 transition-opacity" style="color: var(--warm-500);">
            ⌀ Preis {sortKey === 'avgPreis' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
          </button>
          <button onclick={() => setSort('anteil')} class="text-right text-[10px] font-semibold uppercase tracking-[0.12em] cursor-pointer hover:opacity-70 transition-opacity" style="color: var(--warm-500);">
            Anteil {sortKey === 'anteil' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
          </button>
        </div>

        <!-- Rows -->
        <div class="divide-y" style="border-color: var(--warm-100);">
          {#each filtered as col, i (col.name)}
            {@const isOpen = expandedSet.has(col.name)}
            <!-- Row -->
            <div>
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="grid items-center gap-2 px-5 py-3 cursor-pointer transition-colors hover:bg-[var(--warm-100)]/40"
                style="grid-template-columns: 56px 1fr repeat(4, minmax(90px, auto));"
                onclick={() => toggleExpand(col.name)}>
                <!-- Thumb -->
                <div class="relative">
                  {#if col.thumbBildId}
                    <img src={imgUrl(col.thumbBildId, 100)} alt="" class="w-11 h-11 object-cover rounded-lg shadow-sm" loading="lazy"
                      onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
                  {:else}
                    <div class="w-11 h-11 rounded-lg flex items-center justify-center" style="background: var(--warm-100);">
                      <svg class="w-5 h-5" style="color: var(--warm-300);" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                    </div>
                  {/if}
                  <!-- Expand indicator -->
                  <div class="absolute -right-1 -bottom-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px] transition-transform"
                    style="background: var(--accent); color: white;"
                    class:rotate-180={isOpen}>
                    ▾
                  </div>
                </div>

                <!-- Name -->
                <div class="min-w-0">
                  <p class="text-sm font-medium truncate" style="color: var(--warm-800); font-family: var(--font-body);">{col.name}</p>
                  <p class="text-[10px]" style="color: var(--warm-400);">{col.articles.length} Artikel</p>
                </div>

                <!-- Umsatz -->
                <p class="text-sm text-right tabular-nums font-medium" style="color: var(--warm-700);">{fmtEUR(col.umsatz)}</p>

                <!-- Anzahl -->
                <p class="text-sm text-right tabular-nums" style="color: var(--warm-600);">{fmtNum(col.anzahl)}</p>

                <!-- Avg Preis -->
                <p class="text-sm text-right tabular-nums" style="color: var(--warm-600);">{fmtEUR(col.avgPreis)}</p>

                <!-- Anteil -->
                <div class="text-right">
                  <p class="text-sm tabular-nums font-medium" style="color: var(--accent);">{fmtPct(col.anteil)}</p>
                  <div class="w-full h-1 rounded-full mt-1 overflow-hidden" style="background: var(--warm-100);">
                    <div class="h-full rounded-full transition-all" style="width: {Math.min(col.anteil * 3, 100)}%; background: var(--accent);"></div>
                  </div>
                </div>
              </div>

              <!-- Expanded: Article Gallery -->
              {#if isOpen}
                <div class="px-5 pb-5 pt-1" style="background: var(--warm-100); border-top: 1px solid var(--warm-200);">
                  <p class="text-[10px] font-semibold uppercase tracking-[0.12em] mb-3" style="color: var(--warm-400);">
                    Verkaufte Artikel — sortiert nach Umsatz
                  </p>
                  <div class="flex flex-wrap gap-3">
                    {#each col.articles as art}
                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <div class="group cursor-pointer" onclick={() => lightboxUrl = imgUrl(art.bildId, 1000)}>
                        <div class="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden shadow-sm transition-all group-hover:shadow-lg group-hover:scale-105" style="border: 1.5px solid var(--warm-200);">
                          <img src={imgUrl(art.bildId, 200)} alt="" class="w-full h-full object-cover" loading="lazy"
                            onerror={(e) => { (e.currentTarget as HTMLImageElement).parentElement!.style.display='none'; }} />
                        </div>
                        <div class="mt-1.5 text-center">
                          <p class="text-[10px] font-medium tabular-nums" style="color: var(--warm-700);">{fmtEUR(art.umsatz)}</p>
                          <p class="text-[9px] tabular-nums" style="color: var(--warm-400);">{fmtNum(art.anzahl)} Stk</p>
                        </div>
                      </div>
                    {/each}
                  </div>
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
  <div class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md" style="background: rgba(31,26,18,0.7);"
    onclick={() => lightboxUrl = ''}>
    <img src={lightboxUrl} alt="Produkt" class="max-w-[90vw] max-h-[90vh] rounded-2xl shadow-2xl" />
    <button class="absolute top-6 right-6 w-10 h-10 rounded-full flex items-center justify-center text-white text-xl" style="background: rgba(0,0,0,0.4);"
      onclick={() => lightboxUrl = ''}>✕</button>
  </div>
{/if}
