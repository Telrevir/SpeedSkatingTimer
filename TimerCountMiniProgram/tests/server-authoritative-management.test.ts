import assert from 'node:assert/strict'
import test from 'node:test'

import { AthleteCatalogService } from '../miniprogram/services/athlete-catalog-service'
import { AthleteManagementService } from '../miniprogram/services/athlete-management-service'
import { AthleteRepository } from '../miniprogram/services/athlete-repository'
import { BackendClient, type TransportRequest } from '../miniprogram/services/backend-api/request'
import { CatalogCacheRepository } from '../miniprogram/services/catalog-cache-repository'
import { GroupManagementService } from '../miniprogram/services/group-management-service'
import { GroupStore } from '../miniprogram/stores/group-store'

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
    return response({
      AthleteGroup: { AthleteGroupID: 7, ClubID: 1, AthleteGroupName: '新一组', Enabled: true },
      AthleteGroupForms: [{ AthleteGroupFormID: 71, AthleteGroupID: 7, AthleteID: 1, Enabled: true }],
    })
  })
  const management = new GroupManagementService({ clubId: 1, cache, athleteCatalog: athletes, groupStore: groups, client, now: () => 1000 })

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
