<script lang="ts">
  import { onMount } from 'svelte'
  import { controller } from './lib/state/controller.svelte'
  import KeyboardLayout from './components/KeyboardLayout.svelte'
  import TopMenus from './components/TopMenus.svelte'
  import ActionsMenu from './components/ActionsMenu.svelte'
  import KeyPopover from './components/KeyPopover.svelte'
  import MacroSheet from './components/MacroSheet.svelte'
  import ChooserHost from './components/ChooserHost.svelte'
  import UpdatePrompt from './components/UpdatePrompt.svelte'
  import { infoFirmware } from './lib/protocol/core'

  onMount(() => controller.start())

  const alertStatus = $derived(!!controller.errorMessage || /通信中断|失败|已还原/.test(controller.status))

  const statusText = $derived.by(() => {
    if (alertStatus) return controller.errorMessage ?? controller.status
    if (!controller.connected && (controller.busy || controller.connectionChecking)) {
      return controller.busy ? controller.status : '正在连接键盘…'
    }
    if (controller.connected && controller.info) {
      return `${controller.connectionMode === 'bluetooth' ? '蓝牙' : 'USB'} · 固件 ${infoFirmware(controller.info)}` +
        (controller.canConfigure ? '' : ' · 只读')
    }
    return controller.connectionDescription
  })
</script>

<!-- 顶栏：状态 + 全部操作 -->
<header class="topbar" class:connected={controller.connected}>
  <div class="topbar-brand">
    <span class="mark" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2.5" y="6" width="19" height="12.5" rx="2.5" />
        <path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 12.75h.01M9.5 12.75h.01M13 12.75h.01M16.5 12.75h.01M7.5 16h9" />
      </svg>
    </span>
    <span class="topbar-title">MonsGeek Web Driver</span>
    <span class="conn-dot" class:on={controller.connected} class:err={alertStatus}></span>
    <span class="topbar-status num" class:alert={alertStatus} title={controller.status}>
      {statusText}{controller.connected && (controller.busy || controller.connectionChecking) ? ' · 处理中…' : ''}
    </span>
  </div>

  {#if controller.connected}
    <div class="layer-switch header-layer-switch" role="group" aria-label="选择编辑层">
      <button class:active={controller.layer === 'base'} aria-pressed={controller.layer === 'base'}
        disabled={controller.busy} onclick={() => void controller.selectLayer('base')}>单按</button>
      <button class:active={controller.layer === 'fn'} aria-pressed={controller.layer === 'fn'}
        disabled={controller.busy} onclick={() => void controller.selectLayer('fn')}>Fn 组合</button>
    </div>
  {/if}

  {#if controller.connected}
    <div class="topbar-actions">
      <TopMenus />
      <button disabled={controller.busy} onclick={() => void controller.refresh()}>刷新</button>
      <ActionsMenu />
    </div>
  {/if}
</header>

{#if controller.selftestVisible}
  <pre id="selftest">{controller.selftestLines.join('\n')}</pre>
{/if}

<!-- 键盘：唯一视觉主体（无边框） -->
<KeyboardLayout />

<div class="kb-under caption">
  {#if controller.connected}
    {controller.layer === 'fn' ? '点击按键设置 Fn 组合，点击旋钮设置旋钮动作' : '点击按键或旋钮改键'}<span class="sep">|</span>
    <i class="dot" style="background:var(--accent)"></i>已选
    {#if controller.layer === 'base'}<i class="dot amber" style="background:var(--amber)"></i>已改键{/if}
  {:else}
    需要 Chrome / Edge 浏览器；2.4G 模式暂不支持。
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
