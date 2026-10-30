<script lang="ts">
  import artwork from '../lib/assets/m1w-keyboard.png'
  import { controller, definition, isKnobKey, keyDisplayName, recordLabel } from '../lib/state/controller.svelte'
  import { recordsEqual } from '../lib/protocol/core'

  let wrapWidth = $state(0)
  let viewportHeight = $state(window.innerHeight)
  // 键盘是唯一主体：在可用宽度和高度内尽可能大。
  const scale = $derived(Math.min((wrapWidth - 12) / 638, (viewportHeight - 205) / 288))
  const connected = $derived(controller.connected)
</script>

<svelte:window onresize={() => (viewportHeight = window.innerHeight)} />

{#if connected}
  <div class="kb-scroll" bind:clientWidth={wrapWidth}>
    {#if scale > 0.1}
      <div class="kb" style={`width:${638 * scale}px;height:${288 * scale}px`}>
        <img
          src={artwork}
          alt="M1W"
          style={`width:${638 * scale}px;height:${288 * scale}px;object-position:${-116 * scale}px 0`}
        />
        {#each definition.keys as key (key.index)}
          {@const knob = isKnobKey(key)}
          {@const extra = knob ? 1 : 10}
          {@const keyMatrix = knob ? controller.matrix : controller.activeMatrix}
          {@const record = keyMatrix
            ? keyMatrix.slice(key.index * 4, key.index * 4 + 4)
            : null}
          {@const modified = controller.layer === 'base' && record !== null && !recordsEqual(record, key.record)}
          {@const label = record ? (controller.layer === 'fn' && !knob && record.every((b) => b === 0) ? '未设置' : recordLabel(record, definition)) : '未读取'}
          <button
            class="kb-key"
            class:selected={controller.selectedKeyIndex === key.index}
            class:modified={modified}
            style={`left:${(key.x - 116 - extra / 2) * scale}px;top:${(-key.y - 2) * scale}px;width:${(key.width + extra) * scale}px;height:${(key.height + 4) * scale}px`}
            title={`${controller.layer === 'fn' && !knob ? 'Fn + ' : ''}${keyDisplayName(key)} → ${label}`}
            disabled={controller.busy}
            onclick={() => controller.selectKey(key.index, true)}
          >
            {#if modified && !knob}
              <span class="tag">{label}</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{:else}
  <div class="stage-empty">
    <div class="empty">
      <h2>选择键盘连接方式</h2>
      <div class="connection-choices" role="group" aria-label="选择键盘连接方式">
        <button class="connection-card" disabled={controller.busy || controller.connectionChecking}
          onclick={() => void controller.connectWithMode('usb')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 21V3m0 0L9 6m3-3 3 3M12 11H7V8m5 8h5v-3" />
            <circle cx="7" cy="7" r="1" /><rect x="16" y="11" width="2" height="2" /><circle cx="12" cy="21" r="1" />
          </svg>
          <span>有线 USB</span>
        </button>
        <button class="connection-card" disabled={controller.busy || controller.connectionChecking}
          onclick={() => void controller.connectWithMode('bluetooth')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M7 7l10 10-5 4V3l5 4L7 17" />
          </svg>
          <span>蓝牙</span>
        </button>
      </div>
    </div>
  </div>
{/if}
