import { describe, expect, it, vi } from 'vitest'
import { BluetoothHIDTransport, hasBluetoothCollection } from '../src/lib/protocol/bluetooth'
import { M1WClient } from '../src/lib/protocol/client'
import { frame, QUERIES } from '../src/lib/protocol/core'
import { MockKeyboard } from '../src/lib/protocol/mock'

class FakeHID extends EventTarget {
  opened = true
  sendReport = vi.fn(async (_reportId: number, _data: BufferSource) => {})
  asDevice(): HIDDevice { return this as unknown as HIDDevice }
  input(reportId: number, data: number[]): void {
    const event = new Event('inputreport')
    Object.defineProperties(event, { reportId: { value: reportId }, data: { value: new DataView(Uint8Array.from(data).buffer) } })
    this.dispatchEvent(event)
  }
}

describe('蓝牙 HID 传输', () => {
  it('只识别有 Report 6 输入和输出的蓝牙厂商集合', () => {
    const vendor: HIDCollectionInfo = {
      usagePage: 0xff55, usage: 0x0202,
      inputReports: [{ reportId: 6 }], outputReports: [{ reportId: 6 }],
    }
    expect(hasBluetoothCollection({ collections: [vendor] } as HIDDevice)).toBe(true)
    expect(hasBluetoothCollection({ collections: [{ ...vendor, outputReports: [] }] } as HIDDevice)).toBe(false)
    expect(hasBluetoothCollection({ collections: [{ ...vendor, usage: 3 }] } as HIDDevice)).toBe(false)
  })

  it('用 Report 6 和 55 前缀发送，并缓存先于 read 到达的应答', async () => {
    const hid = new FakeHID()
    hid.sendReport.mockImplementation(async () => {
      hid.input(6, [0x55, 0x8f, 0xd7, 3, ...Array(61).fill(0)])
    })
    const transport = new BluetoothHIDTransport(hid.asDevice(), 0)
    await transport.write(frame([0x8f]))
    expect(hid.sendReport).toHaveBeenCalledOnce()
    expect(hid.sendReport.mock.calls[0]![0]).toBe(6)
    expect(Array.from(hid.sendReport.mock.calls[0]![1] as Uint8Array)).toEqual([0x55, ...frame([0x8f])])
    expect((await transport.read()).slice(0, 3)).toEqual([0x8f, 0xd7, 3])
    transport.dispose()
  })

  it('忽略其他报告、厂商事件和不匹配的查询应答', async () => {
    const hid = new FakeHID()
    const transport = new BluetoothHIDTransport(hid.asDevice(), 0)
    await transport.write(frame([0x80]))
    const reading = transport.read()
    hid.input(1, Array(65).fill(0))
    hid.input(6, [0x66, ...Array(64).fill(0)])
    hid.input(6, [0x55, 0x85, ...Array(63).fill(0)])
    hid.input(6, [0x55, 0x80, 8, 1, ...Array(61).fill(0)])
    expect((await reading).slice(0, 3)).toEqual([0x80, 8, 1])
    transport.dispose()
  })

  it('基础键位页没有命令回显，仍能返回完整 64 字节', async () => {
    const hid = new FakeHID()
    const transport = new BluetoothHIDTransport(hid.asDevice(), 0)
    await transport.write(frame([0x89, 0, 0]))
    const reading = transport.read()
    hid.input(6, [0x55, 0, 0, 0x29, 0, ...Array(60).fill(0)])
    expect((await reading).slice(0, 4)).toEqual([0, 0, 0x29, 0])
    transport.dispose()
  })

  it('响应超时后停止本次连接，不自动重发或接受下一条命令', async () => {
    const hid = new FakeHID()
    const transport = new BluetoothHIDTransport(hid.asDevice(), 0, 5)
    await transport.write(frame([0x80]))
    await expect(transport.read()).rejects.toThrow('超时')
    await expect(transport.write(frame([0x80]))).rejects.toThrow('中断')
    expect(hid.sendReport).toHaveBeenCalledOnce()
    transport.dispose()
  })

  it('仅首次只读设备 ID 握手超时时重试一次', async () => {
    const hid = new FakeHID()
    hid.sendReport.mockImplementation(async () => {
      if (hid.sendReport.mock.calls.length === 2) hid.input(6, [0x55, 0x8f, 0xd7, 3, ...Array(61).fill(0)])
    })
    const transport = new BluetoothHIDTransport(hid.asDevice(), 0, 5)
    await transport.write(frame([0x8f]))
    expect((await transport.read()).slice(0, 3)).toEqual([0x8f, 0xd7, 3])
    expect(hid.sendReport).toHaveBeenCalledTimes(2)
    transport.dispose()
  })

  it('发送过配置帧后不会自动重试设备 ID 查询', async () => {
    const hid = new FakeHID()
    const transport = new BluetoothHIDTransport(hid.asDevice(), 0, 5)
    await transport.write(frame([0x13]))
    await transport.write(frame([0x8f]))
    await expect(transport.read()).rejects.toThrow('超时')
    expect(hid.sendReport).toHaveBeenCalledTimes(2)
    transport.dispose()
  })

  it('发送失败时不重发；断开时取消等待并移除监听', async () => {
    const failed = new FakeHID()
    failed.sendReport.mockRejectedValue(new Error('failed'))
    const first = new BluetoothHIDTransport(failed.asDevice(), 0)
    await expect(first.write(frame([0x13]))).rejects.toThrow('发送失败')
    expect(failed.sendReport).toHaveBeenCalledOnce()
    first.dispose()

    const hid = new FakeHID()
    const transport = new BluetoothHIDTransport(hid.asDevice(), 0)
    await transport.write(frame([0x8f]))
    const reading = transport.read()
    transport.dispose()
    await expect(reading).rejects.toThrow('断开')
  })

  it('复用现有客户端完成改键和读回校验', async () => {
    const keyboard = new MockKeyboard()
    keyboard.revision = 0x0108
    const hid = new FakeHID()
    hid.sendReport.mockImplementation(async (_reportId, raw) => {
      const data = Array.from(raw as Uint8Array)
      const request = data.slice(1)
      await keyboard.write(request)
      if (QUERIES.has(request[0]!)) hid.input(6, [0x55, ...await keyboard.read()])
    })
    const transport = new BluetoothHIDTransport(hid.asDevice(), 0)
    const client = new M1WClient(transport, () => {})
    await client.setKey(78, [0, 0, 0x44, 0])
    expect(keyboard.matrix.slice(78 * 4, 78 * 4 + 4)).toEqual([0, 0, 0x44, 0])
    expect(keyboard.mutations.some((mutation) => mutation[0] === 0x13)).toBe(true)
    transport.dispose()
  })

  it('灯效和 Fn 宏沿用同一蓝牙传输及客户端校验流程', async () => {
    const keyboard = new MockKeyboard()
    keyboard.revision = 0x0108
    const hid = new FakeHID()
    hid.sendReport.mockImplementation(async (_reportId, raw) => {
      const request = Array.from(raw as Uint8Array).slice(1)
      await keyboard.write(request)
      if (QUERIES.has(request[0]!)) hid.input(6, [0x55, ...await keyboard.read()])
    })
    const transport = new BluetoothHIDTransport(hid.asDevice(), 0)
    const client = new M1WClient(transport, () => {})
    await client.setLight({ mode: 2, brightness: 3 })
    expect(keyboard.light.mode).toBe(2)
    expect(keyboard.light.brightness).toBe(3)
    const result = await client.assignMacro(78, { repeatCount: 1, events: [
      { usage: 4, down: true, delay: 1 }, { usage: 4, down: false, delay: 0 },
    ] }, 0, null, { fn: true })
    expect(result.verified).toBe(true)
    expect(keyboard.fn.slice(78 * 4, 78 * 4 + 4)).toEqual([9, 0, result.macroSlot, 0])
    expect(keyboard.mutations.some((mutation) => mutation[0] === 0x16)).toBe(true)
    transport.dispose()
  })
})
