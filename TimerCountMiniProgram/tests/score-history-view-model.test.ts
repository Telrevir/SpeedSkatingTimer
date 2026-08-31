import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildRaceHistoryTree,
  buildRaceHistoryViewModel,
} from '../miniprogram/pages/scores/view-model'
import type { RaceRecord } from '../miniprogram/services/score-repository'

test('groups original score records by lap without recalculating their ranks', () => {
  const record: RaceRecord = {
    id: 'race-1',
    startedAt: new Date(2026, 7, 31, 9, 30).getTime(),
    finishedAt: new Date(2026, 7, 31, 10, 0).getTime(),
    scores: [
      score(1, '甲', 0, 0, 0, 1),
      score(1, '甲', 1, 3000, 3000, 1),
      score(2, '乙', 1, 3200, 3200, 2),
      score(1, '甲', 2, 3100, 6100, 1),
      score(2, '乙', 2, 3300, 6500, 2),
    ],
  }

  const viewModel = buildRaceHistoryViewModel(record)

  assert.equal(viewModel.totalLaps, 2)
  assert.equal(viewModel.averageLapTime, '00:31.50')
  assert.deepEqual(viewModel.laps.map((lap) => lap.lap), [1, 2])
  assert.equal(viewModel.laps[0]!.leaderName, '甲')
  assert.equal(viewModel.laps[0]!.leaderLapTime, '00:30.00')
  assert.deepEqual(viewModel.laps[0]!.scores.map(({ name, rank }) => ({ name, rank })), [
    { name: '甲', rank: 1 },
    { name: '乙', rank: 2 },
  ])
})

test('excludes automatic correction intervals from average lap time and keeps recorded lap gaps', () => {
  const record: RaceRecord = {
    id: 'race-2',
    startedAt: 1000,
    finishedAt: null,
    scores: [
      score(1, '甲', 1, 3000, 3000, 1),
      score(1, '甲', 2, 3100, 6100, 1),
      score(1, '甲', 4, 6200, 12300, 1, 1),
    ],
  }

  const viewModel = buildRaceHistoryViewModel(record)

  assert.equal(viewModel.totalLaps, 4)
  assert.equal(viewModel.averageLapTime, '00:30.50')
  assert.deepEqual(viewModel.laps.map((lap) => lap.lap), [1, 2, 4])
  assert.equal(viewModel.laps[2]!.scores[0]!.lapTime, '01:02.00')
  assert.equal(viewModel.laps[2]!.scores[0]!.rank, 1)
})

test('applies independent race and lap expansion state to the tree', () => {
  const record: RaceRecord = {
    id: 'race-3',
    startedAt: 1000,
    finishedAt: null,
    scores: [
      score(1, '甲', 1, 3000, 3000, 1),
      score(1, '甲', 2, 3100, 6100, 1),
    ],
  }

  const tree = buildRaceHistoryTree(
    [record],
    new Set(['race-3']),
    new Set(['race-3-lap-2']),
  )

  assert.equal(tree[0]!.expanded, true)
  assert.equal(tree[0]!.laps[0]!.expanded, false)
  assert.equal(tree[0]!.laps[1]!.expanded, true)
  assert.equal(tree[0]!.laps[1]!.expandKey, 'race-3-lap-2')
})

function score(
  athleteId: number,
  name: string,
  lap: number,
  lapCentiseconds: number,
  totalCentiseconds: number,
  rank: number,
  correctionOffset = 0,
) {
  return {
    athleteId,
    name,
    epc: `EPC-${athleteId}`,
    lap,
    rawLap: lap - correctionOffset,
    correctionOffset,
    correctedLap: lap,
    lapCentiseconds,
    totalCentiseconds,
    rank,
  }
}
