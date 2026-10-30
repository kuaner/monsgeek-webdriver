import { describe, expect, it } from 'vitest'
import { keycapLegend, mappedKeycapLegend } from '../src/lib/keyboard/legends'
import { definition } from '../src/lib/protocol/mock'

describe('键帽系统名称', () => {
  it('键盘 Mac 模式显示 Command、Option 和 Control', () => {
    expect(keycapLegend('Win', true)).toBe('⌘ Cmd')
    expect(keycapLegend('Alt', true)).toBe('⌥ Opt')
    expect(keycapLegend('r_Ctrl', true)).toBe('⌃ Ctrl')
  })

  it('键盘 Windows 模式保留 Win 和 Alt，字母与符号不因模式改变', () => {
    expect(keycapLegend('Win', false)).toBe('Win')
    expect(keycapLegend('r_Alt', false)).toBe('Alt')
    expect(keycapLegend('7', true)).toBe(keycapLegend('7', false))
  })

  it('改键后的键帽显示实际功能，右侧修饰键和组合键可区分', () => {
    expect(mappedKeycapLegend([0, 0, 230, 0], definition, true)).toBe('⌥ Opt R')
    expect(mappedKeycapLegend([0, 0, 231, 0], definition, true)).toBe('⌘ Cmd R')
    expect(mappedKeycapLegend([0, 0, 230, 0], definition, false)).toBe('Alt R')
    expect(mappedKeycapLegend([0, 0, 0x45, 0], definition, true)).toBe('F12')
    expect(mappedKeycapLegend([0, 227, 6, 0], definition, true)).toBe('⌘+C')
  })
})
