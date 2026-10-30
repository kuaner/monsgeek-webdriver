import { recordLabel, recordsEqual } from '../protocol/core'
import type { DeviceDefinition, KeyRecord } from '../protocol/types'

const legends: Record<string, string> = {
  '`': '`  ~', '1': '1  !', '2': '2  @', '3': '3  #', '4': '4  $', '5': '5  %',
  '6': '6  ^', '7': '7  &', '8': '8  *', '9': '9  (', '0': '0  )',
  '-': '-  _', '=': '=  +', '[': '[  {', ']': ']  }', '\\': '\\  |',
  ';': ';  :', "'": "'  \"", ',': ',  <', '.': '.  >', '/': '/  ?',
  BackSpace: '←', Delete: 'Del', 'Caps Lock': 'CapsLk',
  'Page\nUp': 'PgUp', 'Page\nDown': 'PgDn',
  Shift: '⇧ Shift', r_Shift: '⇧ Shift', Ctrl: 'Ctrl', r_Ctrl: 'Ctrl',
  Win: 'Win', Alt: 'Alt', r_Alt: 'Alt', FN: 'Fn', '(space)': '',
}

const macLegends: Record<string, string> = {
  Ctrl: '⌃ Ctrl', r_Ctrl: '⌃ Ctrl', Win: '⌘ Cmd', Alt: '⌥ Opt', r_Alt: '⌥ Opt',
}

/** 按键盘的 Mac/Windows 模式命名修饰键，实体键位坐标与设备矩阵不变。 */
export function keycapLegend(name: string, mac: boolean): string {
  return (mac ? macLegends[name] : undefined) ?? legends[name] ?? name
}
/** 将已改键的实际作用写在键帽上，完整信息仍由按键提示与编辑器显示。 */
export function mappedKeycapLegend(record: KeyRecord, definition: DeviceDefinition, mac: boolean): string {
  if (record[0] === 0 && record[1] === 0 && record[3] === 0) {
    const modifiers = mac
      ? ['⌃ Ctrl', '⇧ Shift', '⌥ Opt', '⌘ Cmd', '⌃ Ctrl R', '⇧ Shift R', '⌥ Opt R', '⌘ Cmd R']
      : ['Ctrl', 'Shift', 'Alt', 'Win', 'Ctrl R', 'Shift R', 'Alt R', 'Win R']
    const modifier = modifiers[(record[2] ?? 0) - 224]
    if (modifier) return modifier
    const physical = definition.keys.find((key) => recordsEqual(key.record, record))
    if (physical) return keycapLegend(physical.name, mac) || 'Space'
  }
  let label = recordLabel(record, definition).replace(/左 |右 /g, '').replaceAll(' + ', '+')
  label = label.replaceAll('Command', mac ? '⌘' : 'Win').replaceAll('Option', mac ? '⌥' : 'Alt')
    .replaceAll('Control', mac ? '⌃' : 'Ctrl').replaceAll('Shift', mac ? '⇧' : 'Shift')
  return label
}
