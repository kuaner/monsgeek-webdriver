// M1W 协议类型定义。字节统一用 number（0…255）；64 字节帧为定长 number[64]。

/** BIT7=0, BIT8=1, NONE=2（厂商 protobuf 枚举原值）。 */
export type Checksum = 0 | 1 | 2

export const BIT7: Checksum = 0
export const BIT8: Checksum = 1
export const NONE: Checksum = 2

/** 64 字节控制帧。 */
export type Frame = number[]

/** 四字节按键记录（矩阵中的一个键位）。 */
export type KeyRecord = number[]

export interface LightSettings {
  mode: number
  speed: number
  brightness: number
  options: number
  red: number
  green: number
  blue: number
}

export interface MacroEvent {
  usage: number
  down: boolean
  delay: number
}

export interface KeyboardMacro {
  repeatCount: number
  events: MacroEvent[]
}

/** 各查询命令的原始应答，键为两位十六进制命令码。 */
export interface DeviceInfo {
  reports: Record<string, string>
}

export interface PhysicalKey {
  name: string
  index: number
  record: KeyRecord
  x: number
  y: number
  width: number
  height: number
}

export interface DeviceDefinition {
  model: string
  vendorID: number
  productID: number
  keys: PhysicalKey[]
  defaultMatrix: number[]
  defaultFnMatrix: number[]
}

export interface KeyAction {
  id: string
  name: string
  category: string
  record: KeyRecord
}

export interface Playback {
  rawValue: 0 | 1 | 2
  label: string
}

export interface ChangeResult {
  changedKeyIndices: number[]
  lightChanged: boolean
  verified: boolean
  macroSlot?: number
}

/** 手动保存的配置方案；schema 2 与原生客户端完全互通。 */
export interface Snapshot {
  schema: number
  device: string
  createdAt: string
  info: DeviceInfo
  keymapHex: string
  name: string | null
  fnKeymapHex: string | null
  macroHex: Record<string, string> | null
}

export interface StoredProfile {
  id: string
  name: string
  snapshot: Snapshot
}

/** 底层传输接口：WebHID 实现与测试模拟器共用。 */
export interface ReportTransport {
  write(frame: Frame): Promise<void>
  read(): Promise<Frame>
}

export type Pause = (ms: number) => Promise<void> | void
