import assert from 'node:assert/strict'
import test from 'node:test'
import { SyncIdMapping } from '../miniprogram/services/backend-sync/id-mapping'
import { toRaceBundle, fromRaceBundle } from '../miniprogram/services/backend-sync/race-mapping'

function storage() {
  return { value: undefined as unknown, read() { return this.value }, write(value: unknown) { this.value = JSON.parse(JSON.stringify(value)) } }
}

test('stable IDs survive restart, avoid reserved IDs and isolate clubs', () => {
  const state = storage()
  const first = new SyncIdMapping(state, 1, () => 1000, () => 0)
  first.reserve('race', [1024000])
  const raceId = first.assign('race', 'local-a')
  const groupId = first.assign('group', 'local-group')
  assert.equal(raceId, 1024001)
  assert.ok(groupId > 0 && groupId <= 0x7fffffff)
  first.save()
  const resumed = new SyncIdMapping(state, 1, () => 9000, () => 0.5)
  assert.equal(resumed.assign('race', 'local-a'), raceId)
  const other = new SyncIdMapping(state, 2, () => 9000, () => 0.5)
  assert.notEqual(other.assign('race', 'local-a'), raceId)
  other.save()
  assert.equal(new SyncIdMapping(state, 1).assign('race', 'local-a'), raceId)
})

test('corrupt mappings and occupied bindings are never silently replaced', () => {
  const state = storage()
  state.value = { schemaVersion: 3 }
  assert.throws(() => new SyncIdMapping(state, 1))
  state.value = undefined
  const ids = new SyncIdMapping(state, 1)
  ids.bind('race', 'local-a', 50)
  assert.throws(() => ids.bind('race', 'local-a', 51))
  assert.throws(() => ids.bind('race', 'local-b', 50))
  assert.throws(() => ids.bind('race', 'invalid', Number.MAX_SAFE_INTEGER + 1))
})

test('race mapping omits RaceID on first upload and reuses the bound RaceID afterwards', () => {
  const state = storage()
  const ids = new SyncIdMapping(state, 1, () => 1000, () => 0)
  const local = { id: 'local-race', startedAt: new Date(2026, 8, 3, 10).getTime(), finishedAt: null,
    scores: [{ athleteId: 7, name: '甲', epc: '0000000A', lap: 4, rawLap: 3, correctionOffset: 1, correctedLap: 4, lapCentiseconds: 6100, totalCentiseconds: 12300, rank: 2 }] }
  // 首次添加：RaceID 与 ClientRaceID 都不携带，由后端生成。
  const create = toRaceBundle(local, 1, ids)
  assert.equal(create.RaceInfo.RaceID, undefined)
  assert.equal('ClientRaceID' in create.RaceInfo, false)
  assert.equal(create.RaceInfo.RaceDate, '2026-09-03 10:00:00')
  assert.equal(create.AthleteRaceJoins.length, 1)
  assert.equal(create.AthleteRaceJoins[0]!.RaceID, undefined)
  assert.equal(create.Scores.length, 1)
  assert.equal(create.Scores[0]!.SingleLapTime, 6100)
  assert.equal(create.Scores[0]!.TotalTime, 12300)
  assert.equal('RawLap' in create.Scores[0]!, false)
  assert.equal('CorrectionOffset' in create.Scores[0]!, false)
  assert.equal(create.Scores[0]!.Rank, 2)
  // 绑定后端返回的 RaceID 后，再次转换会携带该 ID（更新/重传），子记录保持一致。
  ids.bind('race', local.id, 55)
  const update = toRaceBundle(local, 1, ids)
  assert.equal(update.RaceInfo.RaceID, 55)
  assert.equal(update.AthleteRaceJoins[0]!.RaceID, 55)
  assert.equal(update.Scores[0]!.RaceID, 55)
  assert.equal(update.AthleteRaceJoins[0]!.id, create.AthleteRaceJoins[0]!.id)
  assert.equal(update.Scores[0]!.ScoreID, create.Scores[0]!.ScoreID)
  state.write = () => { throw new Error('full') }
  assert.throws(() => ids.save())
})

test('server history joins current athlete data and does not fabricate finish time', () => {
  const ids = new SyncIdMapping(storage(), 1)
  const bundle = toRaceBundle({ id: 'local', startedAt: new Date(2026, 8, 3, 10).getTime(), finishedAt: null,
    scores: [{ athleteId: 7, name: '旧姓名', epc: '00000001', lap: 2, lapCentiseconds: 3000, totalCentiseconds: 6000, rank: 1 }] }, 1, ids)
  const result = fromRaceBundle(bundle, [{ AthleteID: 7, ClubID: 1, AthleteName: '新姓名', AthleteEPC: 10, Enabled: true }], 'restored')
  assert.equal(result.id, 'restored')
  assert.equal(result.finishedAt, null)
  assert.equal(result.scores[0]!.name, '新姓名')
  assert.equal(result.scores[0]!.epc, '0000000A')
  assert.equal(result.scores[0]!.lapCentiseconds, 3000)
})
