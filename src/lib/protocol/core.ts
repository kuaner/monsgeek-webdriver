// M1W 协议核心 — 帧构造、校验、灯效/宏编解码、设备信息解析、配置快照。
// 移植自 native M1WCore（Swift），线上行为已在真机验证；纯逻辑、可在 node 测试。

import type {
  Checksum, DeviceDefinition, DeviceInfo, Frame, KeyAction, KeyRecord, PhysicalKey,
  KeyboardMacro, LightSettings, Snapshot,
} from './types'
import { BIT7, BIT8, NONE } from './types'

/** 白名单查询命令；其余一律在 USB 层之前拒绝。 */
export const QUERIES = new Set<number>([
  0x80, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8f, 0x90, 0x91, 0x92,
])

const BULK_RESPONSE_CMDS = new Set<number>([0x89, 0x8b, 0x90])

export class ProtocolError extends Error {}

export function hexEncode(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function hexDecode(text: string): number[] {
  if (typeof text !== 'string' || text.length % 2 !== 0) {
    throw new ProtocolError('奇数长度的十六进制字符串。')
  }
  const out: number[] = []
  for (let i = 0; i < text.length; i += 2) {
    const hi = Number.parseInt(text[i]!, 16)
    const lo = Number.parseInt(text[i + 1]!, 16)
    if (Number.isNaN(hi) || Number.isNaN(lo)) throw new ProtocolError('无效的十六进制字符串。')
    out.push((hi << 4) | lo)
  }
  return out
}

/** 构造 64 字节帧并写入校验字节（UInt8 回绕）。 */
export function frame(bytes: number[], checksum: Checksum = BIT7): Frame {
  if (!Array.isArray(bytes) || bytes.length === 0 || bytes.length > 64) {
    throw new ProtocolError('报告必须包含 1…64 字节。')
  }
  const result: Frame = new Array(64).fill(0)
  for (let i = 0; i < bytes.length; i++) result[i] = bytes[i]!
  if (checksum === NONE) return result
  const index = checksum === BIT7 ? 7 : 8
  let sum = 0
  for (let i = 0; i < index; i++) sum += result[i]!
  result[index] = (255 - sum) & 0xff
  return result
}

/** 单键写入帧（0x13）：byte2 为矩阵记录编号，byte8…11 为新记录。 */
export function singleKeyFrame(index: number, record: KeyRecord): Frame {
  if (!(index >= 0 && index < 126) || !Array.isArray(record) || record.length !== 4) {
    throw new ProtocolError('键编号必须为 0…125，且为四字节记录。')
  }
  const data = frame([0x13, 0, index])
  for (let i = 0; i < 4; i++) data[8 + i] = record[i]!
  return data
}

const WRITABLE_TYPES = [0, 3, 8, 9, 10, 13, 14]

/** 可安全写入键盘的记录类型；宏记录的槽号必须 < 50。 */
export function validateKeyRecord(record: KeyRecord): void {
  // This exact action was observed on this keyboard and is named by the vendor.
  // Do not allow unrelated, unverified type-18 actions through the whitelist.
  const siri = Array.isArray(record) && record.length === 4 &&
    record.every((byte, index) => byte === [18, 0, 227, 44][index])
  if (!Array.isArray(record) || record.length !== 4 ||
      !record.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255) ||
      (!WRITABLE_TYPES.includes(record[0]!) && !siri) ||
      (record[0] === 9 && record[2]! >= 50)) {
    throw new ProtocolError('不支持的按键记录。')
  }
}

export function lightEquals(a: LightSettings, b: LightSettings): boolean {
  return a.mode === b.mode && a.speed === b.speed && a.brightness === b.brightness &&
    a.options === b.options && a.red === b.red && a.green === b.green && a.blue === b.blue
}

export function lightBytes(s: LightSettings): number[] {
  return [s.mode, s.speed, s.brightness, s.options, s.red, s.green, s.blue]
}

/**
 * 灯效设置帧（0x07，BIT8）。
 * 厂商规则：逻辑纯白 FFFFFF 在线上编码为 FAFAFA —— 直接写 FFFFFF 会被
 * 本固件替换成 B4B4B4（真机验证）。关灯同样走本命令（mode=0、brightness=0）。
 */
export function lightFrame(settings: LightSettings): Frame {
  if (settings.mode > 24 || settings.speed > 4 || settings.brightness > 4) {
    throw new ProtocolError('不支持的灯效参数（模式 0…24；速度/亮度 0…4）。')
  }
  const bytes = lightBytes(settings)
  if (settings.red === 255 && settings.green === 255 && settings.blue === 255) {
    bytes.splice(4, 3, 250, 250, 250)
  }
  return frame([0x07, ...bytes], BIT8)
}

const PALETTE = [0xff0000, 0x00ff00, 0x0000ff, 0xff5500, 0x7700ff, 0xffff00, 0xffffff]

/** 解析 87 应答；预置色按 options 低 4 位索引展开，FAFAFA 归一为 FFFFFF。 */
export function parseLight(response: number[]): LightSettings {
  if (!Array.isArray(response) || response.length !== 64 || response[0] !== 0x87) {
    throw new ProtocolError('无效的灯效应答。')
  }
  const s: LightSettings = {
    mode: response[1]!, speed: response[2]!, brightness: response[3]!,
    options: response[4]!, red: response[5]!, green: response[6]!, blue: response[7]!,
  }
  const colorIndex = s.options & 15
  if (colorIndex < PALETTE.length) {
    const rgb = PALETTE[colorIndex]!
    s.red = (rgb >> 16) & 255
    s.green = (rgb >> 8) & 255
    s.blue = rgb & 255
  }
  if (s.red === 250 && s.green === 250 && s.blue === 250) {
    s.red = 255; s.green = 255; s.blue = 255
  }
  return s
}

export function lightUISpeed(s: LightSettings): number {
  return 4 - s.speed
}

/** 06 键盘选项帧：bit4 为独立关灯门控（硬件快捷键用；软件开关灯不碰它）。 */
export function keyboardOptionsFrame(response: number[], ledEnabled: boolean): Frame {
  if (!Array.isArray(response) || response.length !== 64 || response[0] !== 0x86) {
    throw new ProtocolError('无效的键盘选项应答。')
  }
  const data = response.slice(0, 7)
  data[0] = 0x06
  data[2] = ledEnabled ? data[2]! & 0xef : data[2]! | 0x10
  return frame(data)
}

/** 宏写入帧（0x16）：5 × 56 字节分块，最后一块 lastFlag=1，尾部补零清旧数据。 */
export function macroFrames(slot: number, bytes: number[]): Frame[] {
  if (!(slot >= 0 && slot < 50) || !Array.isArray(bytes) || bytes.length !== 256) {
    throw new ProtocolError('宏槽必须为 0…49 且数据为 256 字节。')
  }
  const frames: Frame[] = []
  for (let chunk = 0; chunk < 5; chunk++) {
    const data = frame([0x16, slot, chunk, 56, chunk === 4 ? 1 : 0])
    const start = chunk * 56
    const end = Math.min(start + 56, bytes.length)
    for (let i = start; i < end; i++) data[8 + (i - start)] = bytes[i]!
    frames.push(data)
  }
  return frames
}

// ---- 设备信息解析 ----

function decodeReport(info: DeviceInfo, code: string, expectFirst?: number): number[] | null {
  const raw = info.reports[code]
  if (typeof raw !== 'string') return null
  let bytes: number[]
  try {
    bytes = hexDecode(raw)
  } catch {
    return null
  }
  if (bytes.length !== 64) return null
  if (expectFirst !== undefined && bytes[0] !== expectFirst) return null
  return bytes
}

export function infoFirmwareRevision(info: DeviceInfo): number | null {
  const bytes = decodeReport(info, '80', 0x80)
  return bytes ? (bytes[1]! | (bytes[2]! << 8)) : null
}

export function infoFirmware(info: DeviceInfo): string {
  const revision = infoFirmwareRevision(info)
  if (revision === null) return '?'
  return `${(revision >> 8).toString(16)}.${(revision & 255).toString(16).padStart(2, '0')}`
}

export function infoDeviceID(info: DeviceInfo): number | null {
  const bytes = decodeReport(info, '8f', 0x8f)
  return bytes ? (bytes[1]! | (bytes[2]! << 8)) : null
}

/** 仅设备 983 且固件 1.04/1.08 允许写入；其余只读展示。 */
export function infoSupportsConfiguration(info: DeviceInfo): boolean {
  return infoDeviceID(info) === 983 && [0x0104, 0x0108].includes(infoFirmwareRevision(info) ?? -1)
}

export function infoProfile(info: DeviceInfo): number {
  const bytes = decodeReport(info, '85')
  return bytes ? bytes[1]! : -1
}

export function infoLight(info: DeviceInfo): LightSettings | null {
  const bytes = decodeReport(info, '87')
  if (!bytes) return null
  try {
    return parseLight(bytes)
  } catch {
    return null
  }
}

export function infoKeyboardOptions(info: DeviceInfo): number[] | null {
  return decodeReport(info, '86')
}

export function infoLightsEnabled(info: DeviceInfo): boolean {
  const options = infoKeyboardOptions(info)
  const light = infoLight(info)
  if (!options || !light) return false
  return (options[2]! & 0x10) === 0 && light.mode !== 0 && light.brightness > 0
}

export function mergeInfo(oldInfo: DeviceInfo, newInfo: DeviceInfo): DeviceInfo {
  return { reports: { ...oldInfo.reports, ...newInfo.reports } }
}

// ---- 配置快照（schema 2，与原生客户端互通）----

export function makeSnapshot(
  info: DeviceInfo,
  matrix: number[],
  options: { name?: string | null; fnMatrix?: number[] | null; macros?: Record<number, number[]> } = {},
): Snapshot {
  const macros = options.macros ?? {}
  const snapshot: Snapshot = {
    schema: 2,
    device: 'RongYuan M1W 3151:4015',
    createdAt: new Date().toISOString(),
    info: { reports: { ...info.reports } },
    keymapHex: hexEncode(matrix),
    name: options.name ?? null,
    fnKeymapHex: null,
    macroHex: null,
  }
  snapshot.fnKeymapHex = options.fnMatrix ? hexEncode(options.fnMatrix) : null
  snapshot.macroHex = Object.keys(macros).length
    ? Object.fromEntries(Object.entries(macros).map(([k, v]) => [k, hexEncode(v)]))
    : null
  return snapshot
}

export function snapshotValidatedMatrix(s: Snapshot): number[] {
  const matrix = hexDecode(s.keymapHex)
  if (![1, 2].includes(s.schema) || s.device !== 'RongYuan M1W 3151:4015' ||
      infoProfile(s.info) !== 0 || matrix.length !== 512 || !matrix.some((b) => b !== 0) ||
      !infoLight(s.info)) {
    throw new ProtocolError('不支持或不完整的配置。当前版本支持配置 0 的基础层。')
  }
  return matrix
}

export function snapshotValidatedFnMatrix(s: Snapshot): number[] | null {
  if (!s.fnKeymapHex) return null
  const bytes = hexDecode(s.fnKeymapHex)
  if (bytes.length !== 512) throw new ProtocolError('Fn 矩阵必须为 512 字节。')
  return bytes
}

export function snapshotValidatedMacros(s: Snapshot): Record<number, number[]> {
  const result: Record<number, number[]> = {}
  for (const [slotText, hex] of Object.entries(s.macroHex ?? {})) {
    const slot = Number(slotText)
    if (!(slot >= 0 && slot < 50)) throw new ProtocolError('配置中的宏槽编号无效。')
    const data = hexDecode(hex)
    if (data.length !== 256) throw new ProtocolError('配置中的宏大小无效。')
    result[slot] = data
  }
  return result
}

export function snapshotIsCompatible(s: Snapshot, current: DeviceInfo): boolean {
  return infoSupportsConfiguration(current) && infoProfile(current) === 0 &&
    infoProfile(s.info) === 0 &&
    (infoDeviceID(s.info) === null || infoDeviceID(s.info) === 983) &&
    [0x0104, 0x0108].includes(infoFirmwareRevision(s.info) ?? -1)
}

// ---- 按键功能目录 ----

export const KEY_FUNCTIONS: KeyAction[] = [
  { id: 'knob-mode', name: '切换旋钮：音量 / 灯光亮度', category: '旋钮', record: [10, 14, 0, 0] },
  { id: 'light-toggle', name: '键盘灯光开关', category: '灯光', record: [10, 9, 0, 0] },
  { id: 'light-brighter', name: '键盘灯光亮度 +', category: '灯光', record: [13, 2, 1, 0] },
  { id: 'light-dimmer', name: '键盘灯光亮度 −', category: '灯光', record: [13, 2, 2, 0] },
  { id: 'light-faster', name: '灯效速度 +', category: '灯光', record: [13, 3, 2, 0] },
  { id: 'light-slower', name: '灯效速度 −', category: '灯光', record: [13, 3, 1, 0] },
  { id: 'light-left', name: '灯效方向向左', category: '灯光', record: [13, 5, 0, 2] },
  { id: 'light-right', name: '灯效方向向右', category: '灯光', record: [13, 5, 0, 1] },
  { id: 'light-color', name: '灯光颜色循环', category: '灯光', record: [13, 5, 1, 0] },
  { id: 'light-group-home', name: '切换灯效组 · Home', category: '灯光', record: [13, 1, 4, 0] },
  { id: 'light-group-pgup', name: '切换灯效组 · PgUp', category: '灯光', record: [13, 1, 5, 0] },
  { id: 'light-group-pgdn', name: '切换灯效组 · PgDn', category: '灯光', record: [13, 1, 6, 0] },
  { id: 'light-group-end', name: '切换灯效组 · End', category: '灯光', record: [13, 1, 7, 0] },
  { id: 'play', name: '播放 / 暂停', category: '媒体', record: [3, 0, 205, 0] },
  { id: 'stop', name: '停止播放', category: '媒体', record: [3, 0, 183, 0] },
  { id: 'mute', name: '静音', category: '媒体', record: [3, 0, 226, 0] },
  { id: 'previous', name: '上一曲', category: '媒体', record: [3, 0, 182, 0] },
  { id: 'next', name: '下一曲', category: '媒体', record: [3, 0, 181, 0] },
  { id: 'volume-up', name: '音量 +', category: '媒体', record: [3, 0, 233, 0] },
  { id: 'volume-down', name: '音量 −', category: '媒体', record: [3, 0, 234, 0] },
  { id: 'player', name: '打开播放器', category: '系统', record: [3, 0, 131, 1] },
  { id: 'email', name: '打开邮件', category: '系统', record: [3, 0, 138, 1] },
  { id: 'computer', name: '打开我的电脑', category: '系统', record: [3, 0, 148, 1] },
  { id: 'browser-home', name: '浏览器主页', category: '系统', record: [3, 0, 35, 2] },
  { id: 'display-dimmer', name: '屏幕亮度 −', category: '系统', record: [3, 0, 112, 0] },
  { id: 'display-brighter', name: '屏幕亮度 +', category: '系统', record: [3, 0, 111, 0] },
  { id: 'siri', name: '呼出 Siri', category: '系统', record: [18, 0, 227, 44] },
  { id: 'disabled', name: '禁用', category: '其他', record: [0, 0, 0, 0] },
]

const KNOB_NAMES = ['U-', 'Volume<->Brightness', 'U+']

export function isKnobKey(key: PhysicalKey): boolean {
  return KNOB_NAMES.includes(key.name)
}

/** 修饰键统一显示名（Mac 命名，显式左右），不依赖键帽板印（Ctrl/Win/Alt）。 */
export const MODIFIER_LABELS: Record<number, string> = {
  224: '左 Control', 225: '左 Shift', 226: '左 Option', 227: '左 Command',
  228: '右 Control', 229: '右 Shift', 230: '右 Option', 231: '右 Command',
}

export function keyDisplayName(key: PhysicalKey): string {
  switch (key.name) {
    case 'U-': return '旋钮逆时针'
    case 'U+': return '旋钮顺时针'
    case 'Volume<->Brightness': return '旋钮按下'
    case '(space)': return 'Space'
    case 'Shift': return '左 Shift'
    case 'Alt': return '左 Option'
    case 'Win': return '左 Command'
    case 'Ctrl': return '左 Control'
    case 'r_Shift': return '右 Shift'
    case 'r_Alt': return '右 Option'
    case 'r_Ctrl': return '右 Control'
    case 'BackSpace': return 'Backspace'
    default: return key.name.replaceAll('\n', ' ')
  }
}

export function allActions(definition: DeviceDefinition): KeyAction[] {
  const physical: KeyAction[] = definition.keys.map((k) => ({
    id: `physical-${k.index}`, name: keyDisplayName(k), category: '按键', record: k.record,
  }))
  // 板上没有实体键位的修饰 usage（如右侧 Control/Shift/Option/Command）
  // 也是合法的改键目标；补成可选条目。Fn 无 HID usage，不可指定。
  const present = new Set(
    definition.keys.filter((k) => k.record[0] === 0 && k.record[1] === 0 && k.record[3] === 0)
      .map((k) => k.record[2]))
  const modifiers: KeyAction[] = []
  for (let usage = 224; usage <= 231; usage++) {
    if (!present.has(usage)) {
      modifiers.push({
        id: `modifier-${usage}`,
        name: usageName(usage, definition),
        category: '按键',
        record: [0, 0, usage, 0],
      })
    }
  }
  return physical.concat(modifiers).concat(KEY_FUNCTIONS)
}

export function usageName(usage: number, definition: DeviceDefinition): string {
  switch (usage) {
    case 0: return '无'
    case 224: return 'Control'
    case 225: return 'Shift'
    case 226: return 'Option'
    case 227: return 'Command'
    case 228: return '右 Control'
    case 229: return '右 Shift'
    case 230: return '右 Option'
    case 231: return '右 Command'
    default: {
      const key = definition.keys.find((k) =>
        k.record[0] === 0 && k.record[1] === 0 && k.record[3] === 0 && k.record[2] === usage)
      return key ? keyDisplayName(key) : `HID ${usage.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }
}

export function recordsEqual(a: number[] | null | undefined, b: number[] | null | undefined): boolean {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
}

export function recordLabel(record: KeyRecord | null, definition: DeviceDefinition): string {
  if (!Array.isArray(record) || record.length !== 4) return '未读取'
  const fn = KEY_FUNCTIONS.find((a) => recordsEqual(a.record, record))
  if (fn) return fn.name
  // 修饰键映射统一用 Mac 命名，避免命中物理键的板印名（右 Alt/右 Ctrl）。
  if (record[0] === 0 && record[1] === 0 && record[3] === 0 && MODIFIER_LABELS[record[2]!]) {
    return MODIFIER_LABELS[record[2]!]!
  }
  const key = definition.keys.find((k) => recordsEqual(k.record, record))
  if (key) return keyDisplayName(key)
  if (record[0] === 0) {
    return record.slice(1).filter((b) => b !== 0).map((u) => usageName(u, definition)).join(' + ')
  }
  if (record[0] === 9) {
    const playback = PLAYBACKS.find((p) => p.rawValue === record[1])
    return `宏 ${record[2]! + 1} · ${playback ? playback.label : '未知模式'}`
  }
  if (record[0] === 8 && record[1] === 0 && record[2] === 4 && record[3]! <= 4) {
    return `切换键盘配置 ${record[3]! + 1}`
  }
  const original = definition.keys.find((k) =>
    recordsEqual(definition.defaultFnMatrix.slice(k.index * 4, k.index * 4 + 4), record))
  if (original) return `原厂 Fn + ${keyDisplayName(original)}`
  return '自定义功能'
}

/** 组合键：修饰位是 HID usage（E0…E7）而非位掩码；最多三个同时按下的 usage。 */
export function chord(primary: number, modifiers: number[], secondary = 0): KeyRecord {
  const sorted = [...modifiers].sort((a, b) => a - b)
  const totalUsages = sorted.length + (secondary === 0 ? 1 : 2)
  if (!(primary >= 4 && primary <= 231) || !sorted.every((m) => m >= 224 && m <= 231) ||
      new Set(sorted).size !== sorted.length || totalUsages > 3) {
    throw new ProtocolError('组合键最多同时包含三个按键；更复杂的组合请使用宏。')
  }
  const extra = sorted.length > 1 ? sorted[1]! : secondary
  return [0, sorted[0] ?? 0, primary, extra]
}

export const PLAYBACKS = [
  { rawValue: 0 as const, label: '指定次数' },
  { rawValue: 1 as const, label: '按一次开始 / 再按停止' },
  { rawValue: 2 as const, label: '按住重复' },
]

// ---- 键盘宏编解码 ----

export function macroEncoded(macro: KeyboardMacro): number[] {
  const { repeatCount, events } = macro
  if (!Number.isInteger(repeatCount) || !(repeatCount >= 1 && repeatCount <= 65535) || events.length === 0 || events.length > 62) {
    throw new ProtocolError('宏需包含 1…62 个按下/松开事件，重复次数为 1…65535。')
  }
  const bytes = new Array(256).fill(0)
  bytes[0] = repeatCount & 255
  bytes[1] = repeatCount >> 8
  const held = new Set<number>()
  events.forEach((event, i) => {
    if (!Number.isInteger(event.usage) || !Number.isInteger(event.delay) ||
        !(event.usage >= 4 && event.usage <= 239) || !(event.delay >= 0 && event.delay <= 65535)) {
      throw new ProtocolError('宏按键或延时超出范围。')
    }
    if (event.down) {
      if (held.has(event.usage)) throw new ProtocolError(`第 ${i + 1} 个事件重复按下，需先松开。`)
      held.add(event.usage)
    } else {
      if (!held.has(event.usage)) throw new ProtocolError(`第 ${i + 1} 个事件在按下之前松开。`)
      held.delete(event.usage)
    }
    const offset = 2 + i * 4
    bytes[offset] = event.usage
    bytes[offset + 1] = event.down ? 128 : 0
    bytes[offset + 2] = event.delay & 255
    bytes[offset + 3] = event.delay >> 8
  })
  if (held.size !== 0) throw new ProtocolError('宏结尾仍有按键未松开，请补上松开事件。')
  return bytes
}

export function macroDecoded(bytes: number[]): KeyboardMacro {
  if (!Array.isArray(bytes) || bytes.length !== 256) throw new ProtocolError('宏数据必须为 256 字节。')
  const macro: KeyboardMacro = { repeatCount: bytes[0]! | (bytes[1]! << 8), events: [] }
  let offset = 2
  while (offset + 1 < bytes.length) {
    const usage = bytes[offset]!
    const flags = bytes[offset + 1]!
    if (usage === 0 && flags === 0 &&
        bytes.slice(offset, offset + 4).every((b) => b === 0)) break
    if (!(usage >= 4 && usage <= 239)) {
      throw new ProtocolError('此宏含鼠标或其他事件，可保存和恢复原始数据，当前编辑器只编辑键盘事件。')
    }
    const compactDelay = flags & 127
    let delay: number
    if (compactDelay > 0) {
      delay = compactDelay
      offset += 2
    } else {
      if (offset + 3 >= bytes.length) throw new ProtocolError('宏延时数据不完整。')
      delay = bytes[offset + 2]! | (bytes[offset + 3]! << 8)
      offset += 4
    }
    macro.events.push({ usage, down: (flags & 128) !== 0, delay })
  }
  return macro
}

export { QUERIES as QUERIES_SET, BULK_RESPONSE_CMDS }
