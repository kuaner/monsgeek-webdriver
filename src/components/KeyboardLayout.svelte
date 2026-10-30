<script lang="ts">
  import KeyboardArtwork from './KeyboardArtwork.svelte'
  import { controller, definition, isKnobKey, keyDisplayName, recordLabel } from '../lib/state/controller.svelte'
  import { recordsEqual } from '../lib/protocol/core'
  import { keyBounds, knobBounds, KEYBOARD_HEIGHT, KEYBOARD_WIDTH } from '../lib/keyboard/geometry'

  let wrapWidth = $state(0)
  let viewportHeight = $state(window.innerHeight)
  let hoveredIndex = $state(-1)
  // 键盘是唯一主体：在可用宽度和高度内尽可能大。
  const scale = $derived(Math.min((wrapWidth - 12) / KEYBOARD_WIDTH, (viewportHeight - 205) / KEYBOARD_HEIGHT))
  const connected = $derived(controller.connected)
</script>

<svelte:window onresize={() => (viewportHeight = window.innerHeight)} />

{#if connected}
  <div class="kb-scroll" bind:clientWidth={wrapWidth}>
    {#if scale > 0.1}
      <div class="kb" style={`width:${KEYBOARD_WIDTH * scale}px;height:${KEYBOARD_HEIGHT * scale}px`}>
        <KeyboardArtwork {definition} matrix={controller.matrix} layer={controller.layer} mac={controller.macMode}
          selectedIndex={controller.selectedKeyIndex} {hoveredIndex} />
        {#each definition.keys as key (key.index)}
          {@const knob = isKnobKey(key)}
          {@const bounds = knob ? knobBounds(key) : keyBounds(key, controller.macMode, definition.keys)}
          {@const keyMatrix = knob ? controller.matrix : controller.activeMatrix}
          {@const record = keyMatrix
            ? keyMatrix.slice(key.index * 4, key.index * 4 + 4)
            : null}
          {@const modified = controller.layer === 'base' && record !== null && !recordsEqual(record, key.record)}
          {@const label = record ? (controller.layer === 'fn' && !knob && record.every((b) => b === 0) ? '未设置' : recordLabel(record, definition)) : '未读取'}
          <button
            class="kb-key"
            class:kb-knob={knob}
            class:selected={controller.selectedKeyIndex === key.index}
            class:modified={modified}
            style={`left:${bounds.x * scale}px;top:${bounds.y * scale}px;width:${bounds.width * scale}px;height:${bounds.height * scale}px`}
            title={`${controller.layer === 'fn' && !knob ? 'Fn + ' : ''}${keyDisplayName(key)} → ${label}`}
            disabled={controller.busy}
            onpointerenter={() => (hoveredIndex = key.index)}
            onpointerleave={() => { if (hoveredIndex === key.index) hoveredIndex = -1 }}
            onfocus={() => (hoveredIndex = key.index)}
            onblur={() => { if (hoveredIndex === key.index) hoveredIndex = -1 }}
            onclick={() => controller.selectKey(key.index, true)}
          ></button>
          {#if knob && hoveredIndex === key.index}
            <span class="knob-tooltip" style={`left:${601 * scale}px;top:${(41 - 24) * scale}px`}>
              {key.index === 6 ? '逆时针' : key.index === 95 ? '顺时针' : '按下'}
            </span>
          {/if}
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
          <svg class="connection-art" viewBox="0 0 200 100" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="usb-plug" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#555760"/><stop offset="1" stop-color="#25262b"/></linearGradient>
            </defs>
            <path d="M29 70c18 0 13-31 33-31h40" stroke="#686b75" stroke-width="3" stroke-linecap="round"/>
            <rect x="102" y="29" width="62" height="24" rx="6" fill="url(#usb-plug)" stroke="#747680"/>
            <rect x="156" y="33" width="25" height="16" rx="2" fill="#a4a6ad"/>
            <rect x="161" y="36" width="15" height="10" rx="1" fill="#33343a"/>
            <path d="M110 36h33m-33 5h21" stroke="#858790" stroke-linecap="round"/>
            <circle cx="30" cy="70" r="4" stroke="#777983"/>
          </svg>
          <span>有线 USB</span>
          <small>稳定、低延迟</small>
        </button>
        <button class="connection-card" disabled={controller.busy || controller.connectionChecking}
          onclick={() => void controller.connectWithMode('bluetooth')}>
          <svg class="connection-art" viewBox="0 0 200 100" fill="none" aria-hidden="true">
            <path d="M86 30l29 20-15 10V20l15 10-29 20m14-20v40" stroke="#a6a9b3" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M48 32a29 29 0 0 0 0 36m104-36a29 29 0 0 1 0 36M57 40a17 17 0 0 0 0 20m86-20a17 17 0 0 1 0 20" stroke="#62656f" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <span>蓝牙</span>
          <small>无线连接</small>
        </button>
        <button class="connection-card" disabled={controller.busy || controller.connectionChecking}
          onclick={() => void controller.connectWithMode('dongle')}>
          <svg class="connection-art" viewBox="0 0 200 100" fill="none" aria-hidden="true">
            <path d="M79 70l-5 14h52l-5-14" stroke="#555760" stroke-width="2"/>
            <rect x="69" y="21" width="62" height="51" rx="7" fill="#25262b" stroke="#555760"/>
            <rect x="75" y="27" width="50" height="39" rx="3" fill="#1b1c20" stroke="#3d3f46"/>
            <path d="M89 46h22m-11-9v18" stroke="#666973" stroke-width="2" stroke-linecap="round"/>
            <path d="M53 34a25 25 0 0 0 0 30m94-30a25 25 0 0 1 0 30M60 41a14 14 0 0 0 0 16m80-16a14 14 0 0 1 0 16" stroke="#50525b" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <span>2.4G</span>
          <small>接收器连接</small>
        </button>
      </div>
    </div>
  </div>
{/if}
