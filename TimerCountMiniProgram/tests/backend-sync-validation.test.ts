import assert from 'node:assert/strict'
import test from 'node:test'
import type { ClubDataDto } from '../miniprogram/services/backend-api/sync-data'
import * as validation from '../miniprogram/services/backend-sync/validation'

function api() { return validation }

function snapshot(): ClubDataDto {
  return {
    ClubID: 1,
    Athletes: [{ AthleteID: 1, ClubID: 1, AthleteName: '张三', AthleteEPC: 4294967295, Enabled: true }],
    AthleteGroups: [{ AthleteGroupID: 2, ClubID: 1, AthleteGroupName: '一队', Enabled: true }],
    AthleteGroupForms: [{ AthleteGroupFormID: 3, AthleteGroupID: 2, AthleteID: 1, Enabled: true }],
    RaceBundles: [{
      RaceInfo: { RaceID: 4, ClubID: 1, RaceDate: '2024-02-29 12:34:56', Enabled: true },
      AthleteRaceJoins: [{ id: 5, RaceID: 4, AthleteID: 1, Enabled: true }],
      Scores: [{ ScoreID: 6, RaceID: 4, AthleteID: 1, LapCount: 10,
        SingleLapTime: 1234, TotalTime: 2147483647, Rank: 1, Enabled: true }],
    }],
  }
}

test('valid snapshot is independently cloned, defaults Enabled and keeps centiseconds unchanged', () => {
  const value = snapshot()
  delete (value.Athletes[0] as Partial<ClubDataDto['Athletes'][number]>).Enabled
  const result = api().validateClubData(value, 1)
  assert.equal(result.Athletes[0]!.Enabled, true)
  assert.equal(result.RaceBundles[0]!.Scores[0]!.TotalTime, 2147483647)
  result.RaceBundles[0]!.Scores[0]!.LapCount = 100
  assert.equal(value.RaceBundles[0]!.Scores[0]!.LapCount, 10)
  assert.deepEqual(api().validateClubData({ ClubID: 1, Athletes: [], AthleteGroups: [], AthleteGroupForms: [], RaceBundles: [] }, 1),
    { ClubID: 1, Athletes: [], AthleteGroups: [], AthleteGroupForms: [], RaceBundles: [] })
})

const invalidCases: Array<[string, (value: ClubDataDto) => void]> = [
  ['club mismatch', (v) => { v.ClubID = 2 }],
  ['athlete club mismatch', (v) => { v.Athletes[0]!.ClubID = 2 }],
  ['group club mismatch', (v) => { v.AthleteGroups[0]!.ClubID = 2 }],
  ['race club mismatch', (v) => { v.RaceBundles[0]!.RaceInfo.ClubID = 2 }],
  ['athlete zero ID', (v) => { v.Athletes[0]!.AthleteID = 0 }],
  ['athlete oversized ID', (v) => { v.Athletes[0]!.AthleteID = 65536 }],
  ['unsafe group ID', (v) => { v.AthleteGroups[0]!.AthleteGroupID = Number.MAX_SAFE_INTEGER + 1 }],
  ['fractional form ID', (v) => { v.AthleteGroupForms[0]!.AthleteGroupFormID = 1.5 }],
  ['negative EPC', (v) => { v.Athletes[0]!.AthleteEPC = -1 }],
  ['oversized EPC', (v) => { v.Athletes[0]!.AthleteEPC = 4294967296 }],
  ['empty athlete name', (v) => { v.Athletes[0]!.AthleteName = '  ' }],
  ['oversized UTF8 athlete name', (v) => { v.Athletes[0]!.AthleteName = '张'.repeat(11) }],
  ['empty group name', (v) => { v.AthleteGroups[0]!.AthleteGroupName = ' ' }],
  ['duplicate athlete ID', (v) => { v.Athletes.push({ ...v.Athletes[0]!, AthleteEPC: 2 }) }],
  ['duplicate EPC', (v) => { v.Athletes.push({ ...v.Athletes[0]!, AthleteID: 2 }) }],
  ['duplicate group ID', (v) => { v.AthleteGroups.push({ ...v.AthleteGroups[0]! }) }],
  ['duplicate form ID', (v) => { v.AthleteGroupForms.push({ ...v.AthleteGroupForms[0]! }) }],
  ['missing parent group', (v) => { v.AthleteGroupForms[0]!.AthleteGroupID = 99 }],
  ['missing form athlete', (v) => { v.AthleteGroupForms[0]!.AthleteID = 99 }],
  ['disabled dangling form', (v) => { v.AthleteGroupForms[0]!.Enabled = false; v.AthleteGroupForms[0]!.AthleteID = 99 }],
  ['invalid race date', (v) => { v.RaceBundles[0]!.RaceInfo.RaceDate = '2025-02-29 12:34:56' }],
  ['missing race ID on server snapshot', (v) => { delete (v.RaceBundles[0]!.RaceInfo as Partial<ClubDataDto['RaceBundles'][number]['RaceInfo']>).RaceID }],
  ['duplicate race ID', (v) => { v.RaceBundles.push({ ...v.RaceBundles[0]!, AthleteRaceJoins: [], Scores: [] }) }],
  ['join wrong race', (v) => { v.RaceBundles[0]!.AthleteRaceJoins[0]!.RaceID = 99 }],
  ['join unknown athlete', (v) => { v.RaceBundles[0]!.AthleteRaceJoins[0]!.AthleteID = 99 }],
  ['join duplicate athlete', (v) => { v.RaceBundles[0]!.AthleteRaceJoins.push({ ...v.RaceBundles[0]!.AthleteRaceJoins[0]!, id: 7 }) }],
  ['score wrong race', (v) => { v.RaceBundles[0]!.Scores[0]!.RaceID = 99 }],
  ['score missing athlete', (v) => { v.RaceBundles[0]!.Scores[0]!.AthleteID = 99 }],
  ['score missing join', (v) => { v.RaceBundles[0]!.AthleteRaceJoins = [] }],
  ['duplicate score ID', (v) => { v.RaceBundles[0]!.Scores.push({ ...v.RaceBundles[0]!.Scores[0]! }) }],
  ['negative score time', (v) => { v.RaceBundles[0]!.Scores[0]!.SingleLapTime = -1 }],
  ['fractional score time', (v) => { v.RaceBundles[0]!.Scores[0]!.TotalTime = 0.1 }],
  ['oversized score time', (v) => { v.RaceBundles[0]!.Scores[0]!.TotalTime = 2147483648 }],
  ['invalid lap', (v) => { v.RaceBundles[0]!.Scores[0]!.LapCount = NaN }],
  ['infinite rank', (v) => { v.RaceBundles[0]!.Scores[0]!.Rank = Infinity }],
]
for (const [name, mutate] of invalidCases) {
  test(`rejects entire snapshot: ${name}`, () => {
    const value = snapshot()
    mutate(value)
    assert.throws(() => api().validateClubData(value, 1))
  })
}

test('rejects malformed arrays, records and non-boolean Enabled', () => {
  for (const value of [null, {}, { ...snapshot(), Athletes: null }, { ...snapshot(), Athletes: [null] },
    { ...snapshot(), Athletes: [{ ...snapshot().Athletes[0], Enabled: 'false' }] }]) {
    assert.throws(() => api().validateClubData(value, 1))
  }
})

test('primary keys are globally unique across race bundles for joins and scores', () => {
  for (const entity of ['join', 'score']) {
    const value = snapshot()
    const other = snapshot().RaceBundles[0]!
    other.RaceInfo.RaceID = 7
    other.AthleteRaceJoins[0]!.RaceID = 7
    other.Scores[0]!.RaceID = 7
    if (entity === 'join') other.Scores[0]!.ScoreID = 8
    else other.AthleteRaceJoins[0]!.id = 8
    value.RaceBundles.push(other)
    assert.throws(() => api().validateClubData(value, 1))
  }
})

test('race dates strictly parse local calendar fields without rollover', () => {
  assert.equal(api().parseRaceDate('2024-02-29 12:34:56'), new Date(2024, 1, 29, 12, 34, 56).getTime())
  for (const value of ['2025-02-29 00:00:00', '2024-04-31 00:00:00', '2024-13-01 00:00:00',
    '2024-01-00 00:00:00', '2024-01-01 24:00:00', '2024-01-01 00:60:00',
    '2024-01-01 00:00:60', '2024-1-01 00:00:00', '2024-01-01T00:00:00Z']) {
    assert.throws(() => api().parseRaceDate(value))
  }
})

test('null required score fields still fail', () => {
  for (const field of ['ScoreID', 'AthleteID', 'LapCount', 'SingleLapTime', 'TotalTime', 'Rank', 'Enabled']) {
    const invalid = snapshot()
    Object.assign(invalid.RaceBundles[0]!.Scores[0]!, { [field]: null })
    assert.throws(() => api().validateClubData(invalid, 1))
  }
})

test('upload payload may omit RaceID when raceIdOptional and keeps child references without RaceID', () => {
  const create = snapshot()
  const raceInfo = create.RaceBundles[0]!.RaceInfo
  delete (raceInfo as Partial<ClubDataDto['RaceBundles'][number]['RaceInfo']>).RaceID
  delete (create.RaceBundles[0]!.AthleteRaceJoins[0] as Partial<ClubDataDto['RaceBundles'][number]['AthleteRaceJoins'][number]>).RaceID
  delete (create.RaceBundles[0]!.Scores[0] as Partial<ClubDataDto['RaceBundles'][number]['Scores'][number]>).RaceID
  const result = api().validateClubData(create, 1, { raceIdOptional: true })
  assert.equal('RaceID' in result.RaceBundles[0]!.RaceInfo, false)
  assert.equal('RaceID' in result.RaceBundles[0]!.Scores[0]!, false)
  assert.equal(result.RaceBundles[0]!.Scores[0]!.TotalTime, 2147483647)
})

test('upload payload without raceIdOptional still requires RaceID and matching child RaceID', () => {
  const create = snapshot()
  delete (create.RaceBundles[0]!.RaceInfo as Partial<ClubDataDto['RaceBundles'][number]['RaceInfo']>).RaceID
  delete (create.RaceBundles[0]!.AthleteRaceJoins[0] as Partial<ClubDataDto['RaceBundles'][number]['AthleteRaceJoins'][number]>).RaceID
  delete (create.RaceBundles[0]!.Scores[0] as Partial<ClubDataDto['RaceBundles'][number]['Scores'][number]>).RaceID
  assert.throws(() => api().validateClubData(create, 1))
})
