import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  AthleteCatalog,
  AthleteCatalogStorage,
} from '../miniprogram/domain/athlete-profile'
import { AthleteRepository } from '../miniprogram/services/athlete-repository'

class MemoryStorage implements AthleteCatalogStorage {
  value: unknown = null

  read(): unknown { return this.value }
  write(value: AthleteCatalog): void { this.value = value }
}

test('loads an empty versioned athlete catalog when storage is absent', () => {
  const repository = new AthleteRepository(new MemoryStorage())

  assert.deepEqual(repository.load(), {
    schemaVersion: 1,
    revision: 0,
    nextId: 1,
    idReusePolicy: 'never',
    athletes: [],
    activeEpcIndex: {},
  })
})

test('persists athlete profiles and the active EPC index as one snapshot', () => {
  const storage = new MemoryStorage()
  const repository = new AthleteRepository(storage)
  const catalog: AthleteCatalog = {
    schemaVersion: 1,
    revision: 1,
    nextId: 2,
    idReusePolicy: 'never',
    athletes: [{
      id: 1,
      name: '张三',
      epc: '3333F337',
      status: 'active',
      createdAt: 1000,
      updatedAt: 1000,
      archivedAt: null,
    }],
    activeEpcIndex: { '3333F337': 1 },
  }

  repository.save(catalog)
  catalog.athletes[0]!.name = '被外部修改'
  catalog.activeEpcIndex['3333F337'] = 99

  const restored = new AthleteRepository(storage).load()
  assert.equal(restored.athletes[0]!.name, '张三')
  assert.equal(restored.activeEpcIndex['3333F337'], 1)
})

test('returns independent catalog snapshots to callers', () => {
  const storage = new MemoryStorage()
  const repository = new AthleteRepository(storage)
  repository.save({
    schemaVersion: 1,
    revision: 1,
    nextId: 2,
    idReusePolicy: 'never',
    athletes: [{
      id: 1,
      name: '张三',
      epc: '3333F337',
      status: 'active',
      createdAt: 1000,
      updatedAt: 1000,
      archivedAt: null,
    }],
    activeEpcIndex: { '3333F337': 1 },
  })

  const first = repository.load()
  first.athletes[0]!.name = '被调用方修改'
  delete first.activeEpcIndex['3333F337']

  const second = repository.load()
  assert.equal(second.athletes[0]!.name, '张三')
  assert.equal(second.activeEpcIndex['3333F337'], 1)
})
