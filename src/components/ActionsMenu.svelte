<script lang="ts">
  import { controller } from '../lib/state/controller.svelte'

  let open = $state(false)
  let anchor: HTMLButtonElement
  let importInput: HTMLInputElement
  let position = $state({ top: 0, left: 0 })

  function place() {
    const rect = anchor.getBoundingClientRect()
    position = { top: rect.bottom + 8, left: Math.max(10, Math.min(rect.right - 240, window.innerWidth - 250)) }
  }

  function toggle() {
    open = !open
    if (open) {
      controller.lightPanelOpen = false
      place()
    }
  }

  function onPointerDown(event: PointerEvent) {
    const target = event.target as Node
    if (open && !anchor.contains(target) && !document.querySelector('#actions-menu')?.contains(target)) open = false
  }

  async function resetWithConfirm() {
    open = false
    const ok = window.confirm('恢复键盘默认设置？\n\n将清除键盘内的自定义改键、宏和灯效。需要保留时，请先手动保存配置。')
    if (ok) await controller.resetKeyboard()
  }
</script>

<svelte:window onpointerdown={onPointerDown} onresize={() => { if (open) place() }}
  onkeydown={(event) => { if (event.key === 'Escape') open = false }} />

<button bind:this={anchor} class="more-trigger" aria-label="更多操作" aria-expanded={open} onclick={toggle}>更多 <span aria-hidden="true">⋯</span></button>
<input type="file" accept="application/json,.json" style="display:none" bind:this={importInput}
  onchange={(event) => {
    const file = event.currentTarget.files?.[0]
    if (file) void controller.importProfile(file)
    event.currentTarget.value = ''
  }} />

{#if open}
  <div id="actions-menu" class="menu-pop actions-menu" role="group" aria-label="更多操作"
    style={`top:${position.top}px;left:${position.left}px`}>
    {#if controller.profiles.length > 0}
      <select aria-label="已保存配置" value={controller.selectedProfileId}
        onchange={(event) => (controller.selectedProfileId = event.currentTarget.value)}>
        <option value="">已保存配置</option>
        {#each controller.profiles as profile (profile.id)}
          <option value={profile.id}>{profile.name}</option>
        {/each}
      </select>
      <button disabled={!controller.selectedProfileId || !controller.canConfigure || controller.busy}
        onclick={() => { open = false; void controller.loadProfile() }}>切换配置</button>
      <button disabled={!controller.selectedProfileId || controller.busy}
        onclick={() => { open = false; controller.exportProfile() }}>导出配置</button>
      <div class="actions-divider"></div>
    {/if}
    <button disabled={!controller.canConfigure || controller.busy}
      onclick={() => { open = false; controller.saveSheetOpen = true }}>保存配置…</button>
    <button disabled={controller.busy} onclick={() => { open = false; importInput.click() }}>导入配置…</button>
    <div class="actions-divider"></div>
    <button class="danger" disabled={!controller.canConfigure || controller.busy}
      onclick={() => void resetWithConfirm()}>恢复默认</button>
    <button disabled={controller.busy} onclick={() => { open = false; void controller.disconnect() }}>断开连接</button>
  </div>
{/if}
