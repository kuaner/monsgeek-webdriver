import m1wJson from '../assets/m1w.json'
import m7wJson from '../assets/m7w.json'
import { infoDeviceID } from '../protocol/core'
import type { DeviceDefinition, DeviceInfo } from '../protocol/types'

export const m1wDefinition = m1wJson as DeviceDefinition
export const m7wDefinition = m7wJson as DeviceDefinition

/** PID 4013 is shared: the 8F device ID, not the Bluetooth name, selects the layout. */
export function definitionForInfo(info: DeviceInfo | null): DeviceDefinition | null {
  if (!info) return null
  switch (infoDeviceID(info)) {
    case 983: return m1wDefinition
    case 1215: return m7wDefinition
    default: return null
  }
}

export function modelName(info: DeviceInfo | null): string | null {
  const model = definitionForInfo(info)
  return model === m1wDefinition ? 'M1W' : model === m7wDefinition ? 'M7W' : null
}
