import assert from 'node:assert/strict'
import test from 'node:test'

import type { Athlete } from '../miniprogram/domain/athlete'
import { formatRelativeTotalTime } from '../miniprogram/domain/relative-total-time'

function athlete(id: number, lapCount: number, totalCentiseconds: number): Athlete {
  return {
    id,
    name: String(id),
    epc: '',
    lapCount,
    lapCentiseconds: 100,
    totalCentiseconds,
    previousRank: 1,
    currentRank: 1,
    hasRaceScore: true,
    finished: false,
  }
}

test('shows the lap deficit when an athlete is lapped', () => {
  assert.equal(
    formatRelativeTotalTime(athlete(2, 3, 12_000), athlete(1, 5, 20_000)),
    '-2',
  )
})

test('shows the positive time gap when athletes are on the same lap', () => {
  assert.equal(
    formatRelativeTotalTime(athlete(2, 5, 24_100), athlete(1, 5, 20_000)),
    '+41.00',
  )
})

test('shows the raw total for the leader or without leader data', () => {
  assert.equal(formatRelativeTotalTime(athlete(1, 5, 20_000), athlete(1, 5, 20_000)), '03:20.00')
  assert.equal(formatRelativeTotalTime(athlete(2, 5, 20_000), null), '03:20.00')
})
