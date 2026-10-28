<script lang="ts">
  import { untrack } from 'svelte'
  import { controller, definition, PLAYBACKS, keyDisplayName } from '../lib/state/controller.svelte'
  import { chooser } from '../lib/state/chooser.svelte'
  import { usageChoices } from '../lib/state/actions'
  import { macroEncoded, usageName } from '../lib/protocol/core'
  import { MacroRecorder } from '../lib/state/macro-recording'
  import type { KeyboardMacro } from '../lib/protocol/types'

  let draft: KeyboardMacro = $state({ repeatCount: 1, events: [] })
  let playback = $state(0)
  let recording = $state(false)
  let notice = $state('')
  let recorder: MacroRecorder | null = null

  const validationError = $derived.by(() => {
    if (draft.events.length === 0) return ''
    try { macroEncoded(draft); return '' }
    catch (error) { return error instanceof Error ? error.message : String(error) }
  })

  $effect(() => {
    if (!controller.macroSheetOpen) return
    const current = untrack(() => controller.macro)
    draft = { repeatCount: current.repeatCount, events: current.events.map((event) => ({ ...event })) }
    playback = untrack(() => controller.playback)
    recorder = null
    recording = false
    notice = ''
  })

  function startRecording() {
    recorder = new MacroRecorder()
    draft.events = []
    notice = '录制中：在此页面按下需要执行的按键，然后点击停止。'
    recording = true
  }

  function stopRecording(lostFocus = false) {
    if (!recording || !recorder) return
    const completedHeldKeys = recorder.stop(performance.now())
    draft.events = recorder.events
    recording = false
    recorder = null
    notice = lostFocus ? '页面失去焦点，录制已停止。' : '录制完成，可以调整步骤和延时。'
    if (completedHeldKeys) notice += ' 已补齐仍按住的按键的松开事件。'
  }

  function capture(event: KeyboardEvent, down: boolean) {
    if (!recording || !recorder) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const result = recorder.capture(event.code, down, performance.now(), event.repeat)
    if (result === 'unsupported') notice = '这个按键未能记录，请尝试其他按键。'
    else if (result === 'full') notice = '已达到当前宏容量，请松开按键后停止录制。'
    else if (result === 'delay-clamped') notice = '单次间隔超过 65535 毫秒，已按上限记录。'
    else if (result === 'recorded') notice = '录制中：完成后点击停止。'
    draft.events = recorder.events
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= draft.events.length) return
    const [item] = draft.events.splice(index, 1)
    draft.events.splice(target, 0, item!)
  }

  function cancel() {
    recording = false
    recorder = null
    controller.macroSheetOpen = false
  }

  function useMacro() {
    try { macroEncoded(draft) }
    catch (error) { notice = error instanceof Error ? error.message : String(error); return }
    controller.macro = { repeatCount: draft.repeatCount, events: draft.events.map((event) => ({ ...event })) }
    controller.playback = playback
    controller.macroSheetOpen = false
  }
</script>

<svelte:window onkeydown={(event) => capture(event, true)} onkeyup={(event) => capture(event, false)}
  onblur={() => stopRecording(true)} />

{#if controller.macroSheetOpen}
  <div class="overlay">
    <div class="sheet wide macro-sheet" role="dialog" aria-modal="true" aria-labelledby="macro-title">
      <h2 id="macro-title">录制 Fn + {controller.selectedKey ? keyDisplayName(controller.selectedKey) : '按键'} 的宏</h2>
      <p>宏会按顺序执行一串按键，例如按一次 Fn 组合，执行 Command + C。单独按键的作用不变。</p>

      <div class="macro-record-row">
        {#if recording}
          <button class="primary" onclick={() => stopRecording()}>停止录制</button>
        {:else}
          <button class="primary" onclick={startRecording}>{draft.events.length ? '重新录制' : '开始录制'}</button>
          {#if draft.events.length}<button onclick={() => { draft.events = []; notice = '' }}>清空步骤</button>{/if}
        {/if}
        <span class:live={recording} class="macro-record-status" role="status">
          {notice || '录制时请保持此页面处于前台。'}
        </span>
      </div>

      <div class="row">
        <label for="macro-playback">执行方式</label>
        <select id="macro-playback" disabled={recording} value={String(playback)}
          onchange={(event) => (playback = Number(event.currentTarget.value))}>
          {#each PLAYBACKS as item (item.rawValue)}
            <option value={String(item.rawValue)}>{item.label}</option>
          {/each}
        </select>
        {#if playback === 0}
          <label for="macro-repeat">次数</label>
          <input id="macro-repeat" type="number" min="1" max="65535" style="width:72px" disabled={recording}
            value={String(draft.repeatCount)} onchange={(event) => {
              draft.repeatCount = Math.max(1, Math.min(65535, Number(event.currentTarget.value) || 1))
              event.currentTarget.value = String(draft.repeatCount)
            }} />
        {/if}
        <span class="spacer"></span>
        <span class="caption">{draft.events.length} / 62 个事件</span>
      </div>

      <div class="macro-list">
        {#if draft.events.length === 0}
          <div class="macro-empty">录制后，按下、松开和间隔会显示在这里。</div>
        {/if}
        {#each draft.events as event, index}
          <div class="macro-event">
            <select class="act" aria-label={`第 ${index + 1} 步动作`} disabled={recording}
              value={event.down ? 'down' : 'up'} onchange={(e) => (event.down = e.currentTarget.value === 'down')}>
              <option value="down">按下</option><option value="up">松开</option>
            </select>
            <button class="chooser-button usage-chooser" disabled={recording}
              aria-label={`第 ${index + 1} 步按键`}
              onclick={(e) => chooser.open(e.currentTarget, usageChoices(false), String(event.usage), (id) => (event.usage = Number(id)))}>
              <span>{usageName(event.usage, definition)}</span>
            </button>
            <label class="caption" for={`delay-${index}`}>之后等待</label>
            <input id={`delay-${index}`} class="delay" type="number" min="0" max="65535" disabled={recording}
              value={String(event.delay)} onchange={(e) => {
                event.delay = Math.max(0, Math.min(65535, Number(e.currentTarget.value) || 0))
                e.currentTarget.value = String(event.delay)
              }} />
            <span class="caption">ms</span>
            <button class="mini" disabled={recording || index === 0} aria-label={`上移第 ${index + 1} 步`} onclick={() => move(index, -1)}>↑</button>
            <button class="mini" disabled={recording || index === draft.events.length - 1} aria-label={`下移第 ${index + 1} 步`} onclick={() => move(index, 1)}>↓</button>
            <button class="mini" disabled={recording} onclick={() => draft.events.splice(index, 1)}>删除</button>
          </div>
        {/each}
      </div>
      {#if validationError}<div class="macro-invalid" role="alert">{validationError}</div>{/if}

      <div class="row">
        <button disabled={recording || draft.events.length > 60} onclick={() => draft.events.push(
          { usage: 4, down: true, delay: 30 }, { usage: 4, down: false, delay: 50 })}>添加一次按键</button>
        <span class="caption">录制不会立即写入键盘。</span>
      </div>
      <div class="footer">
        <button onclick={cancel}>取消</button>
        <button class="primary" disabled={recording || draft.events.length === 0 || !!validationError} onclick={useMacro}>使用这段宏</button>
      </div>
    </div>
  </div>
{/if}
