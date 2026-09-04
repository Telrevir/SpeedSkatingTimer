import assert from 'node:assert/strict'
import test from 'node:test'
import type { AthleteProfile } from '../miniprogram/domain/athlete-profile'
import type { AthleteGroup } from '../miniprogram/domain/athlete-group'
import { AthleteCatalogService } from '../miniprogram/services/athlete-catalog-service'
import { AthleteRepository } from '../miniprogram/services/athlete-repository'
import { GroupStore } from '../miniprogram/stores/group-store'
import { ScoreRepository, type RaceRecord } from '../miniprogram/services/score-repository'

class Storage {
  value: unknown = null
  fail = false
  read(): unknown { return this.value }
  write(value: unknown): void {
    if (this.fail) throw new Error('磁盘已满')
    this.value = value
  }
}

function catalog(storage = new Storage()) {
  return new AthleteCatalogService(new AthleteRepository(storage), { now: () => 1000 })
}
function groups(storage = new Storage()) {
  return new GroupStore(storage, () => 1000)
}
function scores(storage = new Storage()) {
  return new ScoreRepository(storage, () => 1000)
}
function profile(id = 42): AthleteProfile {
  return { id, name: ' 张三 ', epc: 'aabbccdd', status: 'active', createdAt: 100, updatedAt: 200, archivedAt: null }
}
function group(id = 'cloud-group'): AthleteGroup {
  return { id, name: ' 一队 ', athleteIds: [1, 2], createdAt: 100, updatedAt: 200 }
}
function record(id = 'cloud-race'): RaceRecord {
  return { id, startedAt: 100, finishedAt: null, scores: [{ athleteId: 1, name: '张三', epc: 'AABBCCDD',
    lap: 3, rawLap: 2, correctionOffset: 2, correctedLap: 3, lapCentiseconds: 123, totalCentiseconds: 456, rank: 1 }] }
}

test('athlete imports preserve IDs, normalize values, clone input and never lower nextId', async () => {
  const service = catalog()
  const incoming = profile()
  assert.equal(await service.importIfMissing(incoming), true)
  incoming.name = 'changed'
  assert.deepEqual([service.activeSnapshot[0]!.id, service.activeSnapshot[0]!.name, service.activeSnapshot[0]!.epc], [42, '张三', 'AABBCCDD'])
  assert.equal(await service.importIfMissing({ ...profile(2), epc: '00000002' }), true)
  assert.equal(service.catalogSnapshot.nextId, 43)
  assert.equal((await service.create('本地新增', '00000003')).id, 43)
})

test('athlete imports never overwrite IDs or reuse EPC from active or archived profiles', async () => {
  const service = catalog()
  await service.importIfMissing(profile())
  const before = service.catalogSnapshot
  assert.equal(await service.importIfMissing({ ...profile(), name: '别名', epc: '00000001' }), false)
  assert.equal(await service.importIfMissing(profile(43)), false)
  assert.deepEqual(service.catalogSnapshot, before)
  await service.archive(42)
  assert.equal(await service.importIfMissing(profile(43)), false)
  assert.equal(await service.importIfMissing({ ...profile(44), epc: '00000002', status: 'archived', archivedAt: 300 }), true)
  assert.equal(service.archivedSnapshot.length, 2)
  assert.equal(service.lookupActiveByEpc('00000002'), null)
})

test('athlete import guard and conflicts are rechecked inside the existing write queue', async () => {
  const service = catalog()
  const create = service.create('本地', 'AABBCCDD')
  const conflicting = service.importIfMissing(profile())
  let canImport = true
  const blocked = service.importIfMissing({ ...profile(43), epc: '00000002' }, () => canImport)
  canImport = false
  await create
  assert.equal(await conflicting, false)
  assert.equal(await blocked, false)
  assert.equal(service.activeSnapshot.length, 1)
})

test('athlete failed persistence leaves memory, revision and notifications unchanged', async () => {
  const storage = new Storage()
  const service = catalog(storage)
  let notifications = 0
  service.subscribe(() => { notifications += 1 })
  const before = service.catalogSnapshot
  storage.fail = true
  await assert.rejects(() => service.importIfMissing(profile()), /磁盘已满/)
  assert.deepEqual(service.catalogSnapshot, before)
  assert.equal(notifications, 1)
})

test('group imports reject ID/name conflicts and preserve selection with independent input/storage copies', () => {
  const storage = new Storage()
  const service = groups(storage)
  const existing = service.create('本地', [3])
  service.select(existing.id)
  const incoming = group()
  assert.equal(service.importIfMissing(incoming), true)
  incoming.athleteIds.push(99)
  assert.equal(service.importIfMissing({ ...group(existing.id), name: '别名' }), false)
  assert.equal(service.importIfMissing(group('another')), false)
  assert.equal(service.active!.id, existing.id)
  assert.deepEqual(service.snapshot[1]!.athleteIds, [1, 2])
  ;(storage.value as AthleteGroup[])[1]!.athleteIds.push(88)
  assert.deepEqual(service.snapshot[1]!.athleteIds, [1, 2])
})

test('group failed persistence leaves memory, selection and notifications unchanged', () => {
  const storage = new Storage()
  const service = groups(storage)
  let notifications = 0
  service.subscribe(() => { notifications += 1 })
  storage.fail = true
  assert.throws(() => service.importIfMissing(group()), /磁盘已满/)
  assert.deepEqual(service.snapshot, [])
  assert.equal(notifications, 1)
})

test('score imports preserve current race, clone data and never overwrite existing IDs', () => {
  const storage = new Storage()
  const service = scores(storage)
  const current = service.beginRace()
  const incoming = { ...record(), participantIds: [1, 2, 2] }
  assert.equal(service.importIfMissing(incoming), true)
  incoming.scores[0]!.lap = 99
  incoming.participantIds.push(3)
  assert.equal(service.importIfMissing({ ...record(), startedAt: 999 }), false)
  service.appendScore(record().scores[0]!, false)
  assert.equal(service.listRaces().find(({ id }) => id === current.id)!.scores.length, 1)
  const imported = service.listRaces().find(({ id }) => id === 'cloud-race')! as RaceRecord & { participantIds: number[] }
  assert.equal(imported.scores[0]!.lap, 3)
  assert.deepEqual(imported.participantIds, [1, 2])
  imported.participantIds.push(4)
  assert.deepEqual((service.listRaces().find(({ id }) => id === 'cloud-race')! as typeof imported).participantIds, [1, 2])
})

test('score failed persistence leaves memory and notifications unchanged', () => {
  const storage = new Storage()
  const service = scores(storage)
  let notifications = 0
  service.subscribe(() => { notifications += 1 })
  storage.fail = true
  assert.throws(() => service.importIfMissing(record()), /磁盘已满/)
  assert.deepEqual(service.listRaces(), [])
  assert.equal(notifications, 1)
})

test('import entrypoints reject invalid minimum fields instead of storing corrupt records', async () => {
  const athletes = catalog()
  for (const incoming of [{ ...profile(), id: 0 }, { ...profile(), id: 65536 }, { ...profile(), name: '' },
    { ...profile(), epc: 'invalid' }, { ...profile(), createdAt: NaN }]) {
    await assert.rejects(() => athletes.importIfMissing(incoming))
  }
  const groupStore = groups()
  for (const incoming of [{ ...group(), id: '' }, { ...group(), name: '' }, { ...group(), athleteIds: [65536] }]) {
    assert.throws(() => groupStore.importIfMissing(incoming))
  }
  const scoreStore = scores()
  for (const incoming of [{ ...record(), id: '' }, { ...record(), startedAt: NaN },
    { ...record(), scores: [{ ...record().scores[0]!, totalCentiseconds: -1 }] },
    { ...record(), participantIds: [0] }]) {
    assert.throws(() => scoreStore.importIfMissing(incoming))
  }
})
