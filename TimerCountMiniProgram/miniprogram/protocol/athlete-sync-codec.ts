import {
  bytesToHex,
  hexToBytes,
  readUint16BE,
  readUint24BE,
  writeUint16BE,
} from './binary'

export interface AthleteClassification {
  isAthlete: boolean
  epc: string
  athleteId: number | null
}

export interface FirmwareAthleteScore {
  athleteId: number
  lapCount: number
  lapCentiseconds: number
  totalCentiseconds: number
}
export interface FirmwareLapHistoryRecord {
  lapCount: number
  rank: number
  totalCentiseconds: number
}

export interface FirmwareAthleteLapHistory {
  athleteId: number
  records: FirmwareLapHistoryRecord[]
}


export type AthleteTransferState = 'receiving' | 'idle'

export function encodeAthleteDefinition(definition: AthleteClassification): Uint8Array {
  if (!/^[0-9A-F]{8}$/i.test(definition.epc.trim())) {
    throw new Error('EPC 必须是 8 位十六进制字符')
  }
  if (definition.isAthlete
      && (!Number.isInteger(definition.athleteId)
        || definition.athleteId === null
        || definition.athleteId <= 0
        || definition.athleteId > 0xffff)) {
    throw new Error('运动员 ID 必须是 1 到 65535 的整数')
  }
  const epc = hexToBytes(definition.epc)
  const athleteId = writeUint16BE(definition.isAthlete ? definition.athleteId! : 0)
  return Uint8Array.of(definition.isAthlete ? 0x01 : 0x00, ...epc, ...athleteId)
}

export function decodeFirmwareAthleteScore(payload: Uint8Array): FirmwareAthleteScore | null {
  if (payload.length !== 9) return null
  const athleteId = readUint16BE(payload, 0)
  if (athleteId === 0) return null
  return {
    athleteId,
    lapCount: payload[2]!,
    lapCentiseconds: readUint24BE(payload, 3),
    totalCentiseconds: readUint24BE(payload, 6),
  }
}

export function decodeFirmwareAthleteLapHistory(payload: Uint8Array): FirmwareAthleteLapHistory | null {
  if (payload.length < 3) return null
  const athleteId = readUint16BE(payload, 0)
  const recordCount = payload[2]!
  if (athleteId === 0 || recordCount > 10 || payload.length !== 3 + recordCount * 7) {
    return null
  }

  const records: FirmwareLapHistoryRecord[] = []
  for (let index = 0; index < recordCount; index += 1) {
    const offset = 3 + index * 7
    records.push({
      lapCount: readUint16BE(payload, offset),
      rank: readUint16BE(payload, offset + 2),
      totalCentiseconds: readUint24BE(payload, offset + 4),
    })
  }
  return { athleteId, records }
}

export function decodeAthleteTransferState(payload: Uint8Array): AthleteTransferState | null {
  if (payload.length !== 1) return null
  if (payload[0] === 0x01) return 'receiving'
  if (payload[0] === 0x00) return 'idle'
  return null
}

export function decodeOrdinaryEpc(payload: Uint8Array): string | null {
  return payload.length === 4 ? bytesToHex(payload) : null
}
