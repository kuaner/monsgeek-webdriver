import { describe, expect, it, vi } from 'vitest'
import { DongleHIDTransport, parseDongleStatus } from '../src/lib/protocol/dongle'
import { M1WClient } from '../src/lib/protocol/client'
import type { Frame, ReportTransport } from '../src/lib/protocol/types'
import { MockKeyboard } from '../src/lib/protocol/mock'

const status = (ready = false, battery = 75): Frame => [ready ? 1 : 0, battery, 0, 0, 1, 1, 1, 0, 0, ...Array(55).fill(0)]

describe('2.4G 接收器', () => {
  it('解析在线状态和电量，拒绝全零及普通键盘应答', () => {
    expect(parseDongleStatus(status(true))).toMatchObject({ replyReady: true, battery: 75, keyboardOnline: true, canSend: true })
    expect(parseDongleStatus(Array(64).fill(0))).toBeNull()
    expect(parseDongleStatus([0x8f, 0xd7, 3, ...Array(61).fill(0)])).toBeNull()
    expect(parseDongleStatus(status(false, 101))?.battery).toBeNull()
  })

  it('选择键盘、等待应答并用 FC 取出键盘数据', async () => {
    const writes: Frame[] = []
    const replies = [status(), status(true), [0x80, 8, 1, ...Array(61).fill(0)]]
    const raw: ReportTransport = {
      write: vi.fn(async (request: Frame) => { writes.push(request) }),
      read: vi.fn(async () => replies.shift()!),
    }
    const battery = vi.fn()
    const transport = new DongleHIDTransport(raw, battery, () => {})
    const client = new M1WClient(transport, () => {})
    expect((await client.query(0x80)).slice(0, 3)).toEqual([0x80, 8, 1])
    expect(writes.map((request) => request.slice(0, 2))).toEqual([
      [0xf7, 0], [0xf6, 10], [0x80, 0], [0xf7, 0], [0xfc, 0],
    ])
    expect(battery).toHaveBeenLastCalledWith(75)
  })

  it('保持中继目标选择，完整读取键位页', async () => {
    const keyboard = new MockKeyboard()
    const writes: Frame[] = []
    let ready = false
    let fetchReply = false
    const raw: ReportTransport = {
      write: async (request) => {
        writes.push(request)
        if (request[0] === 0xf7 || request[0] === 0xf6 || request[0] === 0xfc) {
          fetchReply = request[0] === 0xfc
          return
        }
        await keyboard.write(request)
        ready = true
      },
      read: async () => {
        if (fetchReply) { fetchReply = false; ready = false; return keyboard.read() }
        return status(ready)
      },
    }
    const transport = new DongleHIDTransport(raw, () => {}, () => {})
    const client = new M1WClient(transport, () => {})
    expect((await client.readMatrix({ verify: false })).length).toBe(512)
    expect(writes.filter((request) => request[0] === 0xf6)).toHaveLength(1)
    expect(writes.filter((request) => request[0] === 0x89)).toHaveLength(8)
  })

  it('键盘离线时不转发配置帧', async () => {
    const raw: ReportTransport = {
      write: vi.fn(async () => {}),
      read: vi.fn(async () => { const reply = status(); reply[3] = 1; return reply }),
    }
    const transport = new DongleHIDTransport(raw, () => {}, () => {})
    await expect(transport.write([0x13, ...Array(63).fill(0)])).rejects.toThrow('键盘离线')
    expect(raw.write).toHaveBeenCalledOnce()
  })
})
