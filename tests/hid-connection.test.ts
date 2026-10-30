import { afterEach, describe, expect, it, vi } from 'vitest'
import { Connection, M1W_BLUETOOTH_FILTERS, M1W_DONGLE_FILTERS, M1W_FILTERS } from '../src/lib/protocol/hid'

class FakeDevice extends EventTarget {
  opened = true
  constructor(readonly vendorId: number, readonly productId: number, readonly collections: object[]) { super() }
  close = vi.fn(async () => { this.opened = false })
  open = vi.fn(async () => { this.opened = true })
  forget = vi.fn(async () => {})
  asDevice(): HIDDevice { return this as unknown as HIDDevice }
}

const usbCollection = [{ usagePage: 0xffff, usage: 2 }]
const bluetoothCollection = [{ usagePage: 0xff55, usage: 0x0202,
  inputReports: [{ reportId: 6 }], outputReports: [{ reportId: 6 }] }]

function browser(devices: FakeDevice[], selected: FakeDevice[] = devices) {
  const hid = new EventTarget() as EventTarget & {
    getDevices: ReturnType<typeof vi.fn>
    requestDevice: ReturnType<typeof vi.fn>
  }
  hid.getDevices = vi.fn(async () => devices.map((device) => device.asDevice()))
  hid.requestDevice = vi.fn(async () => selected.map((device) => device.asDevice()))
  vi.stubGlobal('navigator', { hid })
  return hid
}

afterEach(() => vi.unstubAllGlobals())

describe('连接方式', () => {
  it('只自动连接所选传输，并在切换时释放旧连接', async () => {
    const usb = new FakeDevice(0x3151, 0x4015, usbCollection)
    const bluetooth = new FakeDevice(0x3151, 0x4013, bluetoothCollection)
    browser([usb, bluetooth])
    const connection = new Connection()
    expect(await connection.autoConnect('usb')).toBe(true)
    expect(connection.mode).toBe('usb')
    expect(connection.transport()).toBe(connection.transport())
    expect(await connection.requestAndConnect('bluetooth')).toBe(true)
    expect(usb.close).toHaveBeenCalledOnce()
    expect(usb.forget).not.toHaveBeenCalled()
    expect(connection.mode).toBe('bluetooth')
    expect(connection.transport()).toBe(connection.transport())
    await connection.disconnect()
    expect(bluetooth.close).toHaveBeenCalledOnce()
    expect(connection.connected).toBe(false)
  })

  it('新蓝牙连接使用蓝牙过滤器，并拒绝没有配置集合的设备', async () => {
    const wrong = new FakeDevice(0x3151, 0x4013, [])
    const hid = browser([], [wrong])
    const connection = new Connection()
    await expect(connection.requestAndConnect('bluetooth')).rejects.toThrow('没有可用的 M1W 蓝牙配置通道')
    expect(hid.requestDevice).toHaveBeenCalledWith({ filters: M1W_BLUETOOTH_FILTERS })
  })

  it('主动连接时即使设备已经授权，也显示设备选择', async () => {
    const bluetooth = new FakeDevice(0x3151, 0x4013, bluetoothCollection)
    const hid = browser([bluetooth])
    const connection = new Connection()
    expect(await connection.requestAndConnect('bluetooth')).toBe(true)
    expect(hid.requestDevice).toHaveBeenCalledWith({ filters: M1W_BLUETOOTH_FILTERS })
    await connection.disconnect()
  })

  it('多把已授权的蓝牙键盘需要从列表选择', async () => {
    const first = new FakeDevice(0x3151, 0x4013, bluetoothCollection)
    const second = new FakeDevice(0x3151, 0x4013, bluetoothCollection)
    const hid = browser([first, second], [second])
    const connection = new Connection()
    expect(await connection.autoConnect('bluetooth')).toBe(false)
    expect(await connection.requestAndConnect('bluetooth')).toBe(true)
    expect(hid.requestDevice).toHaveBeenCalledWith({ filters: M1W_BLUETOOTH_FILTERS })
    expect(connection.device).toBe(second.asDevice())
    await connection.disconnect()
  })

  it('有线重新授权使用原有过滤器，并保留原有忘记授权行为', async () => {
    const usb = new FakeDevice(0x3151, 0x4015, usbCollection)
    const hid = browser([usb])
    const connection = new Connection()
    await connection.autoConnect('usb')
    await connection.requestAndConnect('usb')
    expect(usb.forget).toHaveBeenCalledOnce()
    expect(hid.requestDevice).toHaveBeenCalledWith({ filters: M1W_FILTERS })
    await connection.disconnect()
  })

  it('2.4G 只连接接收器厂商集合并使用接收器专用过滤器', async () => {
    const dongle = new FakeDevice(0x3151, 0x4011, usbCollection)
    const usb = new FakeDevice(0x3151, 0x4015, usbCollection)
    const hid = browser([usb, dongle], [dongle])
    const connection = new Connection()
    expect(await connection.autoConnect('dongle')).toBe(true)
    expect(connection.device).toBe(dongle.asDevice())
    await connection.disconnect()
    expect(await connection.requestAndConnect('dongle')).toBe(true)
    expect(hid.requestDevice).toHaveBeenCalledWith({ filters: M1W_DONGLE_FILTERS })
    expect(connection.mode).toBe('dongle')
    await connection.disconnect()
  })
})
