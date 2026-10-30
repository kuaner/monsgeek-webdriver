import { frame } from './core'
import type { Frame, ReportTransport } from './types'

const STATUS = 0xf7
const SELECT_KEYBOARD = 0xf6
const RELEASE_RESPONSE = 0xfc
const STATUS_DELAY_MS = 10
const POLL_DELAY_MS = 5
const SEND_TIMEOUT_MS = 500
const REPLY_TIMEOUT_MS = 1000

export interface DongleStatus {
  replyReady: boolean
  battery: number | null
  keyboardOnline: boolean
  canSend: boolean
}

export function parseDongleStatus(reply: Frame): DongleStatus | null {
  // 接收器状态不以 F7 开头；键盘类型字段可排除普通键盘应答和全零缓存。
  if (reply.length !== 64 || (reply[6] !== 1 && reply[6] !== 3)) return null
  return {
    replyReady: reply[0] === 1,
    battery: reply[1]! <= 100 ? reply[1]! : null,
    keyboardOnline: reply[3] === 0,
    canSend: reply[5] === 1,
  }
}

/** 2.4G 接收器复用 USB Feature 报告，通过 F6/F7/FC 中继键盘协议帧。 */
export class DongleHIDTransport implements ReportTransport {
  private selected = false
  private busy = false

  constructor(
    private readonly raw: ReportTransport,
    private readonly onBattery: (battery: number) => void,
    private readonly pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  private async exchange(command: number, args: number[] = []): Promise<Frame> {
    await this.raw.write(frame([command, ...args]))
    await this.pause(STATUS_DELAY_MS)
    return this.raw.read()
  }

  private async status(): Promise<DongleStatus> {
    const status = parseDongleStatus(await this.exchange(STATUS))
    if (!status) throw new Error('2.4G 接收器没有返回有效的连接状态。')
    if (status.battery !== null) this.onBattery(status.battery)
    return status
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('上一个 2.4G 查询尚未完成。')
    this.busy = true
    try {
      return await operation()
    } finally {
      this.busy = false
    }
  }

  async write(request: Frame): Promise<void> {
    return this.serialized(async () => {
      const deadline = performance.now() + SEND_TIMEOUT_MS
      for (;;) {
        const status = await this.status()
        if (!status.keyboardOnline) {
          this.selected = false
          throw new Error('2.4G 接收器已连接，但键盘离线，请切换至 2.4G 模式或唤醒键盘。')
        }
        if (status.canSend) break
        if (performance.now() >= deadline) {
          this.selected = false
          throw new Error('2.4G 接收器正忙，请稍后重试。')
        }
        await this.pause(POLL_DELAY_MS)
      }
      if (!this.selected) {
        await this.raw.write(frame([SELECT_KEYBOARD, 10]))
        await this.pause(STATUS_DELAY_MS)
        this.selected = true
      }
      await this.raw.write(request)
    })
  }

  async read(): Promise<Frame> {
    return this.serialized(async () => {
      const deadline = performance.now() + REPLY_TIMEOUT_MS
      for (;;) {
        const status = await this.status()
        if (status.replyReady) {
          await this.raw.write(frame([RELEASE_RESPONSE]))
          await this.pause(STATUS_DELAY_MS)
          return this.raw.read()
        }
        if (performance.now() >= deadline) throw new Error('2.4G 键盘应答超时，请唤醒键盘后重试。')
        await this.pause(POLL_DELAY_MS)
      }
    })
  }
}
