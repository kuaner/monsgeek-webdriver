import { isKnobKey } from '../protocol/core'
import type { PhysicalKey } from '../protocol/types'

export const KEYBOARD_WIDTH = 638
export const KEYBOARD_HEIGHT = 288

/** SVG 键帽与点击层共用同一套坐标，避免绘制和交互区域错位。 */
export function keyBounds(key: PhysicalKey, mac = false, keys: readonly PhysicalKey[] = []) {
  const extra = isKnobKey(key) ? 1 : 10
  const counterpart = key.name === 'Win' ? 'Alt' : key.name === 'Alt' ? 'Win' : ''
  const other = mac && counterpart ? keys.find((candidate) => candidate.name === counterpart) ?? key : key
  return { x: other.x - 116 - extra / 2, y: -other.y - 2, width: key.width + extra, height: key.height + 4 }
}

export const KNOB_CENTER = { x: 601, y: 41, radius: 18.3 }

/** 旋钮分为逆时针、按下、顺时针三个相邻的圆内点击区。 */
export function knobBounds(key: PhysicalKey) {
  const { x: cx, y: cy, radius } = KNOB_CENTER
  if (key.index === 6) return { x: cx - radius, y: cy - radius, width: radius * 0.65, height: radius * 2 }
  if (key.index === 94) return { x: cx - radius * 0.3, y: cy - radius, width: radius * 0.6, height: radius * 2 }
  return { x: cx + radius * 0.35, y: cy - radius, width: radius * 0.65, height: radius * 2 }
}

export function knobSector(index: number): string {
  const { x: cx, y: cy, radius: r } = KNOB_CENTER
  const half = r * Math.sqrt(3) / 2
  if (index === 6) return `M${cx} ${cy}L${cx - r / 2} ${cy - half}A${r} ${r} 0 0 0 ${cx - r / 2} ${cy + half}Z`
  if (index === 95) return `M${cx} ${cy}L${cx + r / 2} ${cy - half}A${r} ${r} 0 0 1 ${cx + r / 2} ${cy + half}Z`
  return `M${cx} ${cy}L${cx - r / 2} ${cy - half}A${r} ${r} 0 0 1 ${cx + r / 2} ${cy - half}L${cx} ${cy}L${cx + r / 2} ${cy + half}A${r} ${r} 0 0 1 ${cx - r / 2} ${cy + half}Z`
}
