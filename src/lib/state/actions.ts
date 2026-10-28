// 按键/usage 选择数据：分组（修饰键/字母/数字/功能键/其他）+ 组合与宏共用的 usage 列表。

import { definition } from './controller.svelte'
import { keyDisplayName, MODIFIER_LABELS, usageName } from '../protocol/core'
import type { ChooserItem } from './chooser.svelte'

export { MODIFIER_LABELS }

export const KEY_GROUPS = ['修饰键', '字母', '数字', '功能键', '其他'] as const

/** 按主 usage 归组（仅适用于 [0,0,usage,0] 单键记录）。 */
export function keyGroup(usage: number): string {
  if (usage >= 224 && usage <= 231) return '修饰键'
  if (usage >= 58 && usage <= 72) return '功能键' // F1…F12、PrtSc/ScrLk/Pause
  if (usage >= 30 && usage <= 39) return '数字'   // 1…0 数字行
  if (usage >= 4 && usage <= 29) return '字母'    // A…Z
  return '其他'
}

export interface KeyChoice {
  id: string
  label: string
  group: string
}

export interface KeyChoice {
  id: string
  label: string
  group: string
  usage: number
}

/** 改键「按键」模式的选择数据（物理键 + 合成右修饰键），按组排序；字母按字母序、修饰键按 usage 成对。 */
export function keyChoiceItems(
  choices: { id: string; name: string; record: number[] }[],
): KeyChoice[] {
  const order = KEY_GROUPS as readonly string[]
  return choices
    .filter((a) => a.record[0] === 0 && a.record[1] === 0 && a.record[3] === 0)
    .map((a) => {
      const usage = a.record[2] ?? 0
      return {
        id: a.id,
        label: MODIFIER_LABELS[usage] ?? a.name,
        group: keyGroup(usage),
        usage,
      }
    })
    .sort((a, b) => {
      const byGroup = order.indexOf(a.group) - order.indexOf(b.group)
      if (byGroup !== 0) return byGroup
      if (a.group === '修饰键') return a.usage - b.usage
      if (a.group === '字母') return a.label.localeCompare(b.label, 'en', { sensitivity: 'base' })
      return 0
    })
}

function byGroupOrder(a: ChooserItem, b: ChooserItem): number {
  const order = KEY_GROUPS as readonly string[]
  const ga = order.indexOf(a.group ?? '其他')
  const gb = order.indexOf(b.group ?? '其他')
  return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb)
}

/** 组合键/宏事件用 usage 列表（含全部修饰键，含右修饰键）。 */
export function usageChoices(includeNone: boolean): ChooserItem[] {
  const seen = new Set<number>()
  const list: ChooserItem[] = []
  for (const usage of [224, 225, 226, 227, 228, 229, 230, 231]) {
    seen.add(usage)
    list.push({ id: String(usage), label: MODIFIER_LABELS[usage]!, group: '修饰键' })
  }
  for (const k of definition.keys) {
    if (k.record[0] !== 0 || k.record[1] !== 0 || k.record[3] !== 0) continue
    const usage = k.record[2]!
    if (usage === 0 || seen.has(usage)) continue
    seen.add(usage)
    list.push({ id: String(usage), label: keyDisplayName(k), group: keyGroup(usage) })
  }
  list.sort(byGroupOrder)
  if (includeNone) list.unshift({ id: '0', label: '无', group: '' })
  return list
}
