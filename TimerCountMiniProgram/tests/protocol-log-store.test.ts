import assert from 'node:assert/strict'
import test from 'node:test'

import { ProtocolLogStore } from '../miniprogram/stores/protocol-log-store'

test('records a received packet with a timestamp and spaced uppercase hexadecimal bytes', () => {
  const receivedAt = new Date(2026, 7, 27, 15, 4, 5, 67).getTime()
  const store = new ProtocolLogStore(500, () => receivedAt)

  store.record(Uint8Array.of(0xaa, 0x12, 0x02, 0x00, 0xff, 0x13, 0xf9))

  assert.deepEqual(store.snapshot, [{
    id: 1,
    receivedAt,
    timestamp: '2026-08-27 15:04:05.067',
    packetHex: 'AA 12 02 00 FF 13 F9',
  }])
})

test('keeps only the newest entries up to the configured capacity', () => {
  const store = new ProtocolLogStore(2, () => 0)

  store.record(Uint8Array.of(0x01))
  store.record(Uint8Array.of(0x02))
  store.record(Uint8Array.of(0x03))

  assert.deepEqual(store.snapshot.map(({ packetHex }) => packetHex), ['03', '02'])
})

test('publishes snapshots when entries are recorded or cleared and supports unsubscribe', () => {
  const store = new ProtocolLogStore(500, () => 0)
  const observed: string[][] = []
  const unsubscribe = store.subscribe((entries) => {
    observed.push(entries.map(({ packetHex }) => packetHex))
  })

  store.record(Uint8Array.of(0xaa))
  store.clear()
  unsubscribe()
  store.record(Uint8Array.of(0xbb))

  assert.deepEqual(observed, [[], ['AA'], []])
})
