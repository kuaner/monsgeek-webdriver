import { beforeEach, describe, expect, it, vi } from 'vitest'
import { M1WClient } from '../src/lib/protocol/client'
import { macroEncoded } from '../src/lib/protocol/core'
import { MockKeyboard, definition as mockDefinition } from '../src/lib/protocol/mock'

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('location', { search: '' })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
})

async function setup(keyboard: MockKeyboard) {
  const module = await import('../src/lib/state/controller.svelte')
  const controller = module.controller
  keyboard.revision = 0x0108
  controller.connection = { connected: true, transport: () => keyboard } as never
  controller.connected = true
  controller.info = await new M1WClient(keyboard, () => {}).liveInfo()
  controller.matrix = keyboard.matrix.slice()
  controller.fnMatrix = keyboard.fn.slice()
  return module
}

describe('层和操作目标', () => {
  it('普通键只显示按键与组合，Fn 层可设置功能与宏', async () => {
    const keyboard = new MockKeyboard()
    const { controller } = await setup(keyboard)
    controller.selectKey(78)
    expect(controller.availableModes.map((mode) => mode.id)).toEqual(['key', 'chord'])
    await controller.selectLayer('fn')
    expect(controller.availableModes.map((mode) => mode.id)).toEqual(['key', 'chord', 'function', 'macro'])
    expect(controller.baseMapping).toBe('F12')
    expect(controller.canEditKey).toBe(true)
    keyboard.revision = 0x0104
    controller.info = await new M1WClient(keyboard, () => {}).liveInfo()
    expect(controller.canEditKey).toBe(false)
    controller.selectKey(94)
    expect(controller.layer).toBe('base')
    expect(controller.availableModes.map((mode) => mode.id)).toContain('function')
  })

  it('旋钮切换仅供旋钮选择，普通键已有的映射仍能读出', async () => {
    const keyboard = new MockKeyboard()
    const key = mockDefinition.keys.find((item) => item.name === '7')!
    keyboard.fn.splice(key.index * 4, 4, 10, 14, 0, 0)
    const { controller } = await setup(keyboard)
    controller.selectKey(key.index)
    await controller.selectLayer('fn')
    expect(controller.currentMapping).toBe('切换旋钮：音量 / 灯光亮度')
    expect(controller.selectedAction).toBe('')
    expect(controller.choices.some((choice) => choice.id === 'knob-mode')).toBe(false)
    expect(controller.choices.some((choice) => choice.id === 'light-toggle')).toBe(true)

    controller.selectedAction = 'knob-mode'
    await controller.applyKey()
    expect(keyboard.mutations).toHaveLength(0)
    expect(keyboard.fn.slice(key.index * 4, key.index * 4 + 4)).toEqual([10, 14, 0, 0])

    controller.selectKey(6)
    expect(controller.layer).toBe('base')
    expect(controller.selectedAction).toBe('knob-mode')
    expect(controller.choices.some((choice) => choice.id === 'knob-mode')).toBe(true)
  })

  it('通信队列等待时切换按键不会改变写入目标', async () => {
    const keyboard = new MockKeyboard()
    const { controller, usbQueue, definition } = await setup(keyboard)
    let release!: () => void
    const blocked = usbQueue(() => new Promise<void>((resolve) => { release = resolve }))
    await Promise.resolve()
    const target = definition.keys.find((key) => key.name === 'F1')!
    controller.selectKey(78)
    controller.mappingMode = 'key'
    controller.selectedAction = `physical-${target.index}`
    const operation = controller.applyKey()
    controller.selectKey(72)
    expect(controller.selectedKeyIndex).toBe(78)
    release()
    await blocked
    await operation
    expect(keyboard.mutations.filter((f) => f[0] === 0x13).map((f) => f[2])).toEqual([78])
    expect(keyboard.matrix.slice(78 * 4, 78 * 4 + 4)).toEqual(target.record)
  }, 5000)

  it('切换宏键时丢弃旧读取，直到新宏读完才结束加载', async () => {
    const keyboard = new MockKeyboard()
    keyboard.fn.splice(78 * 4, 4, 9, 0, 0, 0)
    keyboard.fn.splice(72 * 4, 4, 9, 0, 1, 0)
    const macro = (usage: number) => macroEncoded({ repeatCount: 1, events: [
      { usage, down: true, delay: 1 }, { usage, down: false, delay: 0 },
    ] })
    keyboard.macros[0] = macro(4)
    keyboard.macros[1] = macro(5)
    let release!: () => void, started!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const secondStarted = new Promise<void>((resolve) => { started = resolve })
    const originalWrite = keyboard.write.bind(keyboard)
    keyboard.write = async (frame) => {
      if (frame[0] === 0x8b && frame[1] === 1 && frame[2] === 0) { started(); await gate }
      await originalWrite(frame)
    }
    const { controller, usbQueue } = await setup(keyboard)
    await controller.selectLayer('fn')
    controller.selectKey(78)
    controller.selectKey(72)
    await secondStarted
    await Promise.resolve()
    expect(controller.macroLoading).toBe(true)
    expect(controller.macro.events[0]?.usage).not.toBe(4)
    release()
    await usbQueue(async () => {})
    await Promise.resolve()
    expect(controller.macroLoading).toBe(false)
    expect(controller.macro.events[0]?.usage).toBe(5)
  }, 5000)
})
