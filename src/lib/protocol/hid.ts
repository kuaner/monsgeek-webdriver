// WebHID 传输层 — 打开 M1W 接口 2 的厂商 Feature 集合（usagePage 0xFFFF / usage 0x0002）。
// 固件实测忽略 wIndex，因此经该集合的 SET/GET_REPORT 与原驱动 EP0 通道等价
//（protocol-notes.md §10）。仅 Chromium 系浏览器支持。

import type { Frame, ReportTransport } from './types'

export const M1W_FILTERS: HIDDeviceFilter[] = [
  { vendorId: 0x3151, usagePage: 0xffff, usage: 0x0002 },
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
  const walk = (collections: HIDCollection[]): boolean =>
    (collections ?? []).some((c) => c.usagePage === 0xffff || walk(c.collections ?? []))
  return walk(device.collections ?? [])
}

function isM1W(device: HIDDevice): boolean {
  return device.vendorId === 0x3151 && hasVendorFeatureCollection(device)
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

/** 连接管理：页面加载时静默复用已授权设备；「连接键盘」按钮永远走授权框。 */
export class Connection {
  device: HIDDevice | null = null
  connected = false

  constructor(private readonly onChange?: ConnectionListener) {
    navigator.hid?.addEventListener('disconnect', (event) => {
      if (this.device === event.device) {
        this.device = null
        this.connected = false
        this.onChange?.()
      }
    })
  }

  get supported(): boolean {
    return 'hid' in navigator
  }

  /** 静默尝试已授权设备；返回是否成功。 */
  async autoConnect(): Promise<boolean> {
    if (!this.supported) return false
    const devices = await navigator.hid.getDevices()
    const found = devices.find(isM1W)
    if (!found) return false
    return this.adopt(found)
  }

  /** 用户手势触发；实测 Chrome 连接层卡死时只有完整授权周期能恢复。 */
  async requestAndConnect(): Promise<boolean> {
    if (!this.supported) throw new Error('此浏览器不支持 WebHID（需 Chrome / Edge / Chromium 内核）。')
    // 先释放旧句柄/授权：Chrome 连接层卡死时 forget() 强制下次 requestDevice
    // 建立全新连接（键盘本身健康，问题出在 Chrome 侧连接复用）。
    if (this.device) {
      try {
        if (this.device.opened) await this.device.close()
      } catch { /* 忽略 */ }
      try { await this.device.forget() } catch { /* 未授权或已释放 */ }
      this.device = null
      this.connected = false
    }
    let devices: HIDDevice[] = []
    try {
      devices = await navigator.hid.requestDevice({ filters: M1W_FILTERS })
    } catch (error) {
      throw new Error(`未选择设备：${error instanceof Error ? error.message : String(error)}`)
    }
    if (!devices.length) throw new Error('未选择设备。')
    const found = devices.find(isM1W)
    if (!found) throw new Error('所选设备不是 M1W 的厂商功能集合，请选择 MonsGeek Keyboard。')
    return this.adopt(found)
  }

  async adopt(device: HIDDevice): Promise<boolean> {
    if (!device.opened) await openDevice(device)
    this.device = device
    this.connected = true
    this.onChange?.()
    return true
  }

  /** 上层在通信失败后尝试一次自愈；成功返回 true。 */
  async heal(): Promise<boolean> {
    if (!this.device) return false
    try {
      if (this.device.opened) await this.device.close()
    } catch {
      /* 忽略 */
    }
    try {
      await openDevice(this.device)
      this.connected = true
      return true
    } catch {
      this.connected = false
      this.onChange?.()
      return false
    }
  }

  transport(): ReportTransport {
    if (!this.device || !this.connected) throw new Error('键盘未连接。')
    return new WebHIDTransport(this.device)
  }
}
