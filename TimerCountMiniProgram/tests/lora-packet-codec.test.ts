import assert from 'node:assert/strict'
import test from 'node:test'

import { CommandId } from '../miniprogram/protocol/commands'
import {
  encodePacket,
  LoraPacketDecoder,
} from '../miniprogram/protocol/lora-packet-codec'

test('encodes a command without payload using the protocol checksum', () => {
  assert.deepEqual(
    [...encodePacket(CommandId.GetRaceState)],
    [0xaa, 0x03, 0x00, 0x03, 0xf9],
  )
})

test('rejects a payload larger than the protocol maximum', () => {
  assert.throws(
    () => encodePacket(CommandId.GetRaceState, new Uint8Array(231)),
    /payload length must be between 0 and 230/,
  )
})

test('rejects a command id outside one unsigned byte', () => {
  assert.throws(() => encodePacket(0x100), /command id must be between 0 and 255/)
})

test('keeps an incomplete packet until the remaining bytes arrive', () => {
  const decoder = new LoraPacketDecoder()

  assert.deepEqual(decoder.push(Uint8Array.of(0xaa, 0x08, 0x01)), [])
  assert.deepEqual(decoder.push(Uint8Array.of(0x02, 0x0b, 0xf9)), [
    { commandId: 0x08, payload: Uint8Array.of(0x02) },
  ])
})

test('decodes every complete packet from one notification', () => {
  const decoder = new LoraPacketDecoder()
  const first = encodePacket(0x08, Uint8Array.of(0x02))
  const second = encodePacket(0x19, Uint8Array.of(0x00))
  const combined = new Uint8Array(first.length + second.length)
  combined.set(first)
  combined.set(second, first.length)

  assert.deepEqual(decoder.push(combined), [
    { commandId: 0x08, payload: Uint8Array.of(0x02) },
    { commandId: 0x19, payload: Uint8Array.of(0x00) },
  ])
})

test('skips leading noise and a packet with an invalid checksum', () => {
  const decoder = new LoraPacketDecoder()
  const valid = encodePacket(0x08, Uint8Array.of(0x03))
  const bytes = new Uint8Array(1 + 6 + valid.length)
  bytes[0] = 0x00
  bytes.set(Uint8Array.of(0xaa, 0x08, 0x01, 0x02, 0xff, 0xf9), 1)
  bytes.set(valid, 7)

  assert.deepEqual(decoder.push(bytes), [
    { commandId: 0x08, payload: Uint8Array.of(0x03) },
  ])
})
