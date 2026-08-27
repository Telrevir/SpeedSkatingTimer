import assert from 'node:assert/strict'
import test from 'node:test'

import { LeaderLapTracker } from '../miniprogram/domain/leader-lap-tracker'

test('uses the first leader score only as a baseline', () => {
  const tracker = new LeaderLapTracker()
  assert.equal(tracker.update(1, 4200), null)
})

test('subtracts every new leader total from the previous baseline', () => {
  const tracker = new LeaderLapTracker()
  tracker.update(1, 4200)
  assert.equal(tracker.update(2, 8250), 4050)
})

test('updates immediately when the leader changes', () => {
  const tracker = new LeaderLapTracker()
  tracker.update(5, 20000)
  assert.equal(tracker.update(4, 24100), 4100)
  assert.equal(tracker.update(4, 28200), 4100)
})

test('updates the baseline even when lap numbers repeat or skip', () => {
  const tracker = new LeaderLapTracker()
  tracker.update(1, 4200)
  assert.equal(tracker.update(1, 8250), 4050)
  assert.equal(tracker.update(3, 12350), 4100)
})

test('uses the raw difference when the new total is lower', () => {
  const tracker = new LeaderLapTracker()
  tracker.update(1, 4200)
  assert.equal(tracker.update(2, 4100), -100)
  assert.equal(tracker.update(3, 8200), 4100)
})
