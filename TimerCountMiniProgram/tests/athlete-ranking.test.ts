import assert from 'node:assert/strict'
import test from 'node:test'

import type { Athlete } from '../miniprogram/domain/athlete'
import { updateAthleteRank } from '../miniprogram/domain/athlete-ranking'

function athlete(id: number, rank: number): Athlete {
  return {
    id,
    name: String.fromCharCode(64 + id),
    epc: '',
    lapCount: -1,
    lapCentiseconds: -1,
    totalCentiseconds: -1,
    previousRank: rank,
    currentRank: rank,
    hasRaceScore: rank > 0,
    finished: false,
  }
}

test('moves an athlete upward and shifts the affected ranks backward', () => {
  const athletes = new Map([
    [1, athlete(1, 1)],
    [2, athlete(2, 2)],
    [3, athlete(3, 3)],
  ])

  updateAthleteRank(athletes, 3, 1)

  assert.deepEqual(
    [...athletes.values()].map(({ id, currentRank }) => [id, currentRank]),
    [[1, 2], [2, 3], [3, 1]],
  )
})

test('moves an athlete downward and shifts the affected ranks forward', () => {
  const athletes = new Map([
    [1, athlete(1, 1)],
    [2, athlete(2, 2)],
    [3, athlete(3, 3)],
  ])

  updateAthleteRank(athletes, 1, 3)

  assert.deepEqual(
    [...athletes.values()].map(({ id, currentRank }) => [id, currentRank]),
    [[1, 3], [2, 1], [3, 2]],
  )
})

test('inserts an unranked athlete and shifts later ranks backward', () => {
  const athletes = new Map([
    [1, athlete(1, 1)],
    [2, athlete(2, 2)],
    [3, athlete(3, 0)],
  ])

  updateAthleteRank(athletes, 3, 2)

  assert.deepEqual(
    [...athletes.values()].map(({ id, currentRank }) => [id, currentRank]),
    [[1, 1], [2, 3], [3, 2]],
  )
})

test('clears a rank and shifts later ranks forward', () => {
  const athletes = new Map([
    [1, athlete(1, 1)],
    [2, athlete(2, 2)],
    [3, athlete(3, 3)],
  ])

  updateAthleteRank(athletes, 2, 0)

  assert.deepEqual(
    [...athletes.values()].map(({ id, currentRank }) => [id, currentRank]),
    [[1, 1], [2, 0], [3, 2]],
  )
})

test('accumulates rank movement while an athlete is not detected', () => {
  const athletes = new Map([
    [1, athlete(1, 1)],
    [2, athlete(2, 2)],
    [3, athlete(3, 3)],
    [4, athlete(4, 4)],
    [5, athlete(5, 0)],
    [6, athlete(6, 0)],
  ])

  // Two other athletes are detected ahead of athlete 4.
  updateAthleteRank(athletes, 5, 1)
  updateAthleteRank(athletes, 6, 1)

  assert.equal(athletes.get(4)!.currentRank, 6)
  assert.equal(athletes.get(4)!.previousRank, 4)

  // Once athlete 4 is detected, the accumulated movement is cleared.
  updateAthleteRank(athletes, 4, 6)
  assert.equal(athletes.get(4)!.currentRank, 6)
  assert.equal(athletes.get(4)!.previousRank, 6)
})
