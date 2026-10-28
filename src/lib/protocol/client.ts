// M1W 客户端 — 查询/整块读取、改键、灯效、宏、配置切换。
// 移植自 native M1WClient（Swift）。日常操作从不自动备份；
// 只有用户手动保存才生成快照。所有写操作读回校验，失败自动还原原值。

import type {
  ChangeResult, DeviceInfo, Frame, KeyRecord, KeyboardMacro, LightSettings,
  Pause, ReportTransport, Snapshot,
} from './types'
import {
  QUERIES, BULK_RESPONSE_CMDS, ProtocolError, frame, singleKeyFrame, validateKeyRecord,
  lightFrame, lightEquals, parseLight, keyboardOptionsFrame, macroFrames, hexEncode,
  infoSupportsConfiguration, infoProfile, infoLight, infoKeyboardOptions, infoDeviceID,
  mergeInfo, makeSnapshot, snapshotValidatedMatrix, snapshotValidatedFnMatrix,
  snapshotValidatedMacros, snapshotIsCompatible, macroEncoded,
} from './core'

export { ProtocolError }

const sleep: Pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export interface SetLightOptions {
  mode?: number | null
  brightness?: number | null
  speed?: number | null
  rgb?: number | null
  rainbow?: boolean | null
  enabled?: boolean | null
}

export class M1WClient {
  private identityValidated = false

  constructor(
    private readonly transport: ReportTransport,
    private readonly pause: Pause = sleep,
  ) {}

  async query(command: number, args: number[] = []): Promise<Frame> {
    if (!QUERIES.has(command) || args.length > 6 || BULK_RESPONSE_CMDS.has(command)) {
      throw new ProtocolError('不支持的查询或整块应答命令。')
    }
    await this.transport.write(frame([command, ...args]))
    for (let attempt = 0; attempt < 6; attempt++) {
      await this.pause(40)
      const response = await this.read64()
      if (response[0] === command) return response
    }
    throw new ProtocolError(`查询 0x${command.toString(16).padStart(2, '0')} 没有得到匹配的应答。`)
  }

  private async read64(): Promise<Frame> {
    const response = await this.transport.read()
    if (!Array.isArray(response) || response.length !== 64) {
      throw new ProtocolError(`HID 应答长度不足：${response ? response.length : 0}/64 字节。`)
    }
    return response
  }

  private async status(commands: number[]): Promise<DeviceInfo> {
    const reports: Record<string, string> = {}
    for (const code of commands) {
      reports[code.toString(16).padStart(2, '0')] = hexEncode(await this.query(code))
    }
    return { reports }
  }

  async info(): Promise<DeviceInfo> {
    return this.status([0x80, 0x8f, 0x84, 0x85, 0x86, 0x87, 0x91, 0x92])
  }

  async liveInfo(): Promise<DeviceInfo> {
    return this.status([0x80, 0x8f, 0x85, 0x86, 0x87])
  }

  private async validateIdentity(info: DeviceInfo): Promise<void> {
    if (!infoSupportsConfiguration(info)) {
      const device = infoDeviceID(info)
      throw new ProtocolError(
        `此设备或固件尚未验证，当前只读取状态。设备 ID：${device === null ? '未知' : device}。`)
    }
    this.identityValidated = true
  }

  private async requireProfile0(): Promise<void> {
    if (!this.identityValidated) await this.validateIdentity(await this.status([0x80, 0x8f]))
    const profile = (await this.query(0x85))[1]!
    if (profile !== 0) throw new ProtocolError(`当前版本支持配置 0，请先切回该配置。当前为 ${profile}。`)
  }

  /** 整块读取前先查询版本建立“栅栏”，识别未更新的寄存器残留。 */
  private async block(command: number, selector: number, chunk: number): Promise<Frame> {
    const fence = await this.query(0x80)
    await this.transport.write(frame([command, selector, chunk]))
    await this.pause(40)
    const response = await this.read64()
    if (response.every((b, i) => b === fence[i])) {
      throw new ProtocolError('陈旧的整块应答，操作停止。')
    }
    return response
  }

  async readMatrix(options: { fn?: boolean; verify?: boolean } = {}): Promise<number[]> {
    const { fn = false, verify = true } = options
    const once = async (): Promise<number[]> => {
      const matrix: number[] = []
      for (let page = 0; page < 8; page++) {
        matrix.push(...await this.block(fn ? 0x90 : 0x89, 0, page))
      }
      if (!matrix.some((b) => b !== 0)) throw new ProtocolError('矩阵应答为空。')
      return matrix
    }
    const first = await once()
    if (verify) {
      const second = await once()
      if (!second.every((b, i) => b === first[i])) {
        throw new ProtocolError('两次矩阵读取不一致，操作停止。')
      }
    }
    return first
  }

  async readKey(index: number, options: { fn?: boolean } = {}): Promise<KeyRecord> {
    if (!(index >= 0 && index < 126)) throw new ProtocolError('无效的矩阵编号。')
    const page = await this.block(options.fn ? 0x90 : 0x89, 0, Math.floor(index / 16))
    const offset = (index % 16) * 4
    return page.slice(offset, offset + 4)
  }

  async readMacro(slot: number): Promise<number[]> {
    if (!(slot >= 0 && slot < 50)) throw new ProtocolError('无效的宏槽。')
    const bytes: number[] = []
    for (let page = 0; page < 4; page++) bytes.push(...await this.block(0x8b, slot, page))
    return bytes
  }

  /** 仅由用户手动点“保存配置”调用。 */
  async snapshot(name: string | null = null, includeExtras = true): Promise<Snapshot> {
    const info = await this.info()
    if (infoDeviceID(info) !== 983 || infoProfile(info) !== 0) {
      throw new ProtocolError('手动配置保存当前支持 M1W 设备 983 的配置 0。')
    }
    const matrix = await this.readMatrix()
    const fn = includeExtras ? await this.readMatrix({ fn: true }) : null
    const macros: Record<number, number[]> = {}
    if (includeExtras) {
      const all = matrix.concat(fn ?? [])
      for (let index = 0; index < all.length; index += 4) {
        if (all[index] === 9) {
          const slot = all[index + 2]!
          if (!(slot in macros)) macros[slot] = await this.readMacro(slot)
        }
      }
    }
    return makeSnapshot(info, matrix, { name, fnMatrix: fn, macros })
  }

  private async writeKey(index: number, record: KeyRecord, fn: boolean): Promise<void> {
    const data = singleKeyFrame(index, record)
    if (fn) {
      data[0] = 0x15
      let sum = 0
      for (let i = 0; i < 7; i++) sum += data[i]!
      data[7] = (255 - sum) & 0xff
    }
    await this.transport.write(data)
    await this.pause(500) // 原厂前端的写后稳定间隔；仅靠读回不能替代
  }

  async setKey(index: number, record: KeyRecord, options: { fn?: boolean } = {}): Promise<ChangeResult> {
    const fn = options.fn ?? false
    validateKeyRecord(singleKeyFrame(index, record).slice(8, 12))
    await this.requireProfile0()
    const before = await this.readKey(index, { fn })
    if (recordsEq(before, record)) {
      return { changedKeyIndices: [], lightChanged: false, verified: true }
    }
    try {
      await this.writeKey(index, record, fn)
      if (!recordsEq(await this.readKey(index, { fn }), record)) {
        throw new ProtocolError('按键读回不一致。')
      }
    } catch (original) {
      try {
        await this.writeKey(index, before, fn)
        if (!recordsEq(await this.readKey(index, { fn }), before)) {
          throw new ProtocolError('原值还原读回失败。')
        }
      } catch (restoreError) {
        throw new ProtocolError(`改键失败：${message(original)}；原值还原失败：${message(restoreError)}`)
      }
      throw new ProtocolError(`改键失败，已还原原值：${message(original)}`)
    }
    return { changedKeyIndices: [index], lightChanged: false, verified: true }
  }

  async setLight(options: SetLightOptions = {}): Promise<ChangeResult> {
    const { mode, brightness, speed, rgb, rainbow, enabled } = options
    for (const [value, min, max] of [[mode, 0, 24], [brightness, 0, 4], [speed, 0, 4], [rgb, 0, 0xffffff]] as const) {
      if (value != null && !(value >= min && value <= max)) {
        throw new ProtocolError('灯效参数超出范围。')
      }
    }
    const status = await this.liveInfo()
    await this.validateIdentity(status)
    if (infoProfile(status) !== 0) {
      throw new ProtocolError(`当前版本支持配置 0。当前为 ${infoProfile(status)}。`)
    }
    const old = infoLight(status)
    const oldOptions = infoKeyboardOptions(status)
    if (!old || !oldOptions) throw new ProtocolError('不支持的配置或缺少灯效状态。')
    const desired: LightSettings = { ...old }
    if (mode != null) desired.mode = mode
    if (brightness != null) desired.brightness = brightness
    if (speed != null) desired.speed = 4 - speed
    if (rgb != null) {
      desired.red = (rgb >> 16) & 255
      desired.green = (rgb >> 8) & 255
      desired.blue = rgb & 255
      desired.options = (desired.options & 0xf0) | 8
    }
    if (rainbow != null) {
      desired.options = (desired.options & 0xf0) | (rainbow ? 7 : 8)
    }
    if (enabled === true && desired.mode === 0) desired.mode = 4
    if (enabled === true && brightness == null && desired.brightness === 0) desired.brightness = 4
    // 厂商前端 LightOff：07 帧 mode=0、brightness=0；06 门控位是硬件快捷键
    // 的独立开关，软件关灯不碰它（用 06 关灯在真机上无效）。
    if (enabled === false) {
      desired.mode = 0
      desired.brightness = 0
    }
    let gateEnabled: boolean
    if (enabled === false) gateEnabled = (oldOptions[2]! & 0x10) === 0
    else if (enabled === true) gateEnabled = true
    else gateEnabled = desired.mode !== 0 && desired.brightness > 0
    const optionsFrame = keyboardOptionsFrame(oldOptions, gateEnabled)
    const optionsChanged = optionsFrame[2] !== oldOptions[2]
    const lightChanged = !lightEquals(old, desired)
    if (!optionsChanged && !lightChanged) {
      return { changedKeyIndices: [], lightChanged: false, verified: true }
    }
    try {
      if (optionsChanged) {
        await this.transport.write(optionsFrame)
        await this.pause(20)
      }
      if (lightChanged) {
        await this.transport.write(lightFrame(desired))
        await this.pause(500)
      } else {
        await this.pause(120)
      }
      const actual = await this.liveInfo()
      const verified = enabled === false
        ? infoLight(actual)!.mode === 0 && infoLight(actual)!.brightness === 0 &&
          infoKeyboardOptions(actual)![2] === optionsFrame[2]
        : lightEquals(infoLight(actual)!, desired) &&
          infoKeyboardOptions(actual)![2] === optionsFrame[2]
      if (!verified) throw new ProtocolError('灯效/门控读回不一致。')
    } catch (original) {
      try {
        await this.transport.write(frame([0x06, ...oldOptions.slice(1, 7)]))
        await this.transport.write(lightFrame(old))
        await this.pause(500)
        const restored = await this.liveInfo()
        if (!lightEquals(infoLight(restored)!, old) ||
            infoKeyboardOptions(restored)![2] !== oldOptions[2]) {
          throw new ProtocolError('灯效还原读回失败。')
        }
      } catch (restoreError) {
        throw new ProtocolError(`灯效设置失败：${message(original)}；还原失败：${message(restoreError)}`)
      }
      throw new ProtocolError(`灯效设置失败，已还原原值：${message(original)}`)
    }
    return { changedKeyIndices: [], lightChanged: true, verified: true }
  }

  async writeMacro(slot: number, bytes: number[]): Promise<void> {
    const frames = macroFrames(slot, bytes)
    await this.requireProfile0()
    for (const f of frames) {
      await this.transport.write(f)
      await this.pause(20)
    }
    await this.pause(500)
    const readback = await this.readMacro(slot)
    if (!readback.every((b, i) => b === bytes[i])) throw new ProtocolError('宏读回不一致。')
  }

  /** 分配宏槽：优先独占复用本键原槽，否则取第一个空闲槽；失败还原原宏数据。 */
  async assignMacro(
    index: number, macro: KeyboardMacro, playback: number, requestedSlot: number | null = null,
  ): Promise<ChangeResult> {
    if (!(index >= 0 && index < 126)) throw new ProtocolError('无效的矩阵编号。')
    const bytes = macroEncoded(macro)
    await this.requireProfile0()
    const matrix = await this.readMatrix({ verify: false })
    const fn = await this.readMatrix({ fn: true, verify: false })
    const oldRecord = matrix.slice(index * 4, index * 4 + 4)
    const all = matrix.concat(fn)
    const used: number[] = []
    for (let i = 0; i < all.length; i += 4) if (all[i] === 9) used.push(all[i + 2]!)
    let slot: number
    if (requestedSlot !== null) slot = requestedSlot
    else if (oldRecord[0] === 9 && used.filter((s) => s === oldRecord[2]).length === 1) slot = oldRecord[2]!
    else {
      const free = [...Array(50).keys()].find((s) => !used.includes(s))
      if (free === undefined) throw new ProtocolError('50 个宏槽均已被按键引用。')
      slot = free
    }
    const oldBytes = await this.readMacro(slot)
    try {
      await this.writeMacro(slot, bytes)
      const result = await this.setKey(index, [9, playback, slot, 0])
      return { ...result, macroSlot: slot }
    } catch (original) {
      try {
        await this.writeMacro(slot, oldBytes)
      } catch (restoreError) {
        throw new ProtocolError(`宏写入失败：${message(original)}；宏原值还原失败：${message(restoreError)}`)
      }
      throw original
    }
  }

  /** 仅由用户在界面明确点“切换配置”调用；只写差异并逐项校验。 */
  async restore(saved: Snapshot): Promise<ChangeResult> {
    const desired = snapshotValidatedMatrix(saved)
    const fn = snapshotValidatedFnMatrix(saved)
    const macros = snapshotValidatedMacros(saved)
    for (const matrix of [desired, ...(fn ? [fn] : [])]) {
      if (!matrix.slice(-8).every((b) => b === 0)) {
        throw new ProtocolError('配置含不可写入的保留矩阵数据。')
      }
    }
    const savedLight = infoLight(saved.info)
    if (savedLight) lightFrame(savedLight)
    const currentInfo = await this.info()
    await this.validateIdentity(currentInfo)
    if (!snapshotIsCompatible(saved, currentInfo)) {
      throw new ProtocolError('此配置与当前键盘不兼容。支持同一 M1W 的 1.04 / 1.08 配置迁移。')
    }
    const current = await this.readMatrix({ verify: false })
    const oldFn = fn ? await this.readMatrix({ fn: true, verify: false }) : null
    const keyChanges: number[] = []
    for (let i = 0; i < 126; i++) {
      if (!current.slice(i * 4, i * 4 + 4).every((b, j) => b === desired[i * 4 + j])) keyChanges.push(i)
    }
    const fnChanges: number[] = []
    if (fn && oldFn) {
      for (let i = 0; i < 126; i++) {
        if (!oldFn.slice(i * 4, i * 4 + 4).every((b, j) => b === fn[i * 4 + j])) fnChanges.push(i)
      }
    }
    for (const i of keyChanges) validateKeyRecord(desired.slice(i * 4, i * 4 + 4))
    for (const i of fnChanges) validateKeyRecord(fn!.slice(i * 4, i * 4 + 4))
    for (const [slotText, data] of Object.entries(macros)) {
      const slot = Number(slotText)
      const currentMacro = await this.readMacro(slot)
      if (!currentMacro.every((b, i) => b === data[i])) await this.writeMacro(slot, data)
    }
    const changed: number[] = []
    for (const i of keyChanges) {
      await this.setKey(i, desired.slice(i * 4, i * 4 + 4))
      changed.push(i)
    }
    for (const i of fnChanges) {
      await this.setKey(i, fn!.slice(i * 4, i * 4 + 4), { fn: true })
    }
    const savedOptions = infoKeyboardOptions(saved.info)
    const currentOptions = infoKeyboardOptions(currentInfo)
    const optionsChanged = !!savedOptions && !!currentOptions &&
      !savedOptions.slice(1, 7).every((b, i) => b === currentOptions[i + 1])
    const lightingChanged = !!savedLight && !lightEquals(savedLight, infoLight(currentInfo)!)
    if (optionsChanged && savedOptions) {
      await this.transport.write(frame([0x06, ...savedOptions.slice(1, 7)]))
      await this.pause(120)
    }
    if (lightingChanged && savedLight) {
      await this.transport.write(lightFrame(savedLight))
      await this.pause(500)
    }
    const after = await this.readMatrix({ verify: false })
    if (!after.every((b, i) => b === desired[i])) throw new ProtocolError('配置切换后的键位校验失败。')
    if (fn) {
      const afterFn = await this.readMatrix({ fn: true, verify: false })
      if (!afterFn.every((b, i) => b === fn[i])) throw new ProtocolError('配置切换后的 Fn 层校验失败。')
    }
    const actual = await this.liveInfo()
    if (savedLight && !lightEquals(infoLight(actual)!, savedLight)) {
      throw new ProtocolError('配置切换后的灯效校验失败。')
    }
    if (savedOptions) {
      const actualOptions = infoKeyboardOptions(actual)!
      if (!savedOptions.slice(1, 7).every((b, i) => b === actualOptions[i + 1])) {
        throw new ProtocolError('配置切换后的选项校验失败。')
      }
    }
    return { changedKeyIndices: changed, lightChanged: optionsChanged || lightingChanged, verified: true }
  }

  /** 仅在界面明确的恢复默认动作后调用；不自动重发、不自动备份。 */
  async factoryReset(): Promise<void> {
    await this.requireProfile0()
    await this.transport.write(frame([0x02]))
    await this.pause(4000)
  }
}

function recordsEq(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export { mergeInfo }
