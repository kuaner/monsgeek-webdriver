<script lang="ts">
  import { controller, definition, isKnobKey, keyDisplayName, recordLabel, EFFECTS } from '../lib/state/controller.svelte'
  import { chooser } from '../lib/state/chooser.svelte'
  import { infoLight } from '../lib/protocol/core'

  const lightEnabled = $derived(controller.canConfigure)
  const light = $derived(controller.info ? infoLight(controller.info) : null)
  const knobKeys = $derived(definition.keys.filter((k) => isKnobKey(k)))

  let lightAnchor: HTMLElement
  let knobAnchor: HTMLElement
  let lightPos = $state({ top: 0, left: 0 })
  let knobPos = $state({ top: 0, left: 0 })

  function toggleLight() {
    controller.knobPanelOpen = false
    controller.lightPanelOpen = !controller.lightPanelOpen
    if (controller.lightPanelOpen) place(lightAnchor, (p) => (lightPos = p))
  }

  function toggleKnob() {
    controller.lightPanelOpen = false
    controller.knobPanelOpen = !controller.knobPanelOpen
    if (controller.knobPanelOpen) place(knobAnchor, (p) => (knobPos = p))
  }

  function place(anchor: HTMLElement, set: (p: { top: number; left: number }) => void) {
    const rect = anchor.getBoundingClientRect()
    set({ top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 316) })
  }

  function onGlobalPointerDown(event: PointerEvent) {
    const target = event.target as Node
    if (controller.lightPanelOpen && !inPanel(target, '#light-menu', lightAnchor)) {
      controller.lightPanelOpen = false
    }
    if (controller.knobPanelOpen && !inPanel(target, '#knob-menu', knobAnchor)) {
      controller.knobPanelOpen = false
    }
  }

  function inPanel(target: Node, selector: string, anchor: HTMLElement): boolean {
    const panel = document.querySelector(selector)
    return (panel && panel.contains(target)) || anchor.contains(target)
  }
</script>

<svelte:window onpointerdown={onGlobalPointerDown} onresize={() => {
  if (controller.lightPanelOpen) place(lightAnchor, (p) => (lightPos = p))
  if (controller.knobPanelOpen) place(knobAnchor, (p) => (knobPos = p))
}} />

<div class="topmenus">
  <button
    class:menu-on={controller.lightPanelOpen}
    bind:this={lightAnchor}
    onclick={toggleLight}
  >
    灯效
    {#if controller.lightDirty}<span class="dirty-dot" title="有未应用的修改"></span>{/if}
    <svg class="caret" class:open={controller.lightPanelOpen} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
  </button>

  <button
    class:menu-on={controller.knobPanelOpen}
    bind:this={knobAnchor}
    onclick={toggleKnob}
  >
    旋钮
    <svg class="caret" class:open={controller.knobPanelOpen} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
  </button>
</div>

{#if controller.lightPanelOpen}
  <div id="light-menu" class="menu-pop" style={`top:${lightPos.top}px;left:${lightPos.left}px`}>
    <div class="row">
      <label class="switch">
        <input
          type="checkbox"
          checked={controller.lightsEnabledNow}
          disabled={!lightEnabled}
          onchange={(e) => void controller.toggleLights(e.currentTarget.checked)}
        /><i></i>
      </label>
      <span>灯光开关</span>
      <span class="spacer"></span>
      <span class="caption">{controller.lightDirty ? '编辑中' : '已同步'}</span>
    </div>
    <div class="row" style="margin-top:12px">
      <span class="label">效果</span>
      <select
        class="grow"
        disabled={!lightEnabled}
        value={String(controller.lightMode)}
        onchange={(e) => { controller.lightMode = Number(e.currentTarget.value); controller.markLightDirty() }}
      >
        {#each EFFECTS as [value, name] (value)}
          <option value={String(value)}>{name}</option>
        {/each}
      </select>
    </div>
    <div class="row">
      <span class="label">亮度</span>
      <input
        type="range" min="0" max="4" step="1"
        disabled={!lightEnabled}
        value={String(controller.lightBrightness)}
        oninput={(e) => { controller.lightBrightness = Number(e.currentTarget.value); controller.markLightDirty() }}
      />
      <span class="caption num" style="width:14px;text-align:center">{controller.lightBrightness}</span>
    </div>
    <div class="row">
      <span class="label">速度</span>
      <input
        type="range" min="0" max="4" step="1"
        disabled={!lightEnabled}
        value={String(controller.lightSpeed)}
        oninput={(e) => { controller.lightSpeed = Number(e.currentTarget.value); controller.markLightDirty() }}
      />
      <span class="caption num" style="width:14px;text-align:center">{controller.lightSpeed}</span>
    </div>
    <div class="row">
      <label class="switch">
        <input
          type="checkbox"
          checked={controller.lightRainbow}
          disabled={!lightEnabled}
          onchange={(e) => { controller.lightRainbow = e.currentTarget.checked; controller.markLightDirty() }}
        /><i></i>
      </label>
      <span>彩虹</span>
      <span class="spacer"></span>
      <input
        type="color"
        disabled={!lightEnabled || controller.lightRainbow}
        value={`#${controller.lightRgb}`}
        oninput={(e) => { controller.lightRgb = e.currentTarget.value.slice(1); controller.markLightDirty() }}
      />
      <input
        type="text" maxlength="6" placeholder="RRGGBB" class="num"
        style="width:78px;font-family:ui-monospace,monospace"
        disabled={!lightEnabled || controller.lightRainbow}
        value={controller.lightRgb}
        onchange={(e) => {
          const value = e.currentTarget.value.trim().toLowerCase()
          if (/^[0-9a-f]{6}$/.test(value)) {
            controller.lightRgb = value
            controller.markLightDirty()
          } else {
            e.currentTarget.value = controller.lightRgb
          }
        }}
      />
    </div>
    <button
      class="primary"
      style="width:100%;margin-top:12px"
      disabled={!lightEnabled}
      onclick={() => void controller.applyLight()}
    >
      {controller.lightsEnabledNow ? '应用灯效' : '应用并开启'}
    </button>
  </div>
{/if}

{#if controller.knobPanelOpen}
  <div id="knob-menu" class="menu-pop" style={`top:${knobPos.top}px;left:${knobPos.left}px`}>
    <div class="knob-stack">
      {#each knobKeys as key (key.index)}
        {@const record = controller.matrix
          ? controller.matrix.slice(key.index * 4, key.index * 4 + 4)
          : null}
        <button
          class="knob-chip"
          class:selected={controller.selectedKeyIndex === key.index}
          disabled={!controller.connected}
          onclick={() => controller.selectKey(key.index, true)}
        >
          {keyDisplayName(key)}
          <span class="cap">{record ? recordLabel(record, definition) : '未读取'}</span>
        </button>
      {/each}
    </div>
    <div class="foot-note" style="margin-top:10px">点击旋钮动作可改键。</div>
  </div>
{/if}
