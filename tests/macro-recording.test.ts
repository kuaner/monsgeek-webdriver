import { describe, expect, it } from 'vitest'
import { macroEncoded } from '../src/lib/protocol/core'
import { MacroRecorder, usageForCode } from '../src/lib/state/macro-recording'

describe('键盘宏录制', () => {
  it('记录物理按键顺序及事件后的间隔，忽略系统重复', () => {
    const recorder = new MacroRecorder()
    expect(usageForCode('MetaLeft')).toBe(227)
    expect(usageForCode('KeyC')).toBe(6)
    expect(recorder.capture('MetaLeft', true, 100)).toBe('recorded')
    recorder.capture('KeyC', true, 130)
    expect(recorder.capture('KeyC', true, 135, true)).toBe('ignored')
    recorder.capture('KeyC', false, 170)
    recorder.capture('MetaLeft', false, 190)
    recorder.stop(200)
    expect(recorder.events).toEqual([
      { usage: 227, down: true, delay: 30 },
      { usage: 6, down: true, delay: 40 },
      { usage: 6, down: false, delay: 20 },
      { usage: 227, down: false, delay: 0 },
    ])
    expect(() => macroEncoded({ repeatCount: 1, events: recorder.events })).not.toThrow()
  })

  it('停止时补齐仍按住的键，忽略未按下的释放', () => {
    const recorder = new MacroRecorder()
    expect(recorder.capture('KeyA', false, 0)).toBe('ignored')
    recorder.capture('KeyA', true, 10)
    expect(recorder.stop(40)).toBe(true)
    expect(recorder.events).toEqual([
      { usage: 4, down: true, delay: 30 }, { usage: 4, down: false, delay: 0 },
    ])
  })

  it('容量限制为每个按住的键保留松开事件', () => {
    const recorder = new MacroRecorder()
    for (let i = 0; i < 31; i++) {
      recorder.capture('KeyA', true, i * 2)
      recorder.capture('KeyA', false, i * 2 + 1)
    }
    expect(recorder.capture('KeyB', true, 100)).toBe('full')
    expect(recorder.events).toHaveLength(62)
    expect(() => macroEncoded({ repeatCount: 1, events: recorder.events })).not.toThrow()
  })
})
