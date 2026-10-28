<script lang="ts">
  import { chooser } from '../lib/state/chooser.svelte'

  function onPointerDown(event: PointerEvent) {
    const panel = document.getElementById('chooser')
    if (chooser.isOpen && panel && !panel.contains(event.target as Node)) chooser.close()
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') chooser.close()
  }
</script>

<svelte:window onpointerdown={onPointerDown} onkeydown={onKeyDown} />

{#if chooser.isOpen}
  <div id="chooser" style={`top:${chooser.position.top}px;left:${chooser.position.left}px`}>
    <input class="search" placeholder="搜索按键或功能" bind:value={chooser.search} />
    <div class="list">
      {#if chooser.filtered.length === 0}
        <div class="empty">无匹配项</div>
      {:else}
        {#each chooser.filtered.slice(0, 300) as item, index (item.id)}
          {@const showHeader = item.group && item.group !== chooser.filtered[index - 1]?.group}
          {#if showHeader}
            <div class="group-label">{item.group}</div>
          {/if}
          <div
            class="item"
            role="option"
            tabindex="-1"
            aria-selected={item.id === chooser.currentId}
            onclick={() => chooser.pick(item.id)}
            onkeydown={(e) => e.key === 'Enter' && chooser.pick(item.id)}
          >
            <span>{item.label}</span>
            {#if item.id === chooser.currentId}<span class="check">✓</span>{/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}
