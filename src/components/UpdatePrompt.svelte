<script lang="ts">
  // PWA 新版本检测：Service Worker 发现新构建时弹底部横幅，用户确认后热更新。
  import { onMount } from 'svelte'

  let needUpdate = $state(false)
  let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null

  onMount(async () => {
    if ('serviceWorker' in navigator) {
      const { registerSW } = await import('virtual:pwa-register')
      updateSW = registerSW({
        onNeedRefresh() {
          needUpdate = true
        },
      })
    }
  })
</script>

{#if needUpdate}
  <div class="update-banner">
    <div class="update-card">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
      </svg>
      <div class="update-text">
        <b>发现新版本</b>
        <span>立即更新以获得最新功能与修复</span>
      </div>
      <button class="primary" onclick={() => updateSW?.()}>立即更新</button>
      <button class="ghost" onclick={() => (needUpdate = false)} aria-label="稍后">稍后</button>
    </div>
  </div>
{/if}

<style>
  .update-banner {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 70;
    display: flex; justify-content: center;
    padding: 0 16px 16px;
    pointer-events: none;
  }
  .update-card {
    pointer-events: auto;
    display: flex; align-items: center; gap: 12px;
    background: var(--panel-2); border: 1px solid var(--border-strong);
    border-radius: 13px; padding: 11px 14px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.055),
      0 8px 18px rgba(0, 0, 0, 0.45), 0 24px 56px rgba(0, 0, 0, 0.55);
    max-width: 480px;
  }
  .update-card > svg { color: var(--accent); flex: none; }
  .update-text { display: flex; flex-direction: column; min-width: 0; }
  .update-text b { font-size: 13px; }
  .update-text span { font-size: 11.5px; color: var(--dim); }
  button { font-size: 12px; padding: 5px 13px; flex: none; }
</style>
