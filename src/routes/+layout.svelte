<script>
  import '../app.css';
  let { children } = $props();

  // "miranda" → SHA-256
  const HASH = '4d9cb7a511c6f91c59281da6b82487e928c90b9f812f688b78ed7d6139719bdc';
  let auth = $state(false);
  let pw = $state('');
  let err = $state(false);
  let shake = $state(false);

  if (typeof window !== 'undefined') auth = sessionStorage.getItem('miranda-auth') === 'ok';

  async function login() {
    err = false;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
    const h = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
    if (h === HASH) { sessionStorage.setItem('miranda-auth','ok'); auth = true; }
    else { err = true; shake = true; pw = ''; setTimeout(() => shake = false, 500); }
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
