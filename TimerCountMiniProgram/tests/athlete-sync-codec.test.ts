import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decodeAthleteTransferState,
  decodeFirmwareAthleteScore,
  decodeOrdinaryEpc,
  encodeAthleteDefinition,
} from '../miniprogram/protocol/athlete-sync-codec'

test('encodes athlete and non-athlete definition payloads', () => {
  assert.deepEqual(
    [...encodeAthleteDefinition({ isAthlete: true, epc: '3333F337', athleteId: 1 })],
    [0x01, 0x33, 0x33, 0xf3, 0x37, 0x00, 0x01],
  )
  assert.deepEqual(
    [...encodeAthleteDefinition({ isAthlete: false, epc: 'aabbccdd', athleteId: null })],
    [0x00, 0xaa, 0xbb, 0xcc, 0xdd, 0x00, 0x00],
  )
})

test('rejects invalid athlete definition fields', () => {
  assert.throws(
    () => encodeAthleteDefinition({ isAthlete: true, epc: '3333F337', athleteId: null }),
    /运动员 ID/,
  )
  assert.throws(
    () => encodeAthleteDefinition({ isAthlete: true, epc: '3333F337', athleteId: 65536 }),
    /运动员 ID/,
  )
  assert.throws(
    () => encodeAthleteDefinition({ isAthlete: false, epc: 'XYZ', athleteId: null }),
    /EPC/,
  )
})

test('decodes firmware athlete scores from fixed-width big-endian fields', () => {
  assert.deepEqual(
    decodeFirmwareAthleteScore(Uint8Array.of(0x00, 0x01, 0x02, 0x01, 0x02, 0x03)),
    { athleteId: 1, lapCount: 2, totalCentiseconds: 0x010203 },
  )
  assert.equal(decodeFirmwareAthleteScore(Uint8Array.of(0, 1, 2, 3, 4)), null)
  assert.equal(decodeFirmwareAthleteScore(Uint8Array.of(0, 0, 2, 1, 2, 3)), null)
})

test('decodes only documented athlete transfer states', () => {
  assert.equal(decodeAthleteTransferState(Uint8Array.of(0x01)), 'receiving')
  assert.equal(decodeAthleteTransferState(Uint8Array.of(0x00)), 'idle')
  assert.equal(decodeAthleteTransferState(Uint8Array.of(0x02)), null)
  assert.equal(decodeAthleteTransferState(Uint8Array.of(0x01, 0x00)), null)
})

test('decodes an ordinary EPC only from four bytes', () => {
  assert.equal(decodeOrdinaryEpc(Uint8Array.of(0x33, 0x33, 0xf3, 0x37)), '3333F337')
  assert.equal(decodeOrdinaryEpc(Uint8Array.of(0x33, 0x33, 0xf3)), null)
})
