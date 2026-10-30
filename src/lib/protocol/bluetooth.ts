import { QUERIES } from './core'
import type { Frame, ReportTransport } from './types'

const REPORT_ID = 0x06
const COMMAND_MARKER = 0x55
const BULK_QUERIES = new Set([0x89, 0x8b, 0x90])

type Pending = {
  command: number
  request: Frame
  expected: number | null
  result: Frame | null
  waiter: { resolve: (value: Frame) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null
}

class BluetoothResponseTimeout extends Error {}

export function hasBluetoothCollection(device: HIDDevice): boolean {
  const walk = (collections: HIDCollectionInfo[]): boolean => collections.some((collection) => {
    const vendor = collection.usagePage === 0xff55 && collection.usage === 0x0202
    const input = (collection.inputReports ?? []).some((report) => report.reportId === REPORT_ID)
    const output = (collection.outputReports ?? []).some((report) => report.reportId === REPORT_ID)
    return (vendor && input && output) || walk(collection.children ?? [])
  })
  return walk(device.collections ?? [])
}

/** BLE 使用 Report 6 的 Output/Input，载荷为 0x55 + 原有 64 字节协议帧。 */
export class BluetoothHIDTransport implements ReportTransport {
  private pending: Pending | null = null
  private closed = false
  private failed = false
  private lastWrite: number | null = null
  private received = false
  private configurationSent = false
  private identityRetried = false

  constructor(
    private readonly device: HIDDevice,
    private readonly intervalMs = 150,
    private readonly timeoutMs = 5000,
  ) {
    device.addEventListener('inputreport', this.onInput)
  }

  private onInput = (event: HIDInputReportEvent): void => {
    // 普通键盘及厂商事件不属于配置应答，不读取或记录其内容。
    if (event.reportId !== REPORT_ID || !this.pending || this.pending.result ||
        event.data.byteLength !== 65 || event.data.getUint8(0) !== COMMAND_MARKER) return
    const response = Array.from({ length: 64 }, (_, index) => event.data.getUint8(index + 1))
    if (this.pending.expected !== null && response[0] !== this.pending.expected) return
    this.received = true
    if (this.pending.waiter) {
      const waiter = this.pending.waiter
      this.pending = null
      clearTimeout(waiter.timer)
      waiter.resolve(response)
    } else {
      this.pending.result = response
    }
  }

  async write(frame: Frame): Promise<void> {
    if (this.closed || this.failed || !this.device.opened) throw new Error('蓝牙连接已中断，请重新连接。')
    if (!Array.isArray(frame) || frame.length !== 64 ||
        !frame.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      throw new Error('蓝牙报告必须为 64 字节。')
    }
    if (this.pending) throw new Error('上一个蓝牙查询尚未完成。')
    if (this.lastWrite !== null) {
      const delay = this.intervalMs - (performance.now() - this.lastWrite)
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    }
    if (this.closed || this.failed || !this.device.opened) throw new Error('蓝牙连接已中断，请重新连接。')
    const opcode = frame[0]!
    if (QUERIES.has(opcode)) {
      this.pending = { command: opcode, request: frame.slice(), expected: BULK_QUERIES.has(opcode) ? null : opcode, result: null, waiter: null }
    } else {
      this.configurationSent = true
    }
    const report = new Uint8Array(65)
    report[0] = COMMAND_MARKER
    report.set(frame, 1)
    this.lastWrite = performance.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.device.sendReport(REPORT_ID, report),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('蓝牙发送超时。')), this.timeoutMs)
        }),
      ])
    } catch (error) {
      this.failed = true
      this.cancelPending('蓝牙发送失败，请重新连接并检查键盘状态。')
      throw new Error(`蓝牙发送失败，请重新连接并检查键盘状态：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      clearTimeout(timer)
    }
  }

  async read(): Promise<Frame> {
    if (this.closed || this.failed || !this.device.opened) throw new Error('蓝牙连接已中断，请重新连接。')
    const pending = this.pending
    if (!pending) throw new Error('没有等待中的蓝牙查询。')
    if (pending.result) {
      this.pending = null
      return pending.result
    }
    if (pending.waiter) throw new Error('蓝牙查询正在等待应答。')
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending !== pending) return
        this.pending = null
        this.failed = true
        reject(new BluetoothResponseTimeout(`蓝牙查询 0x${pending.command.toString(16).padStart(2, '0')} 响应超时，请重新连接。`))
      }, this.timeoutMs)
      pending.waiter = { resolve, reject, timer }
    }).catch(async (error: unknown) => {
      // 刚打开蓝牙时首个设备 ID 查询可能丢失。仅重试这条只读握手一次，
      // 发过任何配置写入后或其他查询超时均停止，绝不重发配置指令。
      if (error instanceof BluetoothResponseTimeout && pending.command === 0x8f &&
          !this.received && !this.configurationSent && !this.identityRetried && !this.closed && this.device.opened) {
        this.identityRetried = true
        this.failed = false
        await this.write(pending.request)
        return this.read()
      }
      throw error
    })
  }

  private cancelPending(message: string): void {
    const pending = this.pending
    this.pending = null
    if (pending?.waiter) {
      clearTimeout(pending.waiter.timer)
      pending.waiter.reject(new Error(message))
    }
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.device.removeEventListener('inputreport', this.onInput)
    this.cancelPending('蓝牙连接已断开。')
  }
}
