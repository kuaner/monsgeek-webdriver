import { describe, expect, it } from 'vitest'
import { definition } from '../src/lib/protocol/mock'
import { isKnobKey } from '../src/lib/protocol/core'
import { keyBounds, knobBounds, knobSector, KEYBOARD_HEIGHT, KEYBOARD_WIDTH } from '../src/lib/keyboard/geometry'

describe('键盘绘制与点击区域', () => {
  it('按原厂布局计算键帽和旋钮的区域', () => {
    const esc = definition.keys.find((key) => key.name === 'Esc')!
    const knob = definition.keys.find((key) => key.name === 'Volume<->Brightness')!
    expect(keyBounds(esc)).toEqual({ x: 21, y: 25, width: 34, height: 34 })
    expect(keyBounds(knob)).toEqual({ x: 595.5, y: 22, width: 11, height: 40 })
  })

  it('所有键和旋钮的可点击区域都在 SVG 范围内', () => {
    for (const key of definition.keys) {
      const { x, y, width, height } = isKnobKey(key) ? knobBounds(key) : keyBounds(key)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(x + width).toBeLessThanOrEqual(KEYBOARD_WIDTH)
      expect(y + height).toBeLessThanOrEqual(KEYBOARD_HEIGHT)
    }
  })

  it('Mac 模式只交换左侧 Option/Command 的位置，右侧保持原厂顺序', () => {
    const win = definition.keys.find((key) => key.name === 'Win')!
    const alt = definition.keys.find((key) => key.name === 'Alt')!
    const rightAlt = definition.keys.find((key) => key.name === 'r_Alt')!
    const rightCtrl = definition.keys.find((key) => key.name === 'r_Ctrl')!
    expect(keyBounds(win, true, definition.keys).x).toBe(keyBounds(alt, false).x)
    expect(keyBounds(alt, true, definition.keys).x).toBe(keyBounds(win, false).x)
    expect(keyBounds(rightAlt, true, definition.keys).x).toBe(keyBounds(rightAlt, false).x)
    expect(keyBounds(rightCtrl, true, definition.keys).x).toBe(keyBounds(rightCtrl, false).x)
  })

  it('旋钮的三个动作拥有各自独立的点击区和扇形反馈', () => {
    const left = definition.keys.find((key) => key.index === 6)!
    const press = definition.keys.find((key) => key.index === 94)!
    const right = definition.keys.find((key) => key.index === 95)!
    expect(knobBounds(left).x + knobBounds(left).width).toBeLessThan(knobBounds(press).x)
    expect(knobBounds(press).x + knobBounds(press).width).toBeLessThan(knobBounds(right).x)
    expect(new Set([knobSector(6), knobSector(94), knobSector(95)]).size).toBe(3)
  })
})
