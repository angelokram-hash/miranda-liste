<script lang="ts">
  import { onMount } from 'svelte'

  interface KatalogItem {
    nr: string
    bildId: string
    kollektion: string
    einzelPreis: number
  }

  let listName = $state('')
  let items: KatalogItem[] = $state([])
  let createdAt = $state('')
  let loading = $state(true)
  let lightboxUrl = $state('')
  let copied = $state(false)

  function imgUrl(bid: string | number, size = 600): string {
    const id = typeof bid === 'number' ? Math.round(bid) : bid
    return `https://konplott-cdn.com/mytism/image/${id}/${id}.jpg?width=${size}&height=${size}&box=true`
  }

  function fmtEUR(v: number): string {
    return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }

  function parseHash() {
    const hash = location.hash.slice(1)
    if (!hash) return
    const params = new URLSearchParams(hash)
    listName = decodeURIComponent(params.get('pick') || params.get('name') || 'Katalog')
    createdAt = params.get('date') || new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const nrs = (params.get('nrs') || '').split(',').filter(Boolean)
    const bids = (params.get('bids') || '').split(',').filter(Boolean)
    const kolls = (params.get('kolls') || '').split(',').map(decodeURIComponent).filter(Boolean)
    const prices = (params.get('prices') || '').split(',').filter(Boolean)

    items = nrs.map((nr, i) => ({
      nr,
      bildId: bids[i] || nr,
      kollektion: kolls[i] || '',
      einzelPreis: Number(prices[i]) || 0,
    }))
  }

  // Also try loading from localStorage if items came from Pick & Share
  function tryLoadFromStorage() {
    try {
      const hash = location.hash.slice(1)
      const params = new URLSearchParams(hash)
      const name = decodeURIComponent(params.get('pick') || params.get('name') || '')
      if (!name) return
      const raw = localStorage.getItem('miranda-picks')
      if (!raw) return
      const lists = JSON.parse(raw) as { name: string; items: KatalogItem[] }[]
      const found = lists.find(l => l.name === name)
      if (found && found.items.length > 0 && items.length === 0) {
        items = found.items
      }
    } catch {}
  }

  function copyUrl() {
    navigator.clipboard.writeText(location.href)
    copied = true
    setTimeout(() => copied = false, 2000)
  }

  async function shareUrl() {
    if (navigator.share) {
      await navigator.share({ title: `Konplott — ${listName}`, url: location.href })
    } else {
      copyUrl()
    }
  }

  function printPage() {
    window.print()
  }

  onMount(() => {
    parseHash()
    tryLoadFromStorage()
    loading = false
  })
</script>

<svelte:head>
  <title>Konplott — {listName || 'Katalog'}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#if loading}
  <div class="min-h-screen flex items-center justify-center" style="background: var(--warm-50);">
    <div class="animate-pulse text-sm" style="color: var(--warm-400); font-family: var(--font-body);">Laden…</div>
  </div>
{:else if items.length === 0}
  <div class="min-h-screen flex items-center justify-center" style="background: var(--warm-50);">
    <div class="text-center max-w-md px-6">
      <h1 class="text-2xl font-semibold mb-3" style="font-family: var(--font-display); color: var(--warm-800);">Kein Katalog gefunden</h1>
      <p class="text-sm mb-6" style="color: var(--warm-400); font-family: var(--font-body);">Erstelle einen Katalog über die Pick & Share Funktion im Dashboard.</p>
      <a href="/" class="inline-block px-5 py-2.5 text-sm font-medium rounded-xl transition-all" style="background: var(--accent); color: white; font-family: var(--font-body);">Zum Dashboard</a>
    </div>
  </div>
{:else}
  <div class="min-h-screen" style="background: var(--warm-50);">
    <!-- Header -->
    <header class="sticky top-0 z-30 backdrop-blur-xl print:static" style="background: rgba(250, 248, 245, 0.92); border-bottom: 1px solid var(--warm-200);">
      <div class="max-w-6xl mx-auto px-4 sm:px-8 py-4 flex items-center justify-between">
        <div>
          <h1 class="text-2xl sm:text-3xl font-semibold tracking-tight" style="font-family: var(--font-display); color: var(--warm-800);">{listName}</h1>
          <div class="flex items-center gap-3 mt-1">
            <span class="text-xs" style="color: var(--warm-400); font-family: var(--font-body);">{createdAt}</span>
            <span class="w-1 h-1 rounded-full" style="background: var(--warm-300);"></span>
            <span class="text-xs" style="color: var(--warm-400); font-family: var(--font-body);">{items.length} Artikel</span>
          </div>
        </div>
        <div class="flex items-center gap-2 print:hidden">
          <button onclick={copyUrl}
            class="px-3 py-2 text-xs font-medium rounded-xl transition-all"
            style="border: 1px solid var(--warm-200); color: var(--warm-600); background: white; font-family: var(--font-body);">
            {copied ? 'Kopiert!' : 'Link kopieren'}
          </button>
          <button onclick={shareUrl}
            class="px-3 py-2 text-xs font-medium rounded-xl transition-all"
            style="border: 1px solid var(--warm-200); color: var(--warm-600); background: white; font-family: var(--font-body);">
            Teilen
          </button>
          <button onclick={printPage}
            class="px-3 py-2 text-xs font-medium rounded-xl transition-all"
            style="background: var(--accent); color: white; font-family: var(--font-body);">
            Drucken
          </button>
        </div>
      </div>
    </header>

    <!-- Catalog Grid -->
    <main class="max-w-6xl mx-auto px-4 sm:px-8 py-8">
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-6">
        {#each items as item (item.nr)}
          <div class="group rounded-2xl overflow-hidden transition-all hover:shadow-xl hover:-translate-y-1"
            style="background: white; border: 1px solid var(--warm-200);">
            <!-- Image -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="aspect-square overflow-hidden cursor-pointer" onclick={() => lightboxUrl = imgUrl(item.bildId, 1000)}>
              <img
                src={imgUrl(item.bildId, 600)}
                alt={item.nr}
                class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
                onerror={(e) => {
                  const el = e.currentTarget as HTMLImageElement
                  el.style.display = 'none'
                  el.parentElement!.innerHTML = `<div class="w-full h-full flex items-center justify-center" style="background: var(--warm-100); color: var(--warm-400);"><span class="text-sm">${item.nr}</span></div>`
                }}
              />
            </div>
            <!-- Info -->
            <div class="px-3.5 py-3">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="text-sm font-semibold truncate" style="color: var(--warm-800); font-family: var(--font-body);">{item.nr}</p>
                  {#if item.kollektion}
                    <p class="text-xs truncate mt-0.5" style="color: var(--warm-500); font-family: var(--font-body);">{item.kollektion}</p>
                  {/if}
                </div>
                {#if item.einzelPreis > 0}
                  <span class="text-sm font-semibold whitespace-nowrap" style="color: var(--accent); font-family: var(--font-body);">{fmtEUR(item.einzelPreis)}</span>
                {/if}
              </div>
              <a href="https://www.konplott.com/go/{item.nr}" target="_blank" rel="noopener"
                class="inline-flex items-center gap-1 mt-2 text-xs font-medium transition-all hover:opacity-70"
                style="color: var(--accent); font-family: var(--font-body);">
                Im Shop ansehen
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            </div>
          </div>
        {/each}
      </div>
    </main>

    <!-- Footer -->
    <footer class="max-w-6xl mx-auto px-4 sm:px-8 py-8 print:py-4">
      <div class="flex items-center justify-between" style="border-top: 1px solid var(--warm-200); padding-top: 1.5rem;">
        <div>
          <p class="text-xs font-medium" style="color: var(--warm-400); font-family: var(--font-display);">Konplott</p>
          <p class="text-[10px] mt-0.5" style="color: var(--warm-300); font-family: var(--font-body);">konplott.com</p>
        </div>
        <a href="/" class="text-xs font-medium transition-all hover:opacity-70 print:hidden" style="color: var(--accent); font-family: var(--font-body);">
          Zum Dashboard
        </a>
      </div>
    </footer>
  </div>

  <!-- Lightbox -->
  {#if lightboxUrl}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md print:hidden" style="background: rgba(31,26,18,0.7);" onclick={() => lightboxUrl = ''}>
      <img src={lightboxUrl} alt="Produkt" class="max-w-[90vw] max-h-[90vh] rounded-2xl shadow-2xl" />
      <button class="absolute top-6 right-6 w-10 h-10 rounded-full flex items-center justify-center text-white text-xl" style="background: rgba(0,0,0,0.4);" onclick={() => lightboxUrl = ''}>✕</button>
    </div>
  {/if}
{/if}

<style>
  @media print {
    header { position: static !important; background: white !important; backdrop-filter: none !important; }
    .group { break-inside: avoid; page-break-inside: avoid; box-shadow: none !important; transform: none !important; }
    .group:hover { box-shadow: none !important; transform: none !important; }
  }
</style>
