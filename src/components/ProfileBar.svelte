<script lang="ts">
  import { controller } from '../lib/state/controller.svelte'

  let importInput: HTMLInputElement

  async function resetWithConfirm() {
    const ok = window.confirm(
      '恢复键盘默认设置？\n\n将清除键盘内的自定义改键、宏和灯效。需要保留时，请先手动保存配置。')
    if (ok) await controller.resetKeyboard()
  }
</script>

<div class="profile-strip">
  <button disabled={!controller.canConfigure} onclick={() => (controller.saveSheetOpen = true)}>
    保存配置…
  </button>
  {#if controller.profiles.length > 0}
    <select
      value={controller.selectedProfileId}
      onchange={(e) => (controller.selectedProfileId = e.currentTarget.value)}
    >
      <option value="">选择方案</option>
      {#each controller.profiles as profile (profile.id)}
        <option value={profile.id}>{profile.name}</option>
      {/each}
    </select>
    <button
      disabled={!controller.selectedProfileId || !controller.canConfigure}
      onclick={() => void controller.loadProfile()}
    >
      切换配置
    </button>
    <button disabled={!controller.selectedProfileId} onclick={() => controller.exportProfile()}>
      导出
    </button>
  {/if}
  <button onclick={() => importInput.click()}>导入…</button>
  <input
    type="file"
    accept="application/json,.json"
    style="display:none"
    bind:this={importInput}
    onchange={(e) => {
      const file = e.currentTarget.files?.[0]
      if (file) void controller.importProfile(file)
      e.currentTarget.value = ''
    }}
  />
  <span class="spacer"></span>
  <button class="danger" disabled={!controller.canConfigure} onclick={() => void resetWithConfirm()}>
    恢复默认设置…
  </button>
</div>
<div class="reset-note foot-note">
  配置保存在本浏览器，「导出」生成 JSON 文件可与原生客户端互通；日常设置不会自动备份。
</div>
