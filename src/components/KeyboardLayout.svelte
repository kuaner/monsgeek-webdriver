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
      <span class="glyph">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2.5" y="6" width="19" height="12.5" rx="2.5" />
          <path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 12.75h.01M9.5 12.75h.01M13 12.75h.01M16.5 12.75h.01M7.5 16h9" />
        </svg>
      </span>
      <h2>连接你的 M1W</h2>
      <p>通过 USB 数据线连接键盘后授权访问</p>
      <div class="steps">
        <span class="step"><b>1</b> 插入 USB 数据线</span>
        <span class="arrow">→</span>
        <span class="step"><b>2</b> 键盘切到有线模式</span>
        <span class="arrow">→</span>
        <span class="step"><b>3</b> 点击下方连接</span>
      </div>
      <button class="primary" onclick={() => void controller.connectByPicker()}>
        连接键盘
      </button>
      <p class="note caption">需要 Chrome / Edge 浏览器；蓝牙或 2.4G 模式下无法通信。</p>
    </div>
  </div>
{/if}
