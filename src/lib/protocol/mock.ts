// 模拟键盘 — 移植自 native Swift 测试的 Keyboard transport，供 vitest 使用。

import definitionJson from '../assets/m1w.json'
import type { DeviceDefinition, Frame, ReportTransport } from './types'
import { lightBytes, parseLight } from './core'

export const definition = definitionJson as DeviceDefinition

const Z = (n: number): number[] => new Array(n).fill(0)

export class MockKeyboard implements ReportTransport {
  matrix: number[]
  fn: number[]
  light = parseLight([0x87, 4, 2, 4, 7, 255, 255, 255, ...Z(56)])
  options: number[] = [0x86, 0, 2, 0, 0, 0, 0, 0x79, ...Z(56)]
  register: Frame = Z(64)
  macros: Record<number, number[]> = {}
  staging: Record<number, number[]> = {}
  writes: Frame[] = []
  revision = 0x0104
  deviceID = 983
  ignoreMatrix = false
  inconsistentMatrix = false
  shortResponse = false
  ignoreNextMutation = false
  private pages = 0

  constructor() {
    this.matrix = definition.defaultMatrix.slice()
    this.fn = definition.defaultFnMatrix.slice()
  }

  get mutations(): Frame[] {
    return this.writes.filter((w) => w[0]! < 0x80)
  }

  async write(f: Frame): Promise<void> {
    if (f.length !== 64) throw new Error('bad size')
    this.writes.push(f)
    if (f[0]! < 0x80 && this.ignoreNextMutation) {
      this.ignoreNextMutation = false
      return
    }
    const checksumIndex = f[0] === 7 ? 8 : 7
    let sum = 0
    for (let i = 0; i <= checksumIndex; i++) sum += f[i]!
    if ((sum & 0xff) !== 255) throw new Error('bad checksum')
    switch (f[0]) {
      case 0x13:
      case 0x15: {
        const i = f[2]! * 4
        const target = f[0] === 0x13 ? this.matrix : this.fn
        target.splice(i, 4, ...f.slice(8, 12))
        break
      }
      case 6:
        this.options.splice(1, 6, ...f.slice(1, 7))
        break
      case 7:
        this.light = parseLight([0x87, ...f.slice(1, 8), ...Z(56)])
        break
      case 0x16: {
        const slot = f[1]!
        const page = f[2]!
        const data = this.staging[slot] ?? Z(280)
        data.splice(page * 56, 56, ...f.slice(8, 64))
        this.staging[slot] = data
        if (f[4] === 1) this.macros[slot] = data.slice(0, 256)
        break
      }
      case 0x89:
      case 0x90: {
        if (this.ignoreMatrix) return
        const page = f[2]!
        const data = f[0] === 0x89 ? this.matrix : this.fn
        this.register = data.slice(page * 64, page * 64 + 64)
        if (this.inconsistentMatrix && this.pages >= 8 && page === 0) this.register[2]! ^= 1
        this.pages += 1
        break
      }
      case 0x8b: {
        const data = this.macros[f[1]!] ?? Z(256)
        this.register = data.slice(f[2]! * 64, f[2]! * 64 + 64)
        break
      }
      case 0x80:
        this.register = [0x80, this.revision & 255, this.revision >> 8, ...Z(61)]
        break
      case 0x8f:
        this.register = [0x8f, this.deviceID & 255, this.deviceID >> 8, ...Z(61)]
        break
      case 0x86:
        this.register = this.options.slice()
        break
      case 0x87:
        this.register = [0x87, ...lightBytes(this.light), ...Z(56)]
        break
      case 2:
        this.matrix = definition.defaultMatrix.slice()
        this.macros = {}
        break
      default:
        this.register = [f[0]!, ...Z(63)]
    }
  }

  async read(): Promise<Frame> {
    return (this.shortResponse ? this.register.slice(0, 63) : this.register.slice()) as Frame
  }
}
