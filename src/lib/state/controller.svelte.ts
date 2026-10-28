// 应用控制器 — Svelte 5 runes 状态 + USB 操作编排。
// 移植自原生 Controller.swift 与初版 webhid/js/app.js 的控制逻辑，
// 遵循用户既定偏好：日常不自动备份；仅手动保存配置；恢复默认必须显式确认。

import definitionJson from '../assets/m1w.json'
import { M1WClient } from '../protocol/client'
import {
  allActions, chord, isKnobKey, keyDisplayName, macroDecoded, macroEncoded,
  infoDeviceID, infoFirmware, infoFirmwareRevision, infoLightsEnabled, infoLight,
  infoProfile, infoSupportsConfiguration, lightUISpeed, mergeInfo, PLAYBACKS,
  recordsEqual, recordLabel, snapshotValidatedMatrix,
} from '../protocol/core'
import type {
  DeviceDefinition, DeviceInfo, KeyRecord, KeyboardMacro, StoredProfile,
} from '../protocol/types'
import { Connection } from '../protocol/hid'

export const MAPPING_MODES = [
  { id: 'key', label: '按键' },
  { id: 'chord', label: '组合' },
  { id: 'function', label: '功能' },
  { id: 'macro', label: '宏' },
] as const
export type MappingMode = (typeof MAPPING_MODES)[number]['id']

export const EFFECTS: Array<[number, string]> = [
  [1, '常亮'], [2, '呼吸'], [3, '霓虹'], [4, '波浪'], [5, '涟漪'], [6, '雨滴'], [7, '贪吃蛇'],
  [8, '按键触发'], [9, '覆盖'], [10, '正弦波'], [11, '万花筒'], [12, '线性波'], [14, '激光'],
  [15, '环形波'], [16, '炫光'], [17, '雨落'], [18, '流星'], [19, '反向触发'], [23, '列车'], [24, '烟花'],
]

const LS_KEY = 'm1w-web-profiles'
const SELFTEST = new URLSearchParams(location.search).has('selftest')

export const definition: DeviceDefinition = definitionJson as DeviceDefinition
export const actions = allActions(definition)

// 全局 USB 串行队列（等价 native 的串行 DispatchQueue），外层套 Web Locks
// 跨标签页互斥：run / poll / 宏读取 / 自检全部排队执行，
// 避免交错读写同一个 EP0 功能寄存器造成陈旧应答。
let usbChain: Promise<unknown> = Promise.resolve()
export function usbQueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = usbChain.then(() => {
    if (navigator.locks?.request) {
      return navigator.locks.request('m1w-usb', { mode: 'exclusive' }, () => fn())
    }
    return fn()
  })
  usbChain = next.then(() => {}, () => {})
  return next as Promise<T>
}

function loadProfiles(): StoredProfile[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as StoredProfile[]
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

class Controller {
  busy = $state(false)
  status = $state('连接 M1W 数据线并切到有线模式')
  connected = $state(false)
  info: DeviceInfo | null = $state(null)
  matrix: number[] | null = $state(null)

  selectedKeyIndex = $state(-1) // 未选择任何按键；点击键盘图后才选中
  remapOpen = $state(false)
  mappingMode: MappingMode = $state('key')
  selectedAction = $state('')
  dockView: 'keys' | 'light' = $state('keys')
  chordKey = $state(6)
  chordModifiers: number[] = $state([227])
  chordSecondary = $state(0)
  macro: KeyboardMacro = $state({ repeatCount: 1, events: [] })
  playback = $state(0)
  macroLoading = $state(false)
  macroSheetOpen = $state(false)
  saveSheetOpen = $state(false)
  profileName = $state('我的配置')

  lightMode = $state(4)
  lightBrightness = $state(4)
  lightSpeed = $state(2)
  lightRgb = $state('ffffff')
  lightRainbow = $state(true)
  lightDirty = $state(false)
  lightPanelOpen = $state(false)
  knobPanelOpen = $state(false)

  profiles: StoredProfile[] = $state(loadProfiles())
  selectedProfileId = $state('')

  selftestLines: string[] = $state([])
  selftestVisible = $state(false)

  connection: Connection | null = null
  private polling = false
  private timer: ReturnType<typeof setInterval> | null = null
  private selftestRan = false

  // ---- 派生状态 ----

  get canConfigure(): boolean {
    return this.connected && this.info !== null &&
      infoSupportsConfiguration(this.info) && infoProfile(this.info) === 0
  }

  get connectionDescription(): string {
    if (this.connected && this.info) {
      const readOnly = infoSupportsConfiguration(this.info) ? '' : ' · 只读'
      return `USB 已连接 · 固件 ${infoFirmware(this.info)} · 配置 ${infoProfile(this.info)}${readOnly}`
    }
    return '连接 M1W 数据线并切到有线模式'
  }

  get selectedKey() {
    return definition.keys.find((k) => k.index === this.selectedKeyIndex) ?? null
  }

  get currentRecord(): KeyRecord | null {
    return this.matrix && this.selectedKeyIndex >= 0 && this.selectedKeyIndex < 126
      ? this.matrix.slice(this.selectedKeyIndex * 4, this.selectedKeyIndex * 4 + 4)
      : null
  }

  get currentMapping(): string {
    const record = this.currentRecord
    return record ? recordLabel(record, definition) : '未读取'
  }

  get choices() {
    // 按键 = 纯物理键；功能 = 媒体/灯光快捷/旋钮/禁用（对应原版按键设置里的功能列表）。
    return actions.filter((action) => {
      switch (this.mappingMode) {
        case 'key': return action.category === '按键' && action.record[0] === 0
        case 'function': return action.category !== '按键'
        default: return false
      }
    })
  }

  get lightsEnabledNow(): boolean {
    return this.info !== null && infoLightsEnabled(this.info)
  }

  // ---- 启动与轮询 ----

  start(): () => void {
    this.connection = new Connection(() => this.onConnectionChange())
    if (!this.connection.supported) {
      this.status = '此浏览器不支持 WebHID，请使用 Chrome / Edge。'
      return () => {}
    }
    void this.autoConnect()
    this.timer = setInterval(() => void this.poll(), 2000)
    return () => {
      if (this.timer) clearInterval(this.timer)
    }
  }

  private async autoConnect(): Promise<void> {
    const ok = await this.connection!.autoConnect().catch(() => false)
    if (ok) await this.refresh()
    if (SELFTEST && ok) await this.selfTest()
  }

  private onConnectionChange(): void {
    if (this.connection && !this.connection.connected) {
      this.connected = false
      this.matrix = null
      this.status = '键盘连接已断开，正在等待重新连接…'
    }
  }

  async connectByPicker(): Promise<void> {
    await this.connection!.requestAndConnect()
    await this.refresh()
    if (SELFTEST && !this.selftestRan) await this.selfTest()
  }

  private async run<T>(
    label: string,
    operation: (client: M1WClient) => Promise<T & { matrix?: number[] | null; saved?: boolean }>,
    options: { refreshMatrix?: boolean; fullInfo?: boolean } = {},
  ): Promise<(T & { matrix?: number[] | null; saved?: boolean }) | null> {
    if (this.busy) return null
    this.busy = true
    this.status = label
    try {
      const outcome = await usbQueue(async () => {
        const client = new M1WClient(this.connection!.transport())
        const result = await operation(client)
        if (!result.matrix && options.refreshMatrix) {
          result.matrix = await client.readMatrix({ verify: false })
        }
        return {
          ...result,
          info: await (options.fullInfo ? client.info() : client.liveInfo()),
        }
      })
      this.connected = true
      this.info = this.info ? mergeInfo(this.info, outcome.info as DeviceInfo) : (outcome.info as DeviceInfo)
      if (outcome.matrix) {
        this.matrix = outcome.matrix
        this.syncMapping()
      }
      this.syncLight()
      this.status = (outcome as { saved?: boolean }).saved ? '配置已手动保存' : '已同步键盘'
      return outcome
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      this.status = /Failed to (write|read)/i.test(text)
        ? '键盘通信中断。请点击右上角「连接键盘」重新授权，即可恢复。'
        : text
      if (!this.connection?.connected || /未连接|NotFound|Network|not open/i.test(this.status)) {
        this.connected = false
        this.matrix = null
      }
      return null
    } finally {
      this.busy = false
    }
  }

  async refresh(): Promise<void> {
    await this.run('正在读取键盘…', async (client) => {
      const info = await client.info()
      const result: { matrix?: number[] | null; fullInfo?: boolean } = {}
      if (infoSupportsConfiguration(info) && infoProfile(info) === 0) {
        result.matrix = await client.readMatrix({ verify: false })
      }
      return result as { matrix?: number[] | null }
    }, { fullInfo: true })
  }

  private async poll(): Promise<void> {
    if (this.busy || this.polling) return
    this.polling = true
    try {
      if (!this.connection!.connected) {
        const ok = await this.connection!.autoConnect().catch(() => false)
        if (!ok) {
          if (this.connected) {
            this.connected = false
            this.matrix = null
            this.status = '键盘连接已断开，正在等待重新连接…'
          }
          return
        }
      }
      const prevConnected = this.connected
      const prevFirmware = this.info ? infoFirmwareRevision(this.info) : null
      const prevProfile = this.info ? infoProfile(this.info) : null
      const needsMatrix = this.matrix === null || !prevConnected
      const needsInfo = this.info === null || !prevConnected
      const { info, matrix } = await usbQueue(async () => {
        const client = new M1WClient(this.connection!.transport())
        const info = await (needsInfo ? client.info() : client.liveInfo())
        const changed = infoFirmwareRevision(info) !== prevFirmware || infoProfile(info) !== prevProfile
        let matrix: number[] | null = null
        if (infoSupportsConfiguration(info) && infoProfile(info) === 0 && (needsMatrix || changed)) {
          matrix = await client.readMatrix({ verify: false })
        }
        return { info, matrix }
      })
      this.connected = true
      this.info = this.info ? mergeInfo(this.info, info) : info
      if (matrix) {
        this.matrix = matrix
        this.syncMapping()
      }
      if (!infoSupportsConfiguration(info) || infoProfile(info) !== 0) this.matrix = null
      this.syncLight()
      if (!prevConnected) this.status = '已连接并同步键盘'
      if (SELFTEST && !this.selftestRan) await this.selfTest()
    } catch {
      if (!(await this.connection!.heal())) {
        this.connected = false
        this.matrix = null
        this.status = '键盘通信中断。请点击右上角「连接键盘」重新授权，即可恢复。'
      }
    } finally {
      this.polling = false
    }
  }

  // ---- 键位选择与改键 ----

  selectKey(index: number, openEditor = false): void {
    this.selectedKeyIndex = index
    this.macroLoading = false
    this.syncMapping()
    if (openEditor) this.remapOpen = true
  }

  closeRemap(): void {
    this.remapOpen = false
  }

  private syncMapping(): void {
    const record = this.currentRecord
    if (!record) return
    if (record[0] === 9) {
      this.mappingMode = 'macro'
      this.playback = PLAYBACKS.some((p) => p.rawValue === record[1]) ? record[1]! : 0
      void this.fetchMacro(record[2]!, this.selectedKeyIndex)
      return
    }
    if (record[0] === 0 && (record[1] !== 0 || record[3] !== 0)) {
      this.mappingMode = 'chord'
      this.chordKey = record[2]!
      this.chordModifiers = [record[1]!, record[3]!].filter((m) => m >= 224 && m <= 231)
      this.chordSecondary = record[3]! < 224 ? record[3]! : 0
      return
    }
    let action = actions.find((a) => recordsEqual(a.record, record) && a.category !== '按键')
    if (action) {
      this.selectedAction = action.id
      this.mappingMode = 'function'
      return
    }
    action = actions.find((a) => recordsEqual(a.record, record))
    if (action) {
      this.selectedAction = action.id
      this.mappingMode = 'key'
      return
    }
    this.selectedAction = ''
    this.mappingMode = 'function'
  }

  chooseMode(mode: MappingMode): void {
    if (mode === 'macro' && this.mappingMode !== 'macro' && this.currentRecord?.[0] !== 9) {
      this.macro = { repeatCount: 1, events: [] }
      this.playback = 0
    }
    this.mappingMode = mode
    if (!this.choices.some((a) => a.id === this.selectedAction)) {
      const key = this.selectedKey
      this.selectedAction = this.choices.find((a) => key && recordsEqual(a.record, key.record))?.id
        ?? this.choices[0]?.id ?? ''
    }
  }

  toggleChordModifier(usage: number, on: boolean): void {
    if (on && !this.chordModifiers.includes(usage)) {
      this.chordModifiers = [...this.chordModifiers, usage]
    } else if (!on) {
      this.chordModifiers = this.chordModifiers.filter((m) => m !== usage)
    }
  }

  private async fetchMacro(slot: number, keyIndex: number): Promise<void> {
    this.macroLoading = true
    this.macro = { repeatCount: 1, events: [] }
    try {
      const bytes = await usbQueue(async () => {
        const client = new M1WClient(this.connection!.transport())
        return client.readMacro(slot)
      })
      this.macro = macroDecoded(bytes)
    } catch (error) {
      this.status = error instanceof Error ? error.message : String(error)
    } finally {
      this.macroLoading = false
      if (this.selectedKeyIndex !== keyIndex) return
    }
  }

  async applyKey(factory = false): Promise<void> {
    const key = this.selectedKey
    if (!key || !this.matrix) return
    if (this.mappingMode === 'macro' && !factory) {
      try {
        macroEncoded(this.macro)
      } catch (error) {
        this.status = error instanceof Error ? error.message : String(error)
        return
      }
      await this.run('正在写入宏与按键…', async (client) => {
        const result = await client.assignMacro(this.selectedKeyIndex, this.macro, this.playback)
        if (result.macroSlot == null) throw new Error('宏槽返回值缺失。')
        return {
          matrix: withRecord(this.matrix!, this.selectedKeyIndex, [9, this.playback, result.macroSlot, 0]),
        }
      })
      return
    }
    let record: KeyRecord
    try {
      if (factory) record = key.record
      else if (this.mappingMode === 'chord') {
        record = chord(this.chordKey, [...this.chordModifiers].sort((a, b) => a - b), this.chordSecondary)
      } else {
        const action = actions.find((a) => a.id === this.selectedAction)
        if (!action) throw new Error('请先选择目标功能。')
        record = action.record
      }
    } catch (error) {
      this.status = error instanceof Error ? error.message : String(error)
      return
    }
    await this.run('正在改键…', async (client) => {
      await client.setKey(this.selectedKeyIndex, record)
      return { matrix: withRecord(this.matrix!, this.selectedKeyIndex, record) }
    })
  }

  // ---- 灯效 ----

  markLightDirty(): void {
    this.lightDirty = true
  }

  syncLight(): void {
    const light = this.info ? infoLight(this.info) : null
    if (this.lightDirty || !light) return
    if (light.mode !== 0) this.lightMode = light.mode
    this.lightBrightness = light.brightness
    this.lightSpeed = lightUISpeed(light)
    if (light.mode !== 0) {
      // 关灯期间保留用户上次选的颜色/彩虹，重新开启时直接恢复。
      this.lightRainbow = (light.options & 15) === 7
      this.lightRgb = [light.red, light.green, light.blue]
        .map((b) => b.toString(16).padStart(2, '0')).join('')
    }
  }

  async applyLight(): Promise<void> {
    if (!/^[0-9a-fA-F]{6}$/.test(this.lightRgb)) {
      this.status = '颜色需为六位十六进制值，例如 ff8800'
      return
    }
    const values = {
      mode: this.lightMode,
      brightness: this.lightBrightness,
      speed: this.lightSpeed,
      rgb: Number.parseInt(this.lightRgb, 16),
      rainbow: this.lightRainbow,
      enabled: true as const,
    }
    this.lightDirty = false
    await this.run('正在设置灯效…', async (client) => {
      await client.setLight(values)
      return {}
    })
  }

  async toggleLights(enabled: boolean): Promise<void> {
    const rememberedMode = this.lightMode
    await this.run(enabled ? '正在开启灯光…' : '正在关闭灯光…', async (client) => {
      await client.setLight({ mode: enabled ? rememberedMode : null, enabled })
      return {}
    })
  }

  // ---- 配置方案（localStorage + 文件导入导出）----

  private persistProfiles(): void {
    localStorage.setItem(LS_KEY, JSON.stringify(this.profiles))
  }

  async saveProfile(name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    this.saveSheetOpen = false
    const outcome = await this.run('正在保存你选择的配置…', async (client) => {
      const snapshot = await client.snapshot(trimmed)
      return { saved: true as const, snapshot, matrix: snapshotValidatedMatrix(snapshot) }
    })
    if (!outcome || !('snapshot' in outcome)) return
    this.profiles = [
      { id: crypto.randomUUID(), name: trimmed, snapshot: outcome.snapshot as never },
      ...this.profiles,
    ]
    this.selectedProfileId = this.profiles[0]!.id
    this.persistProfiles()
  }

  async loadProfile(): Promise<void> {
    const entry = this.profiles.find((p) => p.id === this.selectedProfileId)
    if (!entry) return
    await this.run('正在切换配置…', async (client) => {
      await client.restore(entry.snapshot)
      return {}
    }, { refreshMatrix: true, fullInfo: true })
  }

  exportProfile(): void {
    const entry = this.profiles.find((p) => p.id === this.selectedProfileId)
    if (!entry) return
    const blob = new Blob([JSON.stringify(entry.snapshot, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `m1w-${entry.name.replace(/[\\/:*?"<>|]/g, '_')}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  async importProfile(file: File): Promise<void> {
    try {
      const snapshot = JSON.parse(await file.text())
      snapshotValidatedMatrix(snapshot)
      this.profiles = [
        { id: crypto.randomUUID(), name: snapshot.name ?? file.name.replace(/\.json$/i, ''), snapshot },
        ...this.profiles,
      ]
      this.selectedProfileId = this.profiles[0]!.id
      this.persistProfiles()
      this.status = `已导入配置「${snapshot.name ?? file.name}」，可点击切换配置写入键盘。`
    } catch (error) {
      this.status = `导入失败：${error instanceof Error ? error.message : String(error)}`
    }
  }

  async resetKeyboard(): Promise<void> {
    this.lightDirty = false
    await this.run('正在恢复默认设置，请等待键盘重启…', async (client) => {
      await client.factoryReset()
      return {}
    }, { refreshMatrix: true, fullInfo: true })
  }

  // ---- 只读自检（?selftest=1 连接后自动运行）----

  async selfTest(): Promise<void> {
    this.selftestRan = true
    this.selftestVisible = true
    const lines: string[] = ['[selftest] 只读自检开始']
    this.selftestLines = [...lines]
    const log = (line: string) => {
      lines.push(line)
      this.selftestLines = [...lines]
    }
    try {
      await usbQueue(async () => {
        const client = new M1WClient(this.connection!.transport())
        let t = performance.now()
        const info = await client.info()
        log(`info: fw=${infoFirmware(info)} devID=${infoDeviceID(info)} ` +
          `supports=${infoSupportsConfiguration(info)} profile=${infoProfile(info)} ` +
          `(${(performance.now() - t).toFixed(0)}ms)`)
        const phase = async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
          const start = performance.now()
          const value = await fn()
          log(`${name} 完成 (${(performance.now() - start).toFixed(0)}ms)`)
          return value
        }
        const matrix = await phase('matrix 双读', () => client.readMatrix())
        const nonDefault = definition.keys.filter((k) =>
          !recordsEqual(matrix.slice(k.index * 4, k.index * 4 + 4), k.record)).length
        log(`matrix: 与出厂默认不同的按键: ${nonDefault}`)
        const fn = await phase('fn 读取', () => client.readMatrix({ fn: true }))
        log(`fn: 非空=${fn.some((b) => b !== 0)}`)
        const slots = new Set<number>()
        const all = matrix.concat(fn)
        for (let i = 0; i < all.length; i += 4) if (all[i] === 9) slots.add(all[i + 2]!)
        await phase('macros 读取', async () => {
          for (const slot of slots) await client.readMacro(slot)
        })
        log(`macros: 引用槽 ${JSON.stringify([...slots])}`)
      })
      log('[selftest] 全部通过 ✅')
    } catch (error) {
      log(`[selftest] 失败 ❌ ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function withRecord(matrix: number[], index: number, record: KeyRecord): number[] {
  const updated = matrix.slice()
  updated.splice(index * 4, 4, ...record)
  return updated
}

export const controller = new Controller()
export { isKnobKey, keyDisplayName, recordLabel, PLAYBACKS }
