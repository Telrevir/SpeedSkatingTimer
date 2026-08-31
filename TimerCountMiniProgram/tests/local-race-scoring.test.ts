import assert from 'node:assert/strict'
import test from 'node:test'

import { LocalRaceScoring } from '../miniprogram/domain/local-race-scoring'

test('uses the first firmware score without incrementing its lap', () => {
  const scoring = new LocalRaceScoring()
  scoring.start([1, 2, 3])

  const score = scoring.applyFirmwareScore(1, 0, 0, 100)

  assert.deepEqual(score, {
    athleteId: 1,
    lapCount: 0,
    rawLapCount: 0,
    correctionOffset: 0,
    correctedLapCount: 0,
    addedLaps: 0,
    lapCentiseconds: 0,
    totalCentiseconds: 100,
    currentRank: 1,
    previousRank: 0,
    finished: false,
  })
  assert.equal(scoring.leaderAthleteId, 1)
})

test('uses firmware-provided single-lap time', () => {
  const scoring = new LocalRaceScoring()
  scoring.start([1])
  scoring.applyFirmwareScore(1, 0, 0, 100)

  assert.equal(scoring.applyFirmwareScore(1, 0, 0, 100), null)
  assert.equal(scoring.applyFirmwareScore(1, 0, 0, 99), null)
  const score = scoring.applyFirmwareScore(1, 1, 4900, 5100)

  assert.equal(score?.lapCount, 1)
  assert.equal(score?.lapCentiseconds, 4900)
  assert.equal(score?.totalCentiseconds, 5100)
})

test('keeps firmware single-lap time even when firmware lap skips', () => {
  const scoring = new LocalRaceScoring()
  scoring.start([1])
  scoring.applyFirmwareScore(1, 0, 0, 100)

  const score = scoring.applyFirmwareScore(1, 3, 11_900, 12_000)

  assert.equal(score?.lapCount, 3)
  assert.equal(score?.lapCentiseconds, 11_900)
})

test('ignores athletes outside the locked participant set', () => {
  const scoring = new LocalRaceScoring()
  scoring.start([1])

  assert.equal(scoring.applyFirmwareScore(2, 0, 0, 100), null)
  assert.deepEqual(scoring.snapshot, [])
})

test('ranks by lap descending, total ascending, then athlete ID ascending', () => {
  const scoring = new LocalRaceScoring()
  scoring.start([1, 2, 3, 4])

  scoring.applyFirmwareScore(2, 0, 0, 100)
  scoring.applyFirmwareScore(1, 0, 0, 100)
  scoring.applyFirmwareScore(3, 0, 0, 90)

  assert.deepEqual(
    scoring.snapshot
      .sort((left, right) => left.currentRank - right.currentRank)
      .map(({ athleteId, currentRank }) => [athleteId, currentRank]),
    [[3, 1], [1, 2], [2, 3]],
  )
  assert.equal(scoring.getScore(4), null)

  scoring.applyFirmwareScore(2, 1, 5000, 5100)
  assert.equal(scoring.leaderAthleteId, 2)
  assert.equal(scoring.getScore(2)?.currentRank, 1)
  assert.deepEqual(
    scoring.snapshot.map(({ currentRank }) => currentRank).sort((a, b) => a - b),
    [1, 2, 3],
  )
})

test('captures the leader lap on End and freezes every athlete at that lap', () => {
  const scoring = new LocalRaceScoring()
  scoring.start([1, 2])
  scoring.applyFirmwareScore(1, 0, 0, 100)
  scoring.applyFirmwareScore(1, 1, 5000, 5100)
  scoring.applyFirmwareScore(2, 0, 0, 200)

  assert.equal(scoring.beginFinishing(), 1)
  assert.equal(scoring.phase, 'finishing')
  assert.equal(scoring.finishLap, 1)
  assert.equal(scoring.getScore(1)?.finished, true)

  assert.equal(scoring.applyFirmwareScore(1, 2, 5000, 10100), null)
  scoring.applyFirmwareScore(2, 1, 5100, 5300)

  assert.equal(scoring.getScore(1)?.lapCount, 1)
  assert.equal(scoring.getScore(2)?.lapCount, 1)
  assert.equal(scoring.getScore(2)?.finished, true)
  assert.equal(scoring.phase, 'finished')
})

test('lets an unseen participant finish at lap zero when End captures lap zero', () => {
  const scoring = new LocalRaceScoring()
  scoring.start([1, 2])
  scoring.applyFirmwareScore(1, 0, 0, 100)

  assert.equal(scoring.beginFinishing(), 0)
  assert.equal(scoring.phase, 'finishing')

  const second = scoring.applyFirmwareScore(2, 0, 0, 200)
  assert.equal(second?.lapCount, 0)
  assert.equal(second?.finished, true)
  assert.equal(scoring.phase, 'finished')
})

test('requires a detected leader before End and reset clears the whole session', () => {
  const scoring = new LocalRaceScoring()
  scoring.start([1])

  assert.throws(() => scoring.beginFinishing(), /尚无有效运动员通过，无法结束/)
  scoring.applyFirmwareScore(1, 0, 0, 100)
  scoring.reset()

  assert.equal(scoring.phase, 'idle')
  assert.equal(scoring.finishLap, null)
  assert.equal(scoring.leaderAthleteId, null)
  assert.deepEqual(scoring.snapshot, [])
  assert.equal(scoring.applyFirmwareScore(1, 1, 100, 200), null)
})

test('resumes a cold local session without replacing a live session', () => {
  const scoring = new LocalRaceScoring()
  scoring.resume([1, 2])
  scoring.applyFirmwareScore(1, 2, 5000, 5000)
  scoring.resume([3])

  assert.equal(scoring.phase, 'running')
  assert.equal(scoring.getScore(1)?.lapCount, 2)
  assert.equal(scoring.applyFirmwareScore(3, 0, 0, 100), null)
})

test('rejects regressing and out-of-range firmware scores', () => {
  const scoring = new LocalRaceScoring()
  scoring.start([1])
  scoring.applyFirmwareScore(1, 2, 5000, 5000)

  assert.equal(scoring.applyFirmwareScore(1, 1, 1000, 6000), null)
  assert.equal(scoring.applyFirmwareScore(1, 3, 1000, 4999), null)
  assert.equal(scoring.applyFirmwareScore(1, 256, 1000, 6000), null)
  assert.equal(scoring.applyFirmwareScore(1, 3, 0x1000000, 6000), null)
  assert.equal(scoring.applyFirmwareScore(1, 3, 1000, 0x1000000), null)
})
