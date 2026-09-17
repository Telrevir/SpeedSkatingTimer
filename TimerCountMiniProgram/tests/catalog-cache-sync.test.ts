import assert from 'node:assert/strict'
import test from 'node:test'

import { AthleteCatalogService } from '../miniprogram/services/athlete-catalog-service'
import { AthleteRepository } from '../miniprogram/services/athlete-repository'
import { BackendClient, type TransportRequest } from '../miniprogram/services/backend-api/request'
import { CatalogCacheRepository } from '../miniprogram/services/catalog-cache-repository'
import { CatalogCacheSync } from '../miniprogram/services/backend-sync/catalog-cache-sync'
import { GroupStore } from '../miniprogram/stores/group-store'

class Storage {
  value: unknown = null
  writes = 0

  read(): unknown { return this.value }
  write(value: unknown): void {
    this.writes += 1
    this.value = JSON.parse(JSON.stringify(value))
  }
}

function athlete(id: number, enabled = true) {
  return { AthleteID: id, ClubID: 1, AthleteName: `运动员${id}`, AthleteEPC: id, Enabled: enabled }
}

function group(id: number) {
  return { AthleteGroupID: id, ClubID: 1, AthleteGroupName: `第${id}组`, Enabled: true }
}

function member(id: number, groupId: number, athleteId: number) {
  return { AthleteGroupFormID: id, AthleteGroupID: groupId, AthleteID: athleteId, Enabled: true }
}

function response(data: unknown) {
  return { statusCode: 200, data: { code: 0, data } }
}

function localCatalog() {
  return new AthleteCatalogService(new AthleteRepository(new Storage()), { now: () => 1000 })
}

test('page failure preserves the complete previous club cache', async () => {
  const storage = new Storage()
  const cache = new CatalogCacheRepository(storage)
  cache.replaceFromServer(1, {
    schemaVersion: 1,
    revision: 1,
    nextId: 2,
    idReusePolicy: 'never',
    athletes: [{ id: 1, name: '旧运动员', epc: '00000001', status: 'active', createdAt: 1, updatedAt: 1, archivedAt: null }],
    activeEpcIndex: { '00000001': 1 },
  }, [{ id: '8', name: '旧分组', athleteIds: [1], createdAt: 1, updatedAt: 1 }])
  const athletes = localCatalog()
  const groups = new GroupStore(new Storage(), () => 1000)
  const client = new BackendClient(async (request: TransportRequest) => {
    if (request.path.includes('/athletes') && request.path.includes('page=1')) {
      return response({ list: [athlete(2)], page: 1, pageSize: 1, total: 2 })
    }
    if (request.path.includes('/athletes') && request.path.includes('page=2')) throw new Error('offline')
    throw new Error(`unexpected ${request.path}`)
  })
  const sync = new CatalogCacheSync({ clubId: 1, cache, athleteCatalog: athletes, groupStore: groups, client })

  const result = await sync.refresh()

  assert.equal(result.state, 'failed')
  assert.equal(cache.load(1).athletes.athletes[0]!.name, '旧运动员')
  assert.equal(cache.load(1).groups[0]!.name, '旧分组')
  assert.equal(storage.writes, 1)
})

test('successful refresh swaps athletes and groups in one publication', async () => {
  const storage = new Storage()
  const cache = new CatalogCacheRepository(storage)
  const athletes = localCatalog()
  const groups = new GroupStore(new Storage(), () => 1000)
  const observed: Array<[number, number]> = []
  athletes.subscribe((active, archived) => observed.push([active.length, archived.length]))
  const client = new BackendClient(async (request: TransportRequest) => {
    if (request.path.includes('/athletes')) return response({ list: [athlete(1), athlete(2, false)], page: 1, pageSize: 200, total: 2 })
    if (request.path.includes('/athlete-groups')) return response({ list: [group(7)], page: 1, pageSize: 200, total: 1 })
    if (request.path.includes('/athlete-group-forms')) return response({ list: [member(10, 7, 1), member(11, 7, 2)], page: 1, pageSize: 200, total: 2 })
    throw new Error(`unexpected ${request.path}`)
  })
  const sync = new CatalogCacheSync({ clubId: 1, cache, athleteCatalog: athletes, groupStore: groups, client, now: () => 2000 })

  const result = await sync.refresh()

  assert.equal(result.state, 'completed')
  assert.equal(storage.writes, 1)
  assert.deepEqual(observed, [[0, 0], [1, 1]])
  assert.equal(groups.snapshot[0]!.id, '7')
  assert.deepEqual(groups.snapshot[0]!.athleteIds, [1, 2])
  assert.equal(cache.load(1).athletes.athletes.length, 2)
})

test('club caches never share athletes or groups', () => {
  const cache = new CatalogCacheRepository(new Storage())
  const catalog = (id: number) => ({
    schemaVersion: 1 as const,
    revision: 1,
    nextId: id + 1,
    idReusePolicy: 'never' as const,
    athletes: [{ id, name: `运动员${id}`, epc: id.toString(16).padStart(8, '0').toUpperCase(), status: 'active' as const, createdAt: 1, updatedAt: 1, archivedAt: null }],
    activeEpcIndex: { [id.toString(16).padStart(8, '0').toUpperCase()]: id },
  })
  cache.replaceFromServer(1, catalog(1), [{ id: '1', name: '甲组', athleteIds: [1], createdAt: 1, updatedAt: 1 }])
  cache.replaceFromServer(2, catalog(2), [{ id: '2', name: '乙组', athleteIds: [2], createdAt: 1, updatedAt: 1 }])

  assert.equal(cache.load(1).athletes.athletes[0]!.id, 1)
  assert.equal(cache.load(1).groups[0]!.name, '甲组')
  assert.equal(cache.load(2).athletes.athletes[0]!.id, 2)
  assert.equal(cache.load(2).groups[0]!.name, '乙组')
})
