import type { MacroEvent } from '../protocol/types'

const CODES: Record<string, number> = {
  Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44, Minus: 45, Equal: 46,
  BracketLeft: 47, BracketRight: 48, Backslash: 49, IntlHash: 50, Semicolon: 51,
  Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56, CapsLock: 57,
  PrintScreen: 70, ScrollLock: 71, Pause: 72, Insert: 73, Home: 74, PageUp: 75,
  Delete: 76, End: 77, PageDown: 78, ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81,
  ArrowUp: 82, NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85,
  NumpadSubtract: 86, NumpadAdd: 87, NumpadEnter: 88, Numpad0: 98,
  NumpadDecimal: 99, IntlBackslash: 100, ContextMenu: 101, NumpadEqual: 103,
  ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227,
  ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231,
}

/** KeyboardEvent.code is a physical key identity, independent of the text layout. */
export function usageForCode(code: string): number | null {
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3) - 65 + 4
  if (/^Digit[1-9]$/.test(code)) return Number(code[5]) - 1 + 30
  if (code === 'Digit0') return 39
  if (/^F([1-9]|1[0-2])$/.test(code)) return Number(code.slice(1)) + 57
  if (/^Numpad[1-9]$/.test(code)) return Number(code.slice(6)) + 88
  return CODES[code] ?? null
}

export type CaptureResult = 'recorded' | 'ignored' | 'unsupported' | 'full' | 'delay-clamped'

/** Collects only browser-delivered keyboard events; no device writes occur here. */
export class MacroRecorder {
  private readonly held = new Set<number>()
  private lastTime: number | null = null
  private captured: MacroEvent[] = []

  get events(): MacroEvent[] { return this.captured.map((event) => ({ ...event })) }
  get heldCount(): number { return this.held.size }

  capture(code: string, down: boolean, time: number, repeat = false): CaptureResult {
    const usage = usageForCode(code)
    if (usage === null) return 'unsupported'
    if (repeat || (down && this.held.has(usage)) || (!down && !this.held.has(usage))) return 'ignored'
    // Reserve a release event for every pressed key, including this new press.
    if (down && this.captured.length + this.held.size + 2 > 62) return 'full'
    const clamped = this.append(usage, down, time)
    if (down) this.held.add(usage)
    else this.held.delete(usage)
    return clamped ? 'delay-clamped' : 'recorded'
  }

  stop(time: number): boolean {
    const hadHeldKeys = this.held.size > 0
    for (const usage of this.held) this.append(usage, false, time)
    this.held.clear()
    return hadHeldKeys
  }

  private append(usage: number, down: boolean, time: number): boolean {
    let clamped = false
    if (this.lastTime !== null && this.captured.length > 0) {
      const delay = Math.max(0, Math.round(time - this.lastTime))
      this.captured[this.captured.length - 1]!.delay = Math.min(delay, 65535)
      clamped = delay > 65535
    }
    this.captured.push({ usage, down, delay: 0 })
    this.lastTime = time
    return clamped
  }
}
