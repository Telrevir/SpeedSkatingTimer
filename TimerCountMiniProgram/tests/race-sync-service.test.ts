import assert from 'node:assert/strict'
import test from 'node:test'

import { BackendClient } from '../miniprogram/services/backend-api/request'
import { RaceSyncService } from '../miniprogram/services/race-sync-service'
import { RaceOutboxRepository } from '../miniprogram/services/race-outbox-repository'
import { ScoreRepository, type LapScoreRecord } from '../miniprogram/services/score-repository'

class Storage { value: unknown = null; read(): unknown { return this.value }; write(value: unknown): void { this.value = structuredClone(value) } }
class Scheduler { wakes = 0; wake(): void { this.wakes += 1 } }
const score: LapScoreRecord = { athleteId: 1, name: '甲', epc: '01020304', lap: 1, lapCentiseconds: 3000, totalCentiseconds: 3000, rank: 1 }

function fixture(response: (path: string, data: object | undefined) => unknown = () => ({ code: 0, data: {} })) {
  const scoreRepository = new ScoreRepository(new Storage(), () => 1_700_000_000_000)
  const outbox = new RaceOutboxRepository(new Storage(), () => 1_700_000_000_000)
  const scheduler = new Scheduler()
  const client = new BackendClient(async (request) => ({ statusCode: 200, data: response(request.path, request.data) }))
  const service = new RaceSyncService({ scoreRepository, outbox, scheduler, client, clubId: 1 })
  return { scoreRepository, outbox, scheduler, service }
}

test('confirmed firmware start persists pending race before network reply', () => {
  const { scoreRepository, outbox, scheduler, service } = fixture()
  const identity = service.begin([1], 1_700_000_000_000)

  assert.equal(identity.syncState, 'pending')
  assert.equal(scoreRepository.getWorkingCopy(identity.localId)?.clientRaceKey, identity.clientRaceKey)
  assert.equal(outbox.listTasks()[0]!.kind, 'create')
  assert.equal(scheduler.wakes, 1)
})

test('create timeout marks race offline without blocking controls', async () => {
  const { scoreRepository, outbox, service } = fixture(() => ({ code: 500, message: 'bad', data: {} }))
  const identity = service.begin([1], 1_700_000_000_000)
  const create = outbox.listTasks()[0]!

  await service.execute(create)

  assert.equal(scoreRepository.getWorkingCopy(identity.localId)?.syncState, 'offline')
  assert.equal(outbox.listTasks().length, 1)
})

test('lost create response reuses client race key during bundle upload', async () => {
  const requests: object[] = []
  let createAttempt = true
  const { scoreRepository, outbox, service } = fixture((path, data) => {
    requests.push(data ?? {})
    if (path.endsWith('/races') && createAttempt) {
      createAttempt = false
      return { code: 500, message: 'response lost', data: {} }
    }
    if (path.endsWith('/race-bundles')) {
      const body = data as { RaceInfo: { ClientRaceKey: string } }
      return { code: 0, data: { RaceInfo: { RaceID: 77, ClientRaceKey: body.RaceInfo.ClientRaceKey, ClubID: 1, RaceDate: '2023-11-14 22:13:20', IsFinished: true, Enabled: true }, AthleteRaceJoins: [{ id: 1, RaceID: 77, AthleteID: 1, Enabled: true }], Scores: [{ RaceID: 77, ScoreID: 88, AthleteID: 1, ClientScoreKey: (body as unknown as { Scores: [{ ClientScoreKey: string }] }).Scores[0]!.ClientScoreKey, EventSequence: 1, LapCount: 1, SingleLapTime: 3000, TotalTime: 3000, Rank: 1, Enabled: true }] } }
    }
    return { code: 0, data: { RaceID: 77, ClientRaceKey: (data as { ClientRaceKey?: string }).ClientRaceKey, ClubID: 1, RaceDate: '2023-11-14 22:13:20', IsFinished: false, Enabled: true } }
  })
  const identity = service.begin([1], 1_700_000_000_000)
  await service.execute(outbox.listTasks()[0]!)
  assert.equal(scoreRepository.getWorkingCopy(identity.localId)?.syncState, 'offline')
  service.recordScore(identity.localId, score, false)
  service.finish(identity.localId)
  const finish = outbox.listTasks().find(({ kind }) => kind === 'finish')!

  await service.execute(finish)

  assert.equal((requests[requests.length - 1] as { RaceInfo: { ClientRaceKey: string } }).RaceInfo.ClientRaceKey, identity.clientRaceKey)
  assert.equal(scoreRepository.getWorkingCopy(identity.localId), null)
})

test('accepted score persists before its write task becomes runnable', () => {
  const { scoreRepository, outbox, service } = fixture()
  const identity = service.begin([1], 1_700_000_000_000)
  const scoreIdentity = service.recordScore(identity.localId, score, false)!

  assert.equal(scoreRepository.getWorkingCopy(identity.localId)?.scores[0]!.clientScoreKey, scoreIdentity.clientScoreKey)
  assert.equal(outbox.listTasks().find(({ kind }) => kind === 'score')?.dependsOn[0], `${identity.localId}:create`)
})

test('pending score waits for generated race id', async () => {
  const { scoreRepository, outbox, service } = fixture((_path, data) => ({ code: 0, data: { RaceID: 7, ...(data as object) } }))
  const identity = service.begin([1], 1_700_000_000_000)
  service.recordScore(identity.localId, score, false)
  const scoreTask = outbox.listTasks().find(({ kind }) => kind === 'score')!
  assert.equal(outbox.runnableTasks().some(({ taskId }) => taskId === scoreTask.taskId), false)

  await service.execute(outbox.listTasks().find(({ kind }) => kind === 'create')!)
  assert.equal(scoreRepository.getWorkingCopy(identity.localId)?.raceId, 7)
})

test('firmware history replay keeps one client score identity', () => {
  const { scoreRepository, service } = fixture()
  const identity = service.begin([1], 1_700_000_000_000)
  service.recordScore(identity.localId, score, false)
  service.recordScore(identity.localId, score, true)

  assert.equal(scoreRepository.getWorkingCopy(identity.localId)?.scores.length, 1)
})

test('online finish waits for score receipts before final bundle', () => {
  const { outbox, service } = fixture()
  const identity = service.begin([1], 1_700_000_000_000)
  service.recordScore(identity.localId, score, false)
  service.finish(identity.localId)
  const finish = outbox.listTasks().find(({ kind }) => kind === 'finish')!

  assert.equal(finish.dependsOn.some((taskId) => taskId.includes(':score:')), true)
})

test('offline finish remains until normalized upload receipt', () => {
  const { scoreRepository, outbox, service } = fixture()
  const identity = service.begin([1], 1_700_000_000_000)
  scoreRepository.markRaceOffline(identity.localId)
  service.finish(identity.localId)

  assert.notEqual(scoreRepository.getWorkingCopy(identity.localId), null)
  assert.equal(outbox.listTasks().some(({ kind }) => kind === 'finish'), true)
})

test('failed final bundle preserves working copy and outbox', async () => {
  const { scoreRepository, outbox, service } = fixture(() => ({ code: 500, message: 'bad', data: {} }))
  const identity = service.begin([1], 1_700_000_000_000)
  scoreRepository.bindRaceOnline(identity.localId, 9)
  service.finish(identity.localId)
  const finish = outbox.listTasks().find(({ kind }) => kind === 'finish')!

  await service.execute(finish)

  assert.notEqual(scoreRepository.getWorkingCopy(identity.localId), null)
  assert.notEqual(outbox.listTasks().find(({ taskId }) => taskId === finish.taskId), undefined)
})
