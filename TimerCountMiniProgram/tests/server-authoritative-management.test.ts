import assert from 'node:assert/strict'
import test from 'node:test'

import { AthleteCatalogService } from '../miniprogram/services/athlete-catalog-service'
import { AthleteManagementService } from '../miniprogram/services/athlete-management-service'
import { AthleteRepository } from '../miniprogram/services/athlete-repository'
import { BackendClient, type TransportRequest } from '../miniprogram/services/backend-api/request'
import { CatalogCacheRepository } from '../miniprogram/services/catalog-cache-repository'
import { GroupManagementService } from '../miniprogram/services/group-management-service'
import { GroupStore } from '../miniprogram/stores/group-store'
import { SyncIdMapping } from '../miniprogram/services/backend-sync/id-mapping'

class Storage {
  value: unknown = null
  writes = 0
  failNextWrite = false

  read(): unknown { return this.value }
  write(value: unknown): void {
    if (this.failNextWrite) {
      this.failNextWrite = false
      throw new Error('storage-full')
    }
    this.writes += 1
    this.value = JSON.parse(JSON.stringify(value))
  }
}

function initial(cache: CatalogCacheRepository) {
  cache.replaceFromServer(1, {
    schemaVersion: 1,
    revision: 1,
    nextId: 2,
    idReusePolicy: 'never',
    athletes: [{ id: 1, name: '甲', epc: '00000001', status: 'active', createdAt: 1, updatedAt: 1, archivedAt: null }],
    activeEpcIndex: { '00000001': 1 },
  }, [{ id: '7', name: '一组', athleteIds: [1], createdAt: 1, updatedAt: 1 }])
}

function services(cache: CatalogCacheRepository) {
  const athletes = new AthleteCatalogService(new AthleteRepository(new Storage()), { now: () => 1000 })
  const groups = new GroupStore(new Storage(), () => 1000)
  athletes.replaceFromServer(cache.load(1).athletes)
  groups.replaceFromServer(cache.load(1).groups)
  return { athletes, groups }
}

function response(data: unknown) {
  return { statusCode: 200, data: { code: 0, data } }
}

function mappingStorage() {
  return new Storage()
}

test('failed athlete update leaves cache and subscribers unchanged', async () => {
  const storage = new Storage()
  const cache = new CatalogCacheRepository(storage)
  initial(cache)
  const { athletes, groups } = services(cache)
  let notifications = 0
  athletes.subscribe(() => { notifications += 1 })
  const client = new BackendClient(async () => ({ statusCode: 200, data: { code: 9, message: 'duplicate' } }))
  const management = new AthleteManagementService({ clubId: 1, cache, athleteCatalog: athletes, groupStore: groups, client })
  const before = cache.load(1)

  const result = await management.update(1, '乙', '00000002')

  assert.equal(result.ok, false)
  assert.deepEqual(cache.load(1), before)
  assert.equal(storage.writes, 1)
  assert.equal(notifications, 1)
})

test('group bundle receipt commits name and full membership together', async () => {
  const storage = new Storage()
  const cache = new CatalogCacheRepository(storage)
  initial(cache)
  const { athletes, groups } = services(cache)
  const client = new BackendClient(async (request: TransportRequest) => {
    assert.equal(request.method, 'PUT')
    return response(request.data)
  })
  const management = new GroupManagementService({ clubId: 1, cache, athleteCatalog: athletes, groupStore: groups, client, mappingStorage: mappingStorage(), now: () => 1000 })

  const result = await management.update('7', '新一组', [1])

  assert.equal(result.ok, true)
  assert.equal(storage.writes, 2)
  assert.deepEqual(cache.load(1).groups, [{
    id: '7', name: '新一组', athleteIds: [1], createdAt: 1, updatedAt: 1000,
    enabled: true, memberEnabled: { '1': true },
  }])
  assert.deepEqual(groups.snapshot[0]!.athleteIds, [1])
})

test('offline management rejects before any cache write', async () => {
  const storage = new Storage()
  const cache = new CatalogCacheRepository(storage)
  initial(cache)
  const { athletes, groups } = services(cache)
  const client = new BackendClient(async () => { throw new Error('offline') })
  const management = new AthleteManagementService({ clubId: 1, cache, athleteCatalog: athletes, groupStore: groups, client })

  const result = await management.create('乙', '00000002')

  assert.equal(result.ok, false)
  assert.equal(storage.writes, 1)
  assert.equal(cache.load(1).athletes.athletes.length, 1)
})

test('server success with local cache failure reports the refresh warning and refreshes immediately', async () => {
  const storage = new Storage()
  const cache = new CatalogCacheRepository(storage)
  initial(cache)
  const { athletes, groups } = services(cache)
  storage.failNextWrite = true
  let refreshes = 0
  const client = new BackendClient(async () => response({
    AthleteID: 1, ClubID: 1, AthleteName: '乙', AthleteEPC: 2, Enabled: true,
  }))
  const management = new AthleteManagementService({
    clubId: 1, cache, athleteCatalog: athletes, groupStore: groups, client,
    refresh: async () => { refreshes += 1 },
  })

  const result = await management.update(1, '乙', '00000002')

  assert.deepEqual(result, { ok: false, message: '服务器已保存，本地刷新失败' })
  assert.equal(refreshes, 1)
  assert.equal(cache.load(1).athletes.athletes[0]!.name, '甲')
})

test('archive and restore update only after matching server receipts', async () => {
  const storage = new Storage()
  const cache = new CatalogCacheRepository(storage)
  initial(cache)
  const { athletes, groups } = services(cache)
  const enabled: boolean[] = []
  const client = new BackendClient(async (request: TransportRequest) => {
    const body = request.data as { Enabled: boolean; AthleteID: number; ClubID: number; AthleteName: string; AthleteEPC: number }
    enabled.push(body.Enabled)
    return response(body)
  })
  const management = new AthleteManagementService({ clubId: 1, cache, athleteCatalog: athletes, groupStore: groups, client, now: () => 1000 })

  assert.equal((await management.archive(1)).ok, true)
  assert.equal(cache.load(1).athletes.athletes[0]!.status, 'archived')
  assert.equal((await management.restore(1)).ok, true)
  assert.equal(cache.load(1).athletes.athletes[0]!.status, 'active')
  assert.deepEqual(enabled, [false, true])
})

test('failed archive and invalid group delete receipt leave cache and subscribers unchanged', async () => {
  const storage = new Storage()
  const cache = new CatalogCacheRepository(storage)
  initial(cache)
  const { athletes, groups } = services(cache)
  let athletePublishes = 0
  let groupPublishes = 0
  athletes.subscribe(() => { athletePublishes += 1 })
  groups.subscribe(() => { groupPublishes += 1 })
  const failedAthlete = new AthleteManagementService({
    clubId: 1, cache, athleteCatalog: athletes, groupStore: groups,
    client: new BackendClient(async () => ({ statusCode: 200, data: { code: 9, message: 'deny' } })),
  })
  const invalidDelete = new GroupManagementService({
    clubId: 1, cache, athleteCatalog: athletes, groupStore: groups, mappingStorage: mappingStorage(),
    client: new BackendClient(async () => response({ deleted: true, AthleteGroupID: 99 })),
  })

  assert.equal((await failedAthlete.archive(1)).ok, false)
  assert.equal((await invalidDelete.delete('7')).ok, false)
  assert.equal(cache.load(1).athletes.athletes[0]!.status, 'active')
  assert.equal(cache.load(1).groups.length, 1)
  assert.equal(athletePublishes, 1)
  assert.equal(groupPublishes, 1)
})

test('group bundle uses persistent positive group and member IDs and skips reserved remote IDs', async () => {
  const state = mappingStorage()
  const initialIds = new SyncIdMapping(state, 1, () => 1, () => 0)
  initialIds.reserve('group', [1])
  initialIds.reserve('member', [1024])
  initialIds.save()
  const storage = new Storage()
  const cache = new CatalogCacheRepository(storage)
  initial(cache)
  const { athletes, groups } = services(cache)
  const sent: Array<{ group: number; member: number }> = []
  const client = new BackendClient(async (request: TransportRequest) => {
    const body = request.data as { AthleteGroup: { AthleteGroupID: number }; AthleteGroupForms: Array<{ AthleteGroupFormID: number }> }
    sent.push({ group: body.AthleteGroup.AthleteGroupID, member: body.AthleteGroupForms[0]!.AthleteGroupFormID })
    return response(body)
  })
  const first = new GroupManagementService({ clubId: 1, cache, athleteCatalog: athletes, groupStore: groups, client, mappingStorage: state, now: () => 1000 })

  assert.equal((await first.create('二组', [1])).ok, true)
  const createdId = groups.snapshot.find((group) => group.name === '二组')!.id
  const restarted = new GroupManagementService({ clubId: 1, cache, athleteCatalog: athletes, groupStore: groups, client, mappingStorage: state, now: () => 2000 })
  assert.equal((await restarted.update(createdId, '二组', [1])).ok, true)
  assert.ok(sent[0]!.group > 1)
  assert.ok(sent[0]!.member > 1024)
  assert.deepEqual(sent[1], sent[0])
})
