// 协议层测试 — 移植 native Swift 测试套（36 项）+ 初版 web 关灯语义回归，共 39 项。
// 运行：npm test（vitest run）

import { describe, expect, it } from 'vitest'

import {
  frame, singleKeyFrame, hexDecode, lightFrame, parseLight,
  lightEquals, lightBytes, keyboardOptionsFrame, macroFrames, chord, recordLabel,
  macroEncoded, macroDecoded, makeSnapshot, snapshotValidatedMatrix,
  snapshotValidatedFnMatrix, snapshotValidatedMacros, snapshotIsCompatible,
  infoFirmware, infoDeviceID, infoSupportsConfiguration, infoLight,
  infoKeyboardOptions, infoLightsEnabled, infoProfile,
} from '../src/lib/protocol/core'
import { NONE } from '../src/lib/protocol/types'
import { M1WClient, ProtocolError } from '../src/lib/protocol/client'
import { MockKeyboard, definition } from '../src/lib/protocol/mock'

const Z = (n: number): number[] => new Array(n).fill(0)

const exampleMacro = () => ({
  repeatCount: 2,
  events: [
    { usage: 227, down: true, delay: 0 },
    { usage: 6, down: true, delay: 25 },
    { usage: 6, down: false, delay: 0 },
    { usage: 227, down: false, delay: 50 },
  ],
})

function makeClient(keyboard: MockKeyboard) {
  const delays: number[] = []
  const client = new M1WClient(keyboard, (ms) => {
    delays.push(ms)
    return Promise.resolve()
  })
  return { client, delays }
}

describe('帧与校验', () => {
  it('线上捕获 80…7f 与 NONE 枚举', () => {
    expect(frame([0x80]).slice(0, 8)).toEqual([0x80, 0, 0, 0, 0, 0, 0, 0x7f])
    expect(NONE).toBe(2)
  })

  it('校验包含参数字节', () => {
    expect(frame([0x89, 0, 3])[7]).toBe(0x73)
  })

  it('非法帧与编号被拒绝', () => {
    expect(() => frame(Z(65))).toThrow(ProtocolError)
    expect(() => singleKeyFrame(126, [0, 0, 4, 0])).toThrow(ProtocolError)
    expect(() => hexDecode('xx')).toThrow(ProtocolError)
    expect(() => hexDecode('1')).toThrow(ProtocolError)
  })

  it('06 选项帧切换 bit4', () => {
    const response = [0x86, 0, 0x12, 1, 2, 3, 4, 0, ...Z(56)]
    const on = keyboardOptionsFrame(response, true)
    expect(on[0]).toBe(6)
    expect(on[2]).toBe(0x02)
    const off = keyboardOptionsFrame(response, false)
    expect(off[2]).toBe(0x12)
    let sum = 0
    for (let i = 0; i <= 7; i++) sum += off[i]!
    expect(sum & 0xff).toBe(255)
  })
})

describe('灯效', () => {
  it('BIT8 保留蓝色分量', () => {
    const keyboard = new MockKeyboard()
    keyboard.light.blue = 200
    const f = lightFrame(keyboard.light)
    expect(f[7]).toBe(200)
    let sum = 0
    for (let i = 0; i <= 8; i++) sum += f[i]!
    expect(sum & 0xff).toBe(255)
  })

  it('纯白使用厂商编码 FAFAFA', () => {
    const keyboard = new MockKeyboard()
    const f = lightFrame(keyboard.light)
    expect(f.slice(0, 9)).toEqual([7, 4, 2, 4, 7, 250, 250, 250, 249])
    expect(lightEquals(parseLight([0x87, ...f.slice(1, 8), ...Z(56)]), keyboard.light)).toBe(true)
  })

  it('预置颜色按索引、自定义按通道', () => {
    const preset = parseLight([0x87, 1, 2, 4, 1, 0, 0, 0, ...Z(56)])
    expect([preset.red, preset.green, preset.blue]).toEqual([0, 255, 0])
    const custom = parseLight([0x87, 1, 2, 4, 8, 17, 34, 51, ...Z(56)])
    expect([custom.red, custom.green, custom.blue]).toEqual([17, 34, 51])
  })

  it('固件 1.08 身份与两种白色表示', async () => {
    const keyboard = new MockKeyboard()
    keyboard.revision = 0x0108
    const info = await makeClient(keyboard).client.info()
    expect(infoFirmware(info)).toBe('1.08')
    expect(infoDeviceID(info)).toBe(983)
    expect(infoSupportsConfiguration(info)).toBe(true)
    const rawWhite = parseLight([0x87, 4, 2, 4, 7, 255, 255, 255, ...Z(56)])
    const encodedWhite = parseLight([0x87, 4, 2, 4, 7, 250, 250, 250, ...Z(56)])
    expect(lightEquals(rawWhite, encodedWhite)).toBe(true)
  })

  it('关灯按厂商语义写 07 mode0/brightness0 且不动门控', async () => {
    const keyboard = new MockKeyboard()
    const { client } = makeClient(keyboard)
    await client.setLight({ enabled: false })
    expect(keyboard.light.mode).toBe(0)
    expect(keyboard.light.brightness).toBe(0)
    expect(keyboard.options[2]).toBe(2)
    const off = keyboard.writes.filter((w) => w[0] === 7).pop()!
    expect(off[1]).toBe(0)
    expect(off[3]).toBe(0)
    keyboard.options[2] = 0x12
    await client.setLight({ enabled: false })
    expect(keyboard.options[2]).toBe(0x12)
    await client.setLight({ mode: 4, enabled: true })
    expect(keyboard.light.mode).toBe(4)
    expect(keyboard.options[2]! & 0x10).toBe(0)
  })

  it('灯效写入清除关灯门控并保留其他位', async () => {
    const keyboard = new MockKeyboard()
    keyboard.options[2] = 0x12
    const { client } = makeClient(keyboard)
    await client.setLight({ mode: 1, brightness: 3, enabled: true })
    expect(keyboard.options[2]).toBe(2)
    expect(keyboard.light.mode).toBe(1)
    expect(keyboard.light.brightness).toBe(3)
    expect(keyboard.writes.filter((w) => w[0] === 0x89).length).toBe(0)
  })

  it('模式 0 时开启恢复默认效果', async () => {
    const keyboard = new MockKeyboard()
    keyboard.light.mode = 0
    keyboard.light.brightness = 0
    await makeClient(keyboard).client.setLight({ enabled: true })
    expect(keyboard.light.mode).toBe(4)
    expect(keyboard.light.brightness).toBe(4)
  })

  it('显式亮度 0 被保留', async () => {
    const keyboard = new MockKeyboard()
    await makeClient(keyboard).client.setLight({ brightness: 0, enabled: true })
    expect(keyboard.light.brightness).toBe(0)
  })

  it('当前状态同时看模式与门控', async () => {
    const keyboard = new MockKeyboard()
    const { client } = makeClient(keyboard)
    expect(infoLightsEnabled(await client.liveInfo())).toBe(true)
    keyboard.options[2]! |= 0x10
    expect(infoLightsEnabled(await client.liveInfo())).toBe(false)
    keyboard.options[2]! &= 0xef
    keyboard.light.mode = 0
    expect(infoLightsEnabled(await client.liveInfo())).toBe(false)
  })
})

describe('布局与功能目录', () => {
  it('布局与出厂记录一致', () => {
    expect(definition.keys.length).toBe(85)
    expect(new Set(definition.keys.map((k) => k.index)).size).toBe(85)
    for (const key of definition.keys) {
      expect(definition.defaultMatrix.slice(key.index * 4, key.index * 4 + 4)).toEqual(key.record)
    }
  })

  it('旋钮标签描述音量与按下', () => {
    expect(recordLabel([3, 0, 234, 0], definition)).toBe('音量 −')
    expect(recordLabel([3, 0, 233, 0], definition)).toBe('音量 +')
    expect(recordLabel([10, 14, 0, 0], definition)).toContain('切换旋钮')
  })

  it('组合键使用 HID usage 而非位掩码', () => {
    expect(chord(6, [227])).toEqual([0, 227, 6, 0])
    expect(chord(4, [224, 225])).toEqual([0, 224, 4, 225])
    expect(() => chord(4, [224, 225, 227])).toThrow(ProtocolError)
    expect(() => chord(4, [1])).toThrow(ProtocolError)
  })
})

describe('查询与矩阵', () => {
  it('未知与写命令在 USB 前被拒绝', async () => {
    const keyboard = new MockKeyboard()
    const { client } = makeClient(keyboard)
    for (const code of [2, 7, 0x13, 0x7f, 0x89, 0x8b, 0x90, 255]) {
      await expect(client.query(code)).rejects.toThrow(ProtocolError)
    }
    expect(keyboard.writes.length).toBe(0)
  })

  it('短应答失败', async () => {
    const keyboard = new MockKeyboard()
    keyboard.shortResponse = true
    await expect(makeClient(keyboard).client.query(0x80)).rejects.toThrow(ProtocolError)
  })

  it('陈旧查询失败', async () => {
    const stale = { write: async () => {}, read: async () => [0x85, ...Z(63)] }
    await expect(new M1WClient(stale, () => {}).query(0x80)).rejects.toThrow(ProtocolError)
  })

  it('矩阵为原始 512 字节', async () => {
    const keyboard = new MockKeyboard()
    const matrix = await makeClient(keyboard).client.readMatrix()
    expect(matrix).toEqual(keyboard.matrix)
  })

  it('陈旧与不一致矩阵被拒绝', async () => {
    const a = new MockKeyboard()
    a.ignoreMatrix = true
    await expect(makeClient(a).client.readMatrix()).rejects.toThrow(ProtocolError)
    const b = new MockKeyboard()
    b.inconsistentMatrix = true
    await expect(makeClient(b).client.readMatrix()).rejects.toThrow(ProtocolError)
  })
})

describe('改键', () => {
  it('普通改键只读所属页且不产生文件', async () => {
    const keyboard = new MockKeyboard()
    const { client } = makeClient(keyboard)
    await client.setKey(78, [0, 227, 6, 0])
    expect(keyboard.writes.filter((w) => w[0] === 0x89).length).toBe(2)
    expect(keyboard.matrix.slice(312, 316)).toEqual([0, 227, 6, 0])
  })

  it('改键失败时在内存中还原原值', async () => {
    const keyboard = new MockKeyboard()
    const before = keyboard.matrix.slice()
    keyboard.ignoreNextMutation = true
    await expect(makeClient(keyboard).client.setKey(78, [0, 227, 6, 0])).rejects.toThrow(ProtocolError)
    expect(keyboard.matrix).toEqual(before)
    expect(keyboard.mutations.length).toBe(2)
  })

  it('按键写入等待宏稳定间隔', async () => {
    const keyboard = new MockKeyboard()
    const { client, delays } = makeClient(keyboard)
    await client.setKey(78, [0, 0, 68, 0])
    expect(delays).toContain(500)
  })

  it('Fn 改键只写 Fn 表并保留普通键', async () => {
    const keyboard = new MockKeyboard()
    const originalBase = keyboard.matrix.slice()
    await makeClient(keyboard).client.setKey(82, [10, 9, 0, 0], { fn: true })
    expect(keyboard.fn.slice(82 * 4, 82 * 4 + 4)).toEqual([10, 9, 0, 0])
    expect(keyboard.matrix).toEqual(originalBase)
    expect(keyboard.mutations.filter((f) => f[0] === 0x15).map((f) => f[2])).toEqual([82])
    expect(keyboard.mutations.some((f) => f[0] === 0x13)).toBe(false)
  })

  it('识别原厂 Siri 动作而不放行其他未知 type-18', async () => {
    const keyboard = new MockKeyboard()
    expect(recordLabel([18, 0, 227, 44], definition)).toBe('呼出 Siri')
    await makeClient(keyboard).client.setKey(30, [18, 0, 227, 44], { fn: true })
    await expect(makeClient(keyboard).client.setKey(30, [18, 0, 0, 1], { fn: true })).rejects.toThrow(ProtocolError)
  })
})

describe('宏', () => {
  it('宏编解码往返与平衡校验', () => {
    const macro = exampleMacro()
    const data = macroEncoded(macro)
    const decoded = macroDecoded(data)
    expect(data.length).toBe(256)
    expect(data[0]).toBe(2)
    expect(decoded.repeatCount).toBe(macro.repeatCount)
    expect(decoded.events.map((e) => e.usage)).toEqual(macro.events.map((e) => e.usage))
    expect(decoded.events.map((e) => e.down)).toEqual(macro.events.map((e) => e.down))
    expect(() => macroEncoded({ repeatCount: 1, events: [{ usage: 227, down: true, delay: 0 }] }))
      .toThrow(ProtocolError)
    expect(() => macroEncoded({ repeatCount: 1, events: [{ usage: 4, down: false, delay: 0 }] }))
      .toThrow(ProtocolError)
    expect(() => macroEncoded({ repeatCount: 1, events: [
      { usage: 4, down: true, delay: 0 }, { usage: 4, down: true, delay: 0 }, { usage: 4, down: false, delay: 0 },
    ] })).toThrow(ProtocolError)
  })

  it('宏紧凑延时解码', () => {
    const bytes = Z(256)
    bytes[0] = 1
    bytes.splice(2, 4, 4, 0x80 | 30, 4, 50)
    const decoded = macroDecoded(bytes)
    expect(decoded.events.map((e) => e.delay)).toEqual([30, 50])
    expect(decoded.events.map((e) => e.down)).toEqual([true, false])
  })

  it('宏分块帧头正确并清除尾部数据', async () => {
    const keyboard = new MockKeyboard()
    keyboard.macros[49] = Z(256).fill(200)
    const bytes = macroEncoded(exampleMacro())
    await makeClient(keyboard).client.writeMacro(49, bytes)
    expect(keyboard.macros[49]).toEqual(bytes)
    const frames = keyboard.writes.filter((w) => w[0] === 0x16)
    expect(frames.length).toBe(5)
    expect(frames.map((f) => f[4])).toEqual([0, 0, 0, 0, 1])
    for (const f of frames) {
      expect(f[3]).toBe(56)
      let sum = 0
      for (let i = 0; i <= 7; i++) sum += f[i]!
      expect(sum & 0xff).toBe(255)
    }
  })

  it('宏分配绑定类型 9 记录', async () => {
    const keyboard = new MockKeyboard()
    const { client } = makeClient(keyboard)
    const result = await client.assignMacro(78, exampleMacro(), 2)
    expect(result.macroSlot).toBe(0)
    expect(keyboard.matrix.slice(312, 316)).toEqual([9, 2, 0, 0])
    expect(keyboard.macros[0]).toEqual(macroEncoded(exampleMacro()))
  })

  it('Fn 宏只绑定 Fn 层，并避开普通层已使用的宏槽', async () => {
    const keyboard = new MockKeyboard()
    keyboard.matrix.splice(78 * 4, 4, 9, 0, 0, 0)
    keyboard.macros[0] = macroEncoded(exampleMacro())
    const base = keyboard.matrix.slice(), previousMacro = keyboard.macros[0]!.slice()
    const result = await makeClient(keyboard).client.assignMacro(78, exampleMacro(), 2, null, { fn: true })
    expect(result.macroSlot).toBe(1)
    expect(keyboard.fn.slice(78 * 4, 78 * 4 + 4)).toEqual([9, 2, 1, 0])
    expect(keyboard.matrix).toEqual(base)
    expect(keyboard.macros[0]).toEqual(previousMacro)
    expect(keyboard.mutations.filter((f) => f[0] === 0x15)).toHaveLength(1)
    expect(keyboard.mutations.some((f) => f[0] === 0x13)).toBe(false)
  })
})

describe('配置方案', () => {
  it('手动配置包含 Fn 与被引用宏', async () => {
    const keyboard = new MockKeyboard()
    keyboard.matrix.splice(312, 4, 9, 0, 3, 0)
    keyboard.macros[3] = macroEncoded(exampleMacro())
    const snapshot = await makeClient(keyboard).client.snapshot('工作')
    expect(snapshot.name).toBe('工作')
    expect(snapshotValidatedFnMatrix(snapshot)).toEqual(keyboard.fn)
    expect(snapshotValidatedMacros(snapshot)[3]).toEqual(keyboard.macros[3])
  })

  it('配置切换还原 Fn/宏/灯效/门控', async () => {
    const keyboard = new MockKeyboard()
    const { client } = makeClient(keyboard)
    keyboard.matrix.splice(312, 4, 9, 0, 3, 0)
    keyboard.macros[3] = macroEncoded(exampleMacro())
    keyboard.fn.splice(312, 4, 0, 227, 6, 0)
    keyboard.options[2] = 0x12
    const snapshot = await client.snapshot('工作')
    keyboard.matrix = definition.defaultMatrix.slice()
    keyboard.fn = definition.defaultFnMatrix.slice()
    keyboard.macros[3] = Z(256)
    keyboard.light.mode = 1
    keyboard.options[2] = 2
    await client.restore(snapshot)
    expect(keyboard.matrix).toEqual(snapshotValidatedMatrix(snapshot))
    expect(keyboard.fn).toEqual(snapshotValidatedFnMatrix(snapshot))
    expect(keyboard.macros[3]).toEqual(macroEncoded(exampleMacro()))
    expect(lightEquals(keyboard.light, infoLight(snapshot.info)!)).toBe(true)
    expect(keyboard.options[2]).toBe(0x12)
  })

  it('非法配置在任何写入前失败', async () => {
    const keyboard = new MockKeyboard()
    const { client } = makeClient(keyboard)
    const matrix = keyboard.matrix.slice()
    matrix[400] = 255
    const snapshot = makeSnapshot(await client.info(), matrix, { macros: { 3: macroEncoded(exampleMacro()) } })
    await expect(client.restore(snapshot)).rejects.toThrow(ProtocolError)
    expect(keyboard.mutations.length).toBe(0)
  })

  it('快照字段与原生 schema 2 互通', () => {
    const keyboard = new MockKeyboard()
    const snapshot = makeSnapshot({ reports: {} }, keyboard.matrix)
    expect(snapshot.schema).toBe(2)
    expect(snapshot.device).toBe('RongYuan M1W 3151:4015')
    expect(snapshot.keymapHex.length).toBe(1024)
  })
})

describe('迁移与安全', () => {
  it('1.04 配置迁移到 1.08', async () => {
    const keyboard = new MockKeyboard()
    const { client } = makeClient(keyboard)
    const saved = await client.snapshot('升级前')
    keyboard.revision = 0x0108
    keyboard.matrix.splice(312, 4, 0, 227, 6, 0)
    expect(snapshotIsCompatible(saved, await client.info())).toBe(true)
    const result = await client.restore(saved)
    expect(result.changedKeyIndices).toEqual([78])
    expect(keyboard.matrix).toEqual(snapshotValidatedMatrix(saved))
  })

  it('无设备 ID 的旧配置可迁移', async () => {
    const keyboard = new MockKeyboard()
    const { client } = makeClient(keyboard)
    const old = await client.info()
    delete (old.reports as Record<string, string>)['8f']
    const saved = makeSnapshot(old, keyboard.matrix)
    keyboard.revision = 0x0108
    expect(snapshotIsCompatible(saved, await client.info())).toBe(true)
    await client.restore(saved)
  })

  it('迁移保留未变更的原厂不透明 Fn 记录', async () => {
    const keyboard = new MockKeyboard()
    const { client } = makeClient(keyboard)
    keyboard.fn.splice(120, 4, 18, 0, 227, 44)
    const saved = await client.snapshot('原厂Fn')
    keyboard.revision = 0x0108
    await client.restore(saved)
    expect(keyboard.fn.slice(120, 124)).toEqual([18, 0, 227, 44])
    expect(keyboard.mutations.some((f) => f[0] === 0x15)).toBe(false)
  })

  it('未验证固件拒绝全部写命令', async () => {
    const keyboard = new MockKeyboard()
    keyboard.revision = 0x0109
    const { client } = makeClient(keyboard)
    expect(infoSupportsConfiguration(await client.info())).toBe(false)
    await expect(client.setKey(78, [0, 227, 6, 0])).rejects.toThrow(ProtocolError)
    await expect(client.setLight({ mode: 4, enabled: true })).rejects.toThrow(ProtocolError)
    await expect(client.writeMacro(49, Z(256))).rejects.toThrow(ProtocolError)
    await expect(client.factoryReset()).rejects.toThrow(ProtocolError)
    expect(keyboard.mutations.length).toBe(0)
  })

  it('相同 USB ID 不授权其他板写入', async () => {
    const keyboard = new MockKeyboard()
    keyboard.deviceID = 1171
    const { client } = makeClient(keyboard)
    await expect(client.setKey(78, [0, 227, 6, 0])).rejects.toThrow(ProtocolError)
    await expect(client.setLight({ mode: 1, enabled: true })).rejects.toThrow(ProtocolError)
    expect(keyboard.mutations.length).toBe(0)
  })

  it('其他板的配置在任何写入前被拒绝', async () => {
    const keyboard = new MockKeyboard()
    const { client } = makeClient(keyboard)
    const good = await client.info()
    const reports = { ...good.reports }
    reports['8f'] = [0x8f, 0x93, 4, ...Z(61)].map((b) => b.toString(16).padStart(2, '0')).join('')
    const saved = makeSnapshot({ reports }, keyboard.matrix)
    await expect(client.restore(saved)).rejects.toThrow(ProtocolError)
    expect(keyboard.mutations.length).toBe(0)
  })

  it('恢复默认只由显式方法发送', async () => {
    const keyboard = new MockKeyboard()
    const { client, delays } = makeClient(keyboard)
    await expect(client.query(2)).rejects.toThrow(ProtocolError)
    expect(keyboard.mutations.length).toBe(0)
    await client.factoryReset()
    expect(keyboard.mutations.filter((f) => f[0] === 2).length).toBe(1)
    expect(delays).toContain(4000)
  })
})

describe('信息解析', () => {
  it('86/85/80 报告解析', () => {
    expect(infoKeyboardOptions({ reports: { '86': '8600020000000079' + '00'.repeat(56) } })![2]).toBe(2)
    expect(infoProfile({ reports: { '85': '8500' + '00'.repeat(62) } })).toBe(0)
    expect(lightBytes(parseLight([0x87, 4, 2, 4, 7, 255, 255, 255, ...Z(56)]))).toBeDefined()
  })
})
