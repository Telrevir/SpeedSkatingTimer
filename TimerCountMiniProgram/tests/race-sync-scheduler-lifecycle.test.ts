import assert from 'node:assert/strict'
import test from 'node:test'

import type { ApiResult, BackendClient } from '../miniprogram/services/backend-api/request'
import type { RaceBundleDto, RaceInfoDto, ScoreDto } from '../miniprogram/services/backend-api/types'
import { RaceSyncScheduler } from '../miniprogram/services/backend-sync/race-sync-scheduler'
import { RaceOutboxRepository } from '../miniprogram/services/race-outbox-repository'
import { RaceSyncService } from '../miniprogram/services/race-sync-service'
import { ScoreRepository, type LapScoreRecord, type ScoreStorage } from '../miniprogram/services/score-repository'

class Storage implements ScoreStorage {
  value: unknown = null
  failWrites = false
  read(): unknown { return this.value }
  write(value: unknown): void {
    if (this.failWrites) throw new Error('storage failed')
    this.value = structuredClone(value)
  }
}

type Endpoint = 'create-race' | 'create-score' | 'save-race-bundle'
type Request = (endpoint: Endpoint, payload: RaceInfoDto | ScoreDto | RaceBundleDto) => Promise<ApiResult<unknown>>
const now = { value: 1_700_000_000_000 }
const score: LapScoreRecord = { athleteId: 1, name: '甲', epc: '01020304', lap: 1, lapCentiseconds: 3000, totalCentiseconds: 3000, rank: 1 }

function fixture(request: Request) {
  const scoreStorage = new Storage()
  const scoreRepository = new ScoreRepository(scoreStorage, () => now.value)
  const outbox = new RaceOutboxRepository(new Storage(), () => now.value)
  let service!: RaceSyncService
  const scheduler = new RaceSyncScheduler({
    outbox,
    now: () => now.value,
    // 每个测试显式 wake；不会产生真实计时器或外部请求。
    delay: () => null,
    clearDelay: () => undefined,
    execute: (task) => service.execute(task),
  })
  service = new RaceSyncService({
    scoreRepository,
    outbox,
    scheduler,
    client: {} as BackendClient,
    clubId: 1,
    request: (endpoint, payload) => request(endpoint, payload),
  })
  return { scoreStorage, scoreRepository, outbox, scheduler, service }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise<void>((done) => setImmediate(done))
  }
  assert.fail(message)
}

function createReceipt(payload: RaceInfoDto, raceId = 9): Extract<ApiResult<RaceInfoDto>, { ok: true }> {
  return { ok: true, httpStatus: 200, data: { ...payload, RaceID: raceId } }
}

function scoreReceipt(payload: ScoreDto, scoreId = 19): Extract<ApiResult<ScoreDto>, { ok: true }> {
  return { ok: true, httpStatus: 200, data: { ...payload, ScoreID: scoreId } }
}

function completeReceipt(payload: RaceBundleDto, raceId = 9): Extract<ApiResult<RaceBundleDto>, { ok: true }> {
  return {
    ok: true,
    httpStatus: 200,
    data: {
      RaceInfo: { ...payload.RaceInfo, RaceID: raceId, IsFinished: true },
      AthleteRaceJoins: payload.AthleteRaceJoins.map((join, index) => ({ ...join, id: index + 1, RaceID: raceId, Enabled: true })),
      Scores: payload.Scores.map((item, index) => ({ ...item, RaceID: raceId, ScoreID: item.ScoreID ?? index + 10, Enabled: true })),
    },
  }
}

test('scheduler retires a create task only after a timeout result marks the race offline', async () => {
  const pending = deferred<ApiResult<unknown>>()
  let requestCalls = 0
  const { scoreRepository, outbox, scheduler, service } = fixture((endpoint) => {
    requestCalls += 1
    assert.equal(endpoint, 'create-race')
    return pending.promise
  })
  const identity = service.begin([1], now.value)

  assert.equal(scoreRepository.getWorkingCopy(identity.localId)?.syncState, 'pending')
  assert.equal(outbox.listTasks().length, 1)
  await waitFor(() => requestCalls === 1, 'create task did not start')
  pending.resolve({ ok: false, kind: 'network', message: 'bridge timeout' })
  await waitFor(() => outbox.listTasks().length === 0, 'scheduler did not retire handled create task')
  assert.equal(scoreRepository.getWorkingCopy(identity.localId)?.syncState, 'offline')
  scheduler.terminate()
})

test('scheduler sends final bundle only after the score receipt is accepted', async () => {
  const pendingScore = deferred<ApiResult<unknown>>()
  let bundleCalls = 0
  const { scoreRepository, scheduler, service } = fixture((endpoint, payload) => {
    if (endpoint === 'create-race') return Promise.resolve(createReceipt(payload as RaceInfoDto))
    if (endpoint === 'create-score') return pendingScore.promise
    bundleCalls += 1
    return Promise.resolve(completeReceipt(payload as RaceBundleDto))
  })
  const identity = service.begin([1], now.value)
  service.recordScore(identity.localId, score, false)
  service.finish(identity.localId)

  await waitFor(() => bundleCalls === 0 && scoreRepository.getWorkingCopy(identity.localId)?.raceId === 9, 'create was not acknowledged')
  pendingScore.resolve(scoreReceipt({ RaceID: 9, AthleteID: 1, ClientScoreKey: scoreRepository.getWorkingCopy(identity.localId)!.scores[0]!.clientScoreKey, EventSequence: 1, LapCount: 1, SingleLapTime: 3000, TotalTime: 3000, Rank: 1, Enabled: true }))
  await waitFor(() => bundleCalls === 1, 'bundle was not sent after score receipt')
  await waitFor(() => scoreRepository.getWorkingCopy(identity.localId) === null, 'working copy was not removed after complete receipt')
  scheduler.terminate()
})

test('scheduler final bundle failure retains working copy and schedules retry', async () => {
  const { scoreRepository, outbox, scheduler, service } = fixture((endpoint, payload) => (
    endpoint === 'create-race'
      ? Promise.resolve(createReceipt(payload as RaceInfoDto))
      : Promise.resolve({ ok: false, kind: 'network', message: 'temporary' })
  ))
  const identity = service.begin([1], now.value)
  service.finish(identity.localId)

  await waitFor(() => outbox.listTasks().some((task) => task.kind === 'finish' && task.attempt === 1), 'finish retry transition missing')
  const finish = outbox.listTasks().find((task) => task.kind === 'finish')!
  assert.notEqual(scoreRepository.getWorkingCopy(identity.localId), null)
  assert.equal(finish.nextAttemptAt, now.value + 1000)
  scheduler.terminate()
})

test('missing join or duplicate ScoreID receipt preserves working copy and finish task', async () => {
  let responseKind: 'missing-join' | 'duplicate-score' = 'missing-join'
  const { scoreRepository, outbox, scheduler, service } = fixture((endpoint, payload) => {
    if (endpoint === 'create-race') return Promise.resolve(createReceipt(payload as RaceInfoDto))
    if (endpoint === 'create-score') return Promise.resolve(scoreReceipt(payload as ScoreDto))
    const complete = completeReceipt(payload as RaceBundleDto)
    if (responseKind === 'missing-join') complete.data.AthleteRaceJoins = []
    else complete.data.Scores = complete.data.Scores.map((item) => ({ ...item, ScoreID: 10 }))
    return Promise.resolve(complete)
  })
  const identity = service.begin([1], now.value)
  service.recordScore(identity.localId, score, false)
  service.recordScore(identity.localId, { ...score, lap: 2, totalCentiseconds: 6000 }, false)
  service.finish(identity.localId)

  await waitFor(() => outbox.listTasks().some((task) => task.kind === 'finish' && task.attempt === 1), 'missing join did not reject receipt')
  assert.notEqual(scoreRepository.getWorkingCopy(identity.localId), null)
  responseKind = 'duplicate-score'
  now.value += 1_000
  scheduler.wake()
  await waitFor(() => outbox.listTasks().some((task) => task.kind === 'finish' && task.attempt === 2), 'duplicate ScoreID did not reject receipt')
  assert.notEqual(scoreRepository.getWorkingCopy(identity.localId), null)
  scheduler.terminate()
})

test('atomic receipt storage failure keeps records, current selection and subscriptions unchanged', () => {
  const storage = new Storage()
  const repository = new ScoreRepository(storage, () => now.value)
  const race = repository.beginRace([1], now.value)
  const identity = repository.appendScore(score, false)!
  repository.finishRace(race.localId)
  const before = repository.listRaces()
  const persistedBefore = structuredClone(storage.value)
  const observed: number[] = []
  repository.subscribe((records) => observed.push(records.length))
  storage.failWrites = true

  assert.equal(repository.applyFinishedBundleReceipt(race.localId, 9, [{ clientScoreKey: identity.clientScoreKey, scoreId: 10, raceId: 9 }]), false)
  assert.deepEqual(repository.listRaces(), before)
  assert.deepEqual(observed, [1])
  assert.deepEqual(storage.read(), persistedBefore)
})

test('create receipt must confirm an enabled unfinished race before it is accepted', async () => {
  const { scoreRepository, outbox, scheduler, service } = fixture((endpoint, payload) => {
    assert.equal(endpoint, 'create-race')
    const receipt = createReceipt(payload as RaceInfoDto)
    receipt.data.Enabled = false
    return Promise.resolve(receipt)
  })
  const identity = service.begin([1], now.value)

  await waitFor(() => outbox.listTasks().length === 0, 'scheduler did not handle rejected create receipt')
  assert.equal(scoreRepository.getWorkingCopy(identity.localId)?.syncState, 'offline')
  scheduler.terminate()
})

test('single score receipt must match AthleteID, EventSequence and Enabled', async () => {
  const { scoreRepository, outbox, scheduler, service } = fixture((endpoint, payload) => {
    if (endpoint === 'create-race') return Promise.resolve(createReceipt(payload as RaceInfoDto))
    const receipt = scoreReceipt(payload as ScoreDto)
    receipt.data.AthleteID = 2
    return Promise.resolve(receipt)
  })
  const identity = service.begin([1], now.value)
  service.recordScore(identity.localId, score, false)

  await waitFor(() => outbox.listTasks().some((task) => task.kind === 'score' && task.attempt === 1), 'mismatched score receipt was not retried')
  assert.equal(scoreRepository.getWorkingCopy(identity.localId)?.scores[0]!.scoreId, null)
  scheduler.terminate()
})

for (const mismatch of ['AthleteID', 'EventSequence'] as const) {
  test(`complete receipt with wrong ${mismatch} retains working copy and finish task`, async () => {
    const { scoreRepository, outbox, scheduler, service } = fixture((endpoint, payload) => {
      if (endpoint === 'create-race') return Promise.resolve(createReceipt(payload as RaceInfoDto))
      if (endpoint === 'create-score') {
        const item = payload as ScoreDto
        return Promise.resolve(scoreReceipt(item, 20 + item.EventSequence))
      }
      const receipt = completeReceipt(payload as RaceBundleDto)
      if (mismatch === 'AthleteID') receipt.data.Scores[0]!.AthleteID = 2
      else receipt.data.Scores[0]!.EventSequence = 99
      return Promise.resolve(receipt)
    })
    const identity = service.begin([1], now.value)
    service.recordScore(identity.localId, score, false)
    service.finish(identity.localId)

    await waitFor(() => outbox.listTasks().some((task) => task.kind === 'finish' && task.attempt === 1), `${mismatch} was not rejected`)
    assert.notEqual(scoreRepository.getWorkingCopy(identity.localId), null)
    assert.notEqual(outbox.listTasks().find((task) => task.kind === 'finish'), undefined)
    scheduler.terminate()
  })
}
