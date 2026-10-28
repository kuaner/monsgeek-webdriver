<script lang="ts">
  import { controller, definition, PLAYBACKS } from '../lib/state/controller.svelte'
  import { chooser } from '../lib/state/chooser.svelte'
  import { usageChoices } from '../lib/state/actions'
  import { usageName } from '../lib/protocol/core'

  function move(index: number, delta: number) {
    const events = controller.macro.events
    const target = index + delta
    if (target < 0 || target >= events.length) return
    const [item] = events.splice(index, 1)
    events.splice(target, 0, item!)
  }
</script>

{#if controller.macroSheetOpen}
  <div class="overlay">
    <div class="sheet wide">
      <h2>键盘宏</h2>
      <p>依次设置按下、松开和事件后的延时。完成编辑后，点击主界面的应用改键写入键盘。</p>

      <div class="row">
        <span>播放</span>
        <select
          value={String(controller.playback)}
          onchange={(e) => (controller.playback = Number(e.currentTarget.value))}
        >
          {#each PLAYBACKS as playback (playback.rawValue)}
            <option value={String(playback.rawValue)}>{playback.label}</option>
          {/each}
        </select>
        {#if controller.playback === 0}
          <span>次数</span>
          <input
            type="number"
            min="1"
            max="65535"
            style="width:72px"
            value={String(controller.macro.repeatCount)}
            onchange={(e) => {
              controller.macro.repeatCount = Math.max(1, Math.min(65535, Number(e.currentTarget.value) || 1))
              e.currentTarget.value = String(controller.macro.repeatCount)
            }}
          />
        {/if}
        <span class="spacer"></span>
        <span class="caption">{controller.macro.events.length} / 62 个事件</span>
      </div>

      <div class="macro-list">
        {#each controller.macro.events as event, index}
          <div class="macro-event">
            <select
              class="act"
              value={event.down ? 'down' : 'up'}
              onchange={(e) => (event.down = e.currentTarget.value === 'down')}
            >
              <option value="down">按下</option>
              <option value="up">松开</option>
            </select>
            <button
              class="chooser-button usage-chooser"
              onclick={(e) => chooser.open(e.currentTarget, usageChoices(false), String(event.usage), (id) => (event.usage = Number(id)))}
            >
              <span>{usageName(event.usage, definition)}</span>
            </button>
            <input
              class="delay"
              type="number"
              min="0"
              max="65535"
              value={String(event.delay)}
              onchange={(e) => {
                event.delay = Math.max(0, Math.min(65535, Number(e.currentTarget.value) || 0))
                e.currentTarget.value = String(event.delay)
              }}
            />
            <span class="caption">ms</span>
            <button class="mini" onclick={() => move(index, -1)}>↑</button>
            <button class="mini" onclick={() => move(index, 1)}>↓</button>
            <button class="mini" onclick={() => controller.macro.events.splice(index, 1)}>删除</button>
          </div>
        {/each}
      </div>

      <div class="row">
        <button onclick={() => controller.macro.events.push({ usage: 4, down: true, delay: 30 }, { usage: 4, down: false, delay: 50 })}>
          添加点击
        </button>
        <button onclick={() => controller.macro.events.push({ usage: 227, down: true, delay: 30 })}>
          添加按下
        </button>
        <button onclick={() => controller.macro.events.push({ usage: 227, down: false, delay: 30 })}>
          添加松开
        </button>
      </div>

      <div class="footer">
        <button class="primary" onclick={() => (controller.macroSheetOpen = false)}>完成</button>
      </div>
    </div>
  </div>
{/if}
