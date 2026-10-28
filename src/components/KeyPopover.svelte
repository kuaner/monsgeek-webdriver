<script lang="ts">
  import { controller, definition, MAPPING_MODES, PLAYBACKS, keyDisplayName } from '../lib/state/controller.svelte'
  import { chooser } from '../lib/state/chooser.svelte'
  import { KEY_GROUPS, keyChoiceItems, keyGroup, usageChoices } from '../lib/state/actions'
  import { recordsEqual, usageName } from '../lib/protocol/core'

  const enabled = $derived(controller.canConfigure && controller.matrix !== null)
  const isModified = $derived(
    !!controller.selectedKey && !!controller.currentRecord &&
    !recordsEqual(controller.currentRecord, controller.selectedKey.record))
  let position = $state({ top: 0, left: 0, ready: false })
  let keyTab = $state('字母')

  const keyItems = $derived(keyChoiceItems(controller.choices))
  const tabItems = $derived(keyItems.filter((item) => item.group === keyTab))

  // 打开/换键时，页签落到当前所选按键所在的组。
  $effect(() => {
    if (!controller.remapOpen) return
    const action = controller.choices.find((a) => a.id === controller.selectedAction)
    if (action && controller.mappingMode === 'key' && action.record[0] === 0 &&
        action.record[1] === 0 && action.record[3] === 0) {
      keyTab = keyGroup(action.record[2] ?? 0)
    }
  })

  function reposition() {
    if (!controller.remapOpen) return
    const key = document.querySelector<HTMLElement>('.kb-key.selected')
      ?? document.querySelector<HTMLElement>('.knob-chip.selected')
    if (!key) return
    const rect = key.getBoundingClientRect()
    const width = 396
    // 优先放在按键右侧并垂直居中；空间不足放左侧；再不行放下方。
    let left = rect.right + 12
    if (left + width > window.innerWidth - 10) left = rect.left - width - 12
    if (left < 10) left = Math.max(10, Math.min(rect.left, window.innerWidth - width - 10))
    let top = rect.top + rect.height / 2 - 130
    top = Math.max(10, Math.min(top, window.innerHeight - 460))
    position = { top, left, ready: true }
  }

  $effect(() => {
    controller.selectedKeyIndex
    controller.remapOpen
    reposition()
  })

  function onGlobalPointerDown(event: PointerEvent) {
    if (!controller.remapOpen) return
    const target = event.target as HTMLElement
    // 点其他键/旋钮 = 切换目标；点 popover 内部 = 编辑；其余一律关闭。
    if (target.closest('.kb-key, .knob-chip, .key-popover, #chooser')) return
    controller.closeRemap()
  }
</script>

<svelte:window onresize={() => reposition()} onpointerdown={onGlobalPointerDown} onkeydown={(e) => e.key === 'Escape' && controller.closeRemap()} />

{#if controller.remapOpen && position.ready}
  <div class="key-popover" style={`top:${position.top}px;left:${position.left}px`} role="dialog" aria-label="改键">
    <header class="kp-head">
      {#if isModified}
        <div class="kp-map">
          <b>{controller.selectedKey ? keyDisplayName(controller.selectedKey) : '—'}</b>
          <svg class="kp-arrow" width="26" height="14" viewBox="0 0 26 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2 7h20m0 0-5-5m5 5-5 5" />
          </svg>
          <b class="kp-map-target" title={controller.currentMapping}>{controller.currentMapping}</b>
        </div>
      {:else}
        <b class="kp-plain">{controller.selectedKey ? keyDisplayName(controller.selectedKey) : '—'}</b>
      {/if}
      <button class="ghost kp-close" onclick={() => controller.closeRemap()} aria-label="关闭改键">关闭</button>
    </header>

    <div class="seg kp-seg">
      {#each MAPPING_MODES as mode (mode.id)}
        <button
          class:active={controller.mappingMode === mode.id}
          onclick={() => controller.chooseMode(mode.id)}
        >{mode.label}</button>
      {/each}
    </div>

    <div class="kp-body">
      {#if controller.mappingMode === 'key'}
        <div class="kp-subtabs">
          {#each KEY_GROUPS as group (group)}
            <button class:active={keyTab === group} onclick={() => (keyTab = group)}>{group}</button>
          {/each}
        </div>
        <div class="key-grid">
          {#each tabItems as item (item.id)}
            <button
              class="key-chip"
              class:selected={controller.selectedAction === item.id}
              disabled={!enabled}
              onclick={() => (controller.selectedAction = item.id)}
            >{item.label}</button>
          {/each}
          {#if tabItems.length === 0}
            <span class="caption">该组没有可选项</span>
          {/if}
        </div>
      {:else if controller.mappingMode === 'function'}
        {@const current = controller.choices.find((a) => a.id === controller.selectedAction)}
        <button
          class="chooser-button"
          disabled={!enabled}
          onclick={(e) => chooser.open(
            e.currentTarget,
            controller.choices.map((a) => ({
              id: a.id,
              label: a.category !== '其他' ? `${a.category} · ${a.name}` : a.name,
            })),
            controller.selectedAction,
            (id) => (controller.selectedAction = id),
          )}
        >
          <span>{current ? current.name : '选择功能…'}</span>
        </button>
      {:else if controller.mappingMode === 'chord'}
        <div class="mod-row" style="margin-bottom:10px">
          {#each [[227, '⌘'], [224, '⌃'], [226, '⌥'], [225, '⇧']] as [usage, label] (usage)}
            <label>
              <input
                type="checkbox"
                checked={controller.chordModifiers.includes(usage)}
                disabled={!enabled}
                onchange={(e) => controller.toggleChordModifier(usage, e.currentTarget.checked)}
              />{label}
            </label>
          {/each}
          <span class="spacer"></span>
          <button
            class="chooser-button"
            style="width:118px"
            disabled={!enabled}
            onclick={(e) => chooser.open(e.currentTarget, usageChoices(false), String(controller.chordKey), (id) => (controller.chordKey = Number(id)))}
          >
            <span>{usageName(controller.chordKey, definition)}</span>
          </button>
        </div>
        <div class="row">
          <span class="caption">附加按键</span>
          <button
            class="chooser-button"
            style="width:118px"
            disabled={!enabled}
            onclick={(e) => chooser.open(e.currentTarget, usageChoices(true), String(controller.chordSecondary), (id) => (controller.chordSecondary = Number(id)))}
          >
            <span>{controller.chordSecondary === 0 ? '无' : usageName(controller.chordSecondary, definition)}</span>
          </button>
        </div>
      {:else}
        <div class="row">
          <span class="caption">
            {controller.macroLoading
              ? '正在读取键盘中的宏…'
              : `${controller.macro.events.length} 个事件 · ${PLAYBACKS.find((p) => p.rawValue === controller.playback)?.label ?? ''}`}
          </span>
          <span class="spacer"></span>
          <button disabled={!enabled || controller.macroLoading} onclick={() => (controller.macroSheetOpen = true)}>
            编辑宏…
          </button>
        </div>
      {/if}
    </div>

    <footer class="kp-foot">
      <button class="ghost" disabled={!enabled} onclick={() => void controller.applyKey(true)}>恢复该键</button>
      <span class="spacer"></span>
      <button
        class="primary"
        disabled={!enabled || (controller.mappingMode === 'macro' && controller.macroLoading)}
        onclick={() => void controller.applyKey(false)}
      >
        应用改键
      </button>
    </footer>
  </div>
{/if}
