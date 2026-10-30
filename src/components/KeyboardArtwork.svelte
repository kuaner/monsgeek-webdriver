<script lang="ts">
  import type { DeviceDefinition } from '../lib/protocol/types'
  import { isKnobKey, recordsEqual } from '../lib/protocol/core'
  import { keycapLegend, mappedKeycapLegend } from '../lib/keyboard/legends'
  import { keyBounds, knobSector } from '../lib/keyboard/geometry'

  let { definition, matrix, layer, selectedIndex, hoveredIndex, mac }: {
    definition: DeviceDefinition; matrix: number[] | null; layer: 'base' | 'fn'; selectedIndex: number; hoveredIndex: number; mac: boolean
  } = $props()

  function legend(name: string): string {
    return keycapLegend(name, mac)
  }

  function legendSize(name: string, text: string, width: number): number {
    const maximum = name === 'BackSpace' || ['↑', '↓', '←', '→'].includes(name) ? 8.6 : text.length > 4 ? 6.1 : 7.4
    const units = Array.from(text).reduce((total, character) => total + (/[\u2e80-\u9fff]/.test(character) ? 1 : 0.65), 0)
    return units ? Math.min(maximum, (width - 11) / units) : maximum
  }
</script>

<svg class="keyboard-art" viewBox="0 0 638 288" aria-hidden="true">
  <defs>
    <linearGradient id="keyboard-case" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#414247" />
      <stop offset="0.28" stop-color="#303136" />
      <stop offset="1" stop-color="#202125" />
    </linearGradient>
    <linearGradient id="keyboard-deck" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#292a2e" />
      <stop offset="1" stop-color="#191a1d" />
    </linearGradient>
    <linearGradient id="key-face" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#48494e" />
      <stop offset="0.08" stop-color="#3e3f44" />
      <stop offset="0.5" stop-color="#38393e" />
      <stop offset="0.78" stop-color="#323338" />
      <stop offset="0.9" stop-color="#25262a" />
      <stop offset="1" stop-color="#151619" />
    </linearGradient>
    <linearGradient id="key-face-modified" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#625849" />
      <stop offset="0.2" stop-color="#50483e" />
      <stop offset="1" stop-color="#302c28" />
    </linearGradient>
    <linearGradient id="key-face-selected" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#73757a" />
      <stop offset="0.2" stop-color="#5b5d62" />
      <stop offset="1" stop-color="#3b3d42" />
    </linearGradient>
    <linearGradient id="key-legend" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d0d1d3" />
      <stop offset="1" stop-color="#aeb0b3" />
    </linearGradient>
    <linearGradient id="knob-face" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#434448" />
      <stop offset="0.5" stop-color="#2c2d31" />
      <stop offset="1" stop-color="#1b1c1f" />
    </linearGradient>
  </defs>

  <rect x="0.5" y="0.5" width="637" height="287" rx="14" fill="url(#keyboard-case)" />
  <rect x="5" y="5" width="628" height="278" rx="10" fill="url(#keyboard-deck)" stroke="#17181b" />

  {#each definition.keys as key (key.index)}
    {#if !isKnobKey(key)}
      {@const bounds = keyBounds(key, mac, definition.keys)}
      {@const { x, y, width, height } = bounds}
      {@const record = matrix?.slice(key.index * 4, key.index * 4 + 4) ?? null}
      {@const remapped = record !== null && !recordsEqual(record, key.record)}
      {@const display = remapped && record ? mappedKeycapLegend(record, definition, mac) : legend(key.name)}
      <g class="keycap" class:modified={layer === 'base' && remapped} class:selected={selectedIndex === key.index}
        class:hovered={hoveredIndex === key.index} transform={`translate(${x} ${y})`}>
        <defs>
          <linearGradient id={`key-shade-${key.index}`} x1="0" y1="0" x2={width} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#08090b" stop-opacity="0.88" />
            <stop offset={2 / width} stop-color="#08090b" stop-opacity="0.52" />
            <stop offset={5 / width} stop-color="#08090b" stop-opacity="0" />
            <stop offset={1 - 5 / width} stop-color="#08090b" stop-opacity="0" />
            <stop offset={1 - 2 / width} stop-color="#08090b" stop-opacity="0.52" />
            <stop offset="1" stop-color="#08090b" stop-opacity="0.88" />
          </linearGradient>
        </defs>
        <!-- 单一连续轮廓；明暗渐变形成顶面、斜肩与厚侧壁。 -->
        <rect x="0.4" y="3" width={width - 0.8} height={height - 3.4} rx="4" fill="#0b0c0e" />
        <path class="key-face" d={`M4 0.8H${width - 4}Q${width - 0.8} 0.8 ${width - 0.8} 4V${height - 5}Q${width - 0.8} ${height - 1.6} ${width - 4} ${height - 1.6}H4Q0.8 ${height - 1.6} 0.8 ${height - 5}V4Q0.8 0.8 4 0.8Z`} fill="url(#key-face)" />
        <path d={`M4 0.8H${width - 4}Q${width - 0.8} 0.8 ${width - 0.8} 4V${height - 5}Q${width - 0.8} ${height - 1.6} ${width - 4} ${height - 1.6}H4Q0.8 ${height - 1.6} 0.8 ${height - 5}V4Q0.8 0.8 4 0.8Z`} fill={`url(#key-shade-${key.index})`} />
        {#if key.name === '(space)' && !remapped}
          <path d={`M${width / 2 - 9} 11.5h18`} stroke="#131416" stroke-opacity="0.65" stroke-width="1.2" stroke-linecap="round" />
          <path d={`M${width / 2 - 9} 11.1h18`} stroke="#bfc1c3" stroke-width="1.1" stroke-linecap="round" />
        {:else}
          <g text-anchor="middle" dominant-baseline="middle" font-family="ui-sans-serif, system-ui, sans-serif"
            font-weight="500" font-size={legendSize(key.name, display, width)}>
            <text x={width / 2} y="11.3" fill="#151619" fill-opacity="0.6">{display}</text>
            <text x={width / 2} y="11" fill="url(#key-legend)">{display}</text>
          </g>
        {/if}
        {#if key.name === 'F' || key.name === 'J'}
          <path d={`M${width / 2 - 3} ${height - 10.5}h6`} stroke="#bcbcc0" stroke-opacity="0.42" stroke-width="0.9" stroke-linecap="round" />
        {/if}
      </g>
    {/if}
  {/each}

  <circle cx="601" cy="42" r="20.5" fill="#0a0b0d" />
  <circle class="knob-face" cx="601" cy="41" r="18.3" fill="url(#knob-face)" />
  {#each [6, 94, 95] as index (index)}
    {#if selectedIndex === index || hoveredIndex === index}
      <path class="knob-sector" class:selected={selectedIndex === index} d={knobSector(index)} />
    {/if}
  {/each}
  <g class="knob-guides" text-anchor="middle" dominant-baseline="middle" aria-hidden="true">
    <text x="588.5" y="41">↶</text>
    <circle cx="601" cy="41" r="1.6" />
    <text x="613.5" y="41">↷</text>
  </g>
</svg>
