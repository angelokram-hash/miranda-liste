<script>
  import '../app.css';
  let { children } = $props();

  // Password → role mapping (SHA-256 hashes)
  // "miranda"       → all shops
  // "konplott8080"  → all shops
  // "glitzer1968"   → Koblenz + Köln Weiden
  // "konplottnrw"   → Düsseldorf + Essen + Bochum
  // "konplottnina"  → Frankfurt
  const PW_ROLES = [
    { hash: '4d9cb7a511c6f91c59281da6b82487e928c90b9f812f688b78ed7d6139719bdc', role: 'all' },       // miranda
    { hash: '64e278ada965078d9b3761d3e90c23c8fe45d29b78d7116881f1dfbc6d7d4c9e', role: 'all' },       // konplott8080
    { hash: 'd73a90df533206be2609286d66afd8b2ce46685b403ca4dbd92faf352ab8ad4e', role: 'koblenz' },   // glitzer1968
    { hash: 'e99813429f92eee2a118399d0fbb3df8e103fbb39aa60334c5fb28fa94d3bae2', role: 'nrw' },       // konplottnrw
    { hash: '4e4b9ba59275492f1841b8ed0638563bfddccf505d9724d6cfc041b185fb23d6', role: 'frankfurt' }, // konplottnina
  ];

  let auth = $state(false);
  let pw = $state('');
  let err = $state(false);
  let shake = $state(false);

  if (typeof window !== 'undefined') auth = sessionStorage.getItem('miranda-auth') === 'ok';

  async function login() {
    err = false;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
    const h = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
    const match = PW_ROLES.find(p => p.hash === h);
    if (match) {
      sessionStorage.setItem('miranda-auth', 'ok');
      sessionStorage.setItem('miranda-role', match.role);
      auth = true;
    } else {
      err = true; shake = true; pw = ''; setTimeout(() => shake = false, 500);
    }
  }
</script>

{#if auth}
  {@render children()}
{:else}
  <div class="min-h-screen flex items-center justify-center" style="background: var(--warm-50);">
    <div class="w-full max-w-sm px-6">
      <div class="text-center mb-10">
        <h1 class="text-4xl font-semibold tracking-tight" style="font-family: var(--font-display); color: var(--warm-800);">Mirandas Liste</h1>
        <div class="w-12 h-0.5 mx-auto mt-4 mb-3" style="background: var(--accent);"></div>
        <p class="text-sm" style="font-family: var(--font-body); color: var(--warm-400);">Kollektion Performance</p>
      </div>
      <div class="rounded-2xl p-8 shadow-lg" style="background: white; border: 1px solid var(--warm-200);" class:animate-shake={shake}>
        <div class="space-y-5">
          <div>
            <label class="block text-xs font-medium mb-2 uppercase tracking-widest" style="color: var(--warm-400);">Passwort</label>
            <input type="password" bind:value={pw} onkeydown={(e) => { if(e.key==='Enter') login(); }}
              class="w-full px-4 py-3 text-sm rounded-xl outline-none transition-all"
              style="border: 1.5px solid {err ? '#e87c6b' : 'var(--warm-200)'}; font-family: var(--font-body);"
              onfocus={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
              onblur={(e) => e.currentTarget.style.borderColor = err ? '#e87c6b' : 'var(--warm-200)'}
              autofocus placeholder="••••••••" />
            {#if err}<p class="text-xs mt-2" style="color: #e87c6b;">Falsches Passwort</p>{/if}
          </div>
          <button onclick={login} disabled={!pw}
            class="w-full py-3 text-sm font-medium rounded-xl text-white transition-all disabled:opacity-40"
            style="background: var(--accent); font-family: var(--font-body);"
            onmouseenter={(e) => e.currentTarget.style.background = 'var(--warm-700)'}
            onmouseleave={(e) => e.currentTarget.style.background = 'var(--accent)'}>
            Eintreten
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%, 60% { transform: translateX(-8px); }
    40%, 80% { transform: translateX(8px); }
  }
  .animate-shake { animation: shake 0.4s ease-in-out; }
</style>
