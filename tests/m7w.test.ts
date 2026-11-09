import { describe, expect, it } from 'vitest'
import { definitionForInfo, m1wDefinition, m7wDefinition } from '../src/lib/keyboard/models'
import { KEYBOARD_HEIGHT, KEYBOARD_WIDTH, keyBounds, swapModifierPositions } from '../src/lib/keyboard/geometry'
import { physicalKeyDisplayName } from '../src/lib/keyboard/legends'
import { M1WClient } from '../src/lib/protocol/client'
import {
  allActions, infoSupportsConfiguration, infoSupportsFnConfiguration, makeSnapshot,
  recordLabel, snapshotIsCompatible, snapshotValidatedMatrix,
} from '../src/lib/protocol/core'
import { MockKeyboard } from '../src/lib/protocol/mock'

const noPause = () => {}

function m7w() {
  const keyboard = new MockKeyboard()
  keyboard.deviceID = 1215
  keyboard.revision = 0x0100
  keyboard.matrix = m7wDefinition.defaultMatrix.slice()
  keyboard.fn = m7wDefinition.defaultFnMatrix.slice()
  return keyboard
}

describe('M7W 型号与布局', () => {
  it('通过设备 ID 选布局并限制可写固件', async () => {
    const keyboard = m7w()
    const client = new M1WClient(keyboard, noPause)
    const info = await client.info()
    expect(definitionForInfo(info)).toBe(m7wDefinition)
    expect(infoSupportsConfiguration(info)).toBe(true)
    expect(infoSupportsFnConfiguration(info)).toBe(false)
    keyboard.revision = 0x0101
    expect(infoSupportsConfiguration(await client.info())).toBe(false)
    keyboard.deviceID = 983
    keyboard.revision = 0x0108
    expect(definitionForInfo(await client.info())).toBe(m1wDefinition)
    keyboard.deviceID = 2222
    expect(definitionForInfo(await client.info())).toBeNull()
  })

  it('提供 68 键布局以及没有实体键帽的 F1–F12', () => {
    expect(m7wDefinition.keys).toHaveLength(68)
    expect(new Set(m7wDefinition.keys.map((key) => key.index)).size).toBe(68)
    const corrected = new Map([['Esc', 1], ['Insert', 85], ['Delete', 86], ['Page\nUp', 87], ['Page\nDown', 88]])
    for (const [name, index] of corrected) {
      const key = m7wDefinition.keys.find((item) => item.name === name)!
      expect(key.index).toBe(index)
      expect(m7wDefinition.defaultMatrix.slice(index * 4, index * 4 + 4)).toEqual(key.record)
    }
    for (const key of m7wDefinition.keys) {
      const box = keyBounds(key)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(KEYBOARD_WIDTH)
      expect(box.y + box.height).toBeLessThanOrEqual(KEYBOARD_HEIGHT)
    }
    const actions = allActions(m7wDefinition)
    for (let usage = 58; usage <= 69; usage++) {
      expect(actions.some((action) => action.record.join(',') === `0,0,${usage},0`)).toBe(true)
    }
    expect(recordLabel([0, 0, 53, 0], m7wDefinition)).toBe('`')
    expect(recordLabel([0, 0, 74, 0], m7wDefinition)).toBe('Home')
  })

  it('M7W 使用官方图上的物理标识与固定矩阵位置', () => {
    const win = m7wDefinition.keys.find((key) => key.name === 'Win')!
    const alt = m7wDefinition.keys.find((key) => key.name === 'Alt')!
    expect(swapModifierPositions(m7wDefinition, true)).toBe(false)
    expect(keyBounds(win, swapModifierPositions(m7wDefinition, true), m7wDefinition.keys))
      .toEqual(keyBounds(win, false, m7wDefinition.keys))
    expect([win.index, alt.index]).toEqual([17, 23])
    expect(physicalKeyDisplayName(win, m7wDefinition)).toBe('左 Win')
    expect(physicalKeyDisplayName(alt, m7wDefinition)).toBe('左 Alt')
  })
})

describe('M7W 安全写入', () => {
  it('支持基础改键，拒绝 Fn 和未经验证的宏写入', async () => {
    const keyboard = m7w()
    const waits: number[] = []
    const client = new M1WClient(keyboard, (ms) => { waits.push(ms) })
    const target = m7wDefinition.keys.find((key) => key.name === ']')!
    const before = keyboard.matrix.slice(target.index * 4, target.index * 4 + 4)
    await client.setKey(target.index, [0, 0, 47, 0])
    expect(keyboard.matrix.slice(target.index * 4, target.index * 4 + 4)).toEqual([0, 0, 47, 0])
    await client.setKey(target.index, before)
    expect(waits).toContain(2000)
    const count = keyboard.mutations.length
    await expect(client.setKey(target.index, [0, 0, 69, 0], { fn: true })).rejects.toThrow('Fn')
    await expect(client.writeMacro(0, new Array(256).fill(0))).rejects.toThrow('宏')
    await expect(client.assignMacro(target.index, { repeatCount: 1, events: [
      { usage: 4, down: true, delay: 0 }, { usage: 4, down: false, delay: 0 },
    ] }, 0, null, { fn: true })).rejects.toThrow('宏')
    expect(keyboard.mutations).toHaveLength(count)
  })

  it('配置按型号隔离；不支持的 Fn 差异在任何写入之前拒绝', async () => {
    const keyboard = m7w()
    const client = new M1WClient(keyboard, noPause)
    const info = await client.info()
    const saved = makeSnapshot(info, keyboard.matrix, { fnMatrix: keyboard.fn })
    expect(snapshotValidatedMatrix(saved)).toEqual(keyboard.matrix)
    expect(snapshotIsCompatible(saved, info)).toBe(true)
    keyboard.fn[0] = (keyboard.fn[0]! + 1) % 256
    keyboard.matrix[30] = (keyboard.matrix[30]! + 1) % 256
    await expect(client.restore(saved)).rejects.toThrow('Fn')
    expect(keyboard.mutations).toHaveLength(0)
    const other = new MockKeyboard()
    other.revision = 0x0108
    const m1Info = await new M1WClient(other, noPause).info()
    expect(snapshotIsCompatible(saved, m1Info)).toBe(false)
    const m1Snapshot = makeSnapshot(m1Info, other.matrix)
    expect(snapshotIsCompatible(m1Snapshot, info)).toBe(false)
  })

  it('不支持的宏差异在任何配置写入之前拒绝', async () => {
    const keyboard = m7w()
    const client = new M1WClient(keyboard, noPause)
    const saved = makeSnapshot(await client.info(), keyboard.matrix, { macros: { 0: new Array(256).fill(1) } })
    keyboard.matrix[30] = (keyboard.matrix[30]! + 1) % 256
    await expect(client.restore(saved)).rejects.toThrow('宏')
    expect(keyboard.mutations).toHaveLength(0)
  })
})
