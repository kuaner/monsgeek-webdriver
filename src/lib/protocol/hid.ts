// WebHID 连接管理：有线使用 Feature Report，蓝牙使用厂商 Input/Output Report。

import type { Frame, ReportTransport } from './types'
import { BluetoothHIDTransport, hasBluetoothCollection } from './bluetooth'

export type ConnectionMode = 'usb' | 'bluetooth'

export const M1W_FILTERS: HIDDeviceFilter[] = [
  { vendorId: 0x3151, usagePage: 0xffff, usage: 0x0002 },
]
export const M1W_BLUETOOTH_FILTERS: HIDDeviceFilter[] = [
  { vendorId: 0x3151, productId: 0x4013 },
]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// 卡死状态下 device.open() 可能永久挂起：所有 open 都套超时。
async function openDevice(device: HIDDevice, timeoutMs = 3000): Promise<void> {
  await Promise.race([
    device.open(),
    sleep(timeoutMs).then(() => {
      throw new Error('设备打开超时。')
    }),
  ])
}

function hasVendorFeatureCollection(device: HIDDevice): boolean {
  const walk = (collections: HIDCollectionInfo[]): boolean =>
    (collections ?? []).some((c) => (c.usagePage === 0xffff && c.usage === 0x0002) || walk(c.children ?? []))
  return walk(device.collections ?? [])
}

function isM1W(device: HIDDevice, mode: ConnectionMode): boolean {
  if (device.vendorId !== 0x3151) return false
  return mode === 'bluetooth'
    ? device.productId === 0x4013 && hasBluetoothCollection(device)
    : hasVendorFeatureCollection(device)
}

export class WebHIDTransport implements ReportTransport {
  constructor(private device: HIDDevice) {}

  private get hid(): HIDDevice {
    return this.device
  }

  /**
   * 偶发瞬时失败（设备短暂 STALL）时 close→open 后重试一次；
   * 持续失败说明设备卡死，需要用户重新走一次授权框恢复。
   */
  private async runWithHeal<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    } catch (first) {
      await sleep(300)
      try {
        try {
          if (this.hid.opened) await this.hid.close()
        } catch {
          /* 关闭失败可忽略 */
        }
        await openDevice(this.hid)
        return await action()
      } catch {
        throw first
      }
    }
  }

  async write(frame: Frame): Promise<void> {
    if (!Array.isArray(frame) || frame.length !== 64) {
      throw new Error('USB 报告必须为 64 字节。')
    }
    const report = Uint8Array.from(frame)
    await this.runWithHeal(() => this.hid.sendFeatureReport(0, report))
  }

  async read(): Promise<Frame> {
    return this.runWithHeal(async () => {
      const view = await this.hid.receiveFeatureReport(0)
      const bytes = Array.from(view.buffer
        ? new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
        : (view as unknown as ArrayLike<number>))
      if (bytes.length !== 64) throw new Error(`HID 应答长度不足：${bytes.length}/64 字节。`)
      return bytes as Frame
    })
  }
}

type ConnectionListener = () => void

/** 连接管理：按所选方式复用授权，并在切换或断开时释放传输。 */
export class Connection {
  device: HIDDevice | null = null
  connected = false
  mode: ConnectionMode | null = null
  private activeTransport: WebHIDTransport | BluetoothHIDTransport | null = null

  constructor(private readonly onChange?: ConnectionListener) {
    navigator.hid?.addEventListener('disconnect', (event) => {
      if (this.device === event.device) {
        if (this.activeTransport instanceof BluetoothHIDTransport) this.activeTransport.dispose()
        this.activeTransport = null
        this.device = null
        this.connected = false
        this.mode = null
        this.onChange?.()
      }
    })
  }

  get supported(): boolean {
    return 'hid' in navigator
  }

  /** 静默尝试已授权设备；返回是否成功。 */
  async autoConnect(mode: ConnectionMode = 'usb'): Promise<boolean> {
    if (!this.supported) return false
    if (this.connected) return this.mode === mode
    const devices = await navigator.hid.getDevices()
    const matches = devices.filter((device) => isM1W(device, mode))
    // 多把已授权蓝牙键盘时让用户选择，避免静默连接到错误设备。
    const found = mode === 'bluetooth' && matches.length !== 1 ? undefined : matches[0]
    if (!found) return false
    return this.adopt(found, mode)
  }

  /** 用户手势触发；实测 Chrome 连接层卡死时只有完整授权周期能恢复。 */
  async requestAndConnect(mode: ConnectionMode = 'usb'): Promise<boolean> {
    if (!this.supported) throw new Error('此浏览器不支持 WebHID（需 Chrome / Edge / Chromium 内核）。')
    // 先释放旧句柄/授权：Chrome 连接层卡死时 forget() 强制下次 requestDevice
    // 建立全新连接（键盘本身健康，问题出在 Chrome 侧连接复用）。
    if (this.device) {
      if (this.activeTransport instanceof BluetoothHIDTransport) this.activeTransport.dispose()
      this.activeTransport = null
      try {
        if (this.device.opened) await this.device.close()
      } catch { /* 忽略 */ }
      if (this.mode === mode && mode === 'usb') {
        try { await this.device.forget() } catch { /* 未授权或已释放 */ }
      }
      this.device = null
      this.connected = false
      this.mode = null
    }
    let devices: HIDDevice[] = []
    try {
      devices = await navigator.hid.requestDevice({ filters: mode === 'bluetooth' ? M1W_BLUETOOTH_FILTERS : M1W_FILTERS })
    } catch (error) {
      throw new Error(`未选择设备：${error instanceof Error ? error.message : String(error)}`)
    }
    if (!devices.length) throw new Error('未选择设备。')
    const found = devices.find((device) => isM1W(device, mode))
    if (!found) throw new Error(mode === 'bluetooth'
      ? '所选设备没有可用的 M1W 蓝牙配置通道。'
      : '所选设备不是 M1W 的厂商功能集合，请选择 MonsGeek Keyboard。')
    return this.adopt(found, mode)
  }

  async adopt(device: HIDDevice, mode: ConnectionMode = 'usb'): Promise<boolean> {
    if (!device.opened) await openDevice(device)
    this.device = device
    this.connected = true
    this.mode = mode
    this.activeTransport = mode === 'bluetooth' ? new BluetoothHIDTransport(device) : new WebHIDTransport(device)
    this.onChange?.()
    return true
  }

  async disconnect(): Promise<void> {
    const previous = this.device
    if (this.activeTransport instanceof BluetoothHIDTransport) this.activeTransport.dispose()
    this.activeTransport = null
    this.device = null
    this.connected = false
    this.mode = null
    if (previous?.opened) await previous.close()
    this.onChange?.()
  }

  /** 上层在通信失败后尝试一次自愈；成功返回 true。 */
  async heal(): Promise<boolean> {
    if (!this.device || !this.mode) return false
    try {
      if (this.activeTransport instanceof BluetoothHIDTransport) this.activeTransport.dispose()
      this.activeTransport = null
      if (this.device.opened) await this.device.close()
    } catch {
      /* 忽略 */
    }
    try {
      await openDevice(this.device)
      this.connected = true
      this.activeTransport = this.mode === 'bluetooth' ? new BluetoothHIDTransport(this.device) : new WebHIDTransport(this.device)
      return true
    } catch {
      this.connected = false
      this.onChange?.()
      return false
    }
  }

  transport(): ReportTransport {
    if (!this.device || !this.connected || !this.activeTransport) throw new Error('键盘未连接。')
    return this.activeTransport
  }
}
