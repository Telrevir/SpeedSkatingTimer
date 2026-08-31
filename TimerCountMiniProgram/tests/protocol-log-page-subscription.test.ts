import assert from 'node:assert/strict'
import test from 'node:test'

import { ProtocolLogPageSubscription } from '../miniprogram/services/protocol-log-page-subscription'
import { ProtocolLogStore } from '../miniprogram/stores/protocol-log-store'

test('subscribes once while visible and stops publishing updates while hidden', () => {
  const store = new ProtocolLogStore(500, () => 0)
  const subscription = new ProtocolLogPageSubscription(store)
  const observed: string[][] = []
  const listener = () => {
    observed.push(store.snapshot.map(({ packetHex }) => packetHex))
  }

  subscription.show(listener)
  subscription.show(listener)
  store.record(Uint8Array.of(0xaa))
  subscription.hide()
  store.record(Uint8Array.of(0xbb))
  subscription.show(listener)

  assert.deepEqual(observed, [[], ['AA'], ['BB', 'AA']])
})
