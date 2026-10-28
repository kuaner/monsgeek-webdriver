<script lang="ts">
  import { onMount } from 'svelte'
  import { controller } from './lib/state/controller.svelte'
  import KeyboardLayout from './components/KeyboardLayout.svelte'
  import TopMenus from './components/TopMenus.svelte'
  import KeyPopover from './components/KeyPopover.svelte'
  import MacroSheet from './components/MacroSheet.svelte'
  import ChooserHost from './components/ChooserHost.svelte'
  import UpdatePrompt from './components/UpdatePrompt.svelte'
  import { infoFirmware, infoProfile } from './lib/protocol/core'

  onMount(() => controller.start())

  let importInput: HTMLInputElement

  const alertStatus = $derived(/通信中断|失败|已还原/.test(controller.status))

  async function resetWithConfirm() {
    const ok = window.confirm(
      '恢复键盘默认设置？\n\n将清除键盘内的自定义改键、宏和灯效。需要保留时，请先手动保存配置。')
    if (ok) await controller.resetKeyboard()
  }

  const statusText = $derived.by(() => {
    if (controller.connected && controller.info) {
      return `固件 ${infoFirmware(controller.info)} · 配置 ${infoProfile(controller.info)}` +
        (controller.canConfigure ? '' : ' · 只读')
    }
    return controller.connectionDescription
  })
</script>

<!-- 顶栏：状态 + 全部操作 -->
<header class="topbar">
  <span class="mark" aria-hidden="true">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2.5" y="6" width="19" height="12.5" rx="2.5" />
      <path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 12.75h.01M9.5 12.75h.01M13 12.75h.01M16.5 12.75h.01M7.5 16h9" />
    </svg>
  </span>
  <span class="topbar-title">MonsGeek Web Driver</span>
  <span class="conn-dot" class:on={controller.connected} class:err={alertStatus}></span>
  <span class="topbar-status num" class:alert={alertStatus} title={controller.status}>
    {statusText}{controller.busy ? ' · 处理中…' : ''}
  </span>

  <span class="spacer"></span>

  <div class="topbar-actions">
    {#if controller.connected}
      <TopMenus />
      {#if controller.profiles.length > 0}
        <select
          value={controller.selectedProfileId}
          onchange={(e) => (controller.selectedProfileId = e.currentTarget.value)}
        >
          <option value="">已保存配置</option>
          {#each controller.profiles as profile (profile.id)}
            <option value={profile.id}>{profile.name}</option>
          {/each}
        </select>
        <button
          disabled={!controller.selectedProfileId || !controller.canConfigure}
          onclick={() => void controller.loadProfile()}
        >切换</button>
        <button disabled={!controller.selectedProfileId} onclick={() => controller.exportProfile()}>导出</button>
      {/if}
      <button disabled={!controller.canConfigure} onclick={() => (controller.saveSheetOpen = true)}>保存配置…</button>
      <button onclick={() => importInput.click()}>导入…</button>
      <input
        type="file" accept="application/json,.json" style="display:none" bind:this={importInput}
        onchange={(e) => {
          const file = e.currentTarget.files?.[0]
          if (file) void controller.importProfile(file)
          e.currentTarget.value = ''
        }}
      />
      <button class="danger" disabled={!controller.canConfigure} onclick={() => void resetWithConfirm()}>恢复默认</button>
      <button disabled={controller.busy} onclick={() => void controller.refresh()}>刷新</button>
    {:else}
      <button class="primary" disabled={controller.busy} onclick={() => void controller.connectByPicker()}>
        连接键盘
      </button>
    {/if}
  </div>
</header>

{#if controller.selftestVisible}
  <pre id="selftest">{controller.selftestLines.join('\n')}</pre>
{/if}

<!-- 键盘：唯一视觉主体（无边框） -->
<KeyboardLayout />

<div class="kb-under caption">
  {#if controller.connected}
    点击按键改键<span class="sep">|</span>
    <i class="dot" style="background:var(--accent)"></i>已选
    <i class="dot amber" style="background:var(--amber)"></i>已改键
  {:else}
    配置保存在本浏览器，可导出 JSON 与原生客户端互通；日常操作不会自动备份。
  {/if}
</div>

{#if controller.saveSheetOpen}
  <div class="overlay">
    <div class="sheet">
      <h2>保存配置</h2>
      <p>保存当前基础层、Fn 层、已绑定的宏和灯效。以后可选择此方案切换。日常设置不会自动生成备份。</p>
      <input type="text" style="width:100%" placeholder="配置名称" bind:value={controller.profileName} />
      <div class="footer">
        <button onclick={() => (controller.saveSheetOpen = false)}>取消</button>
        <button class="primary" onclick={() => void controller.saveProfile(controller.profileName)}>保存</button>
      </div>
    </div>
  </div>
{/if}

<MacroSheet />
<KeyPopover />
<ChooserHost />
<UpdatePrompt />
