import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  AthleteCatalog,
  AthleteCatalogStorage,
} from '../miniprogram/domain/athlete-profile'
import { AthleteCatalogService } from '../miniprogram/services/athlete-catalog-service'
import { AthleteRepository } from '../miniprogram/services/athlete-repository'

class MemoryStorage implements AthleteCatalogStorage {
  value: unknown = null

  read(): unknown { return this.value }
  write(value: AthleteCatalog): void { this.value = value }
}

function createService(
  storage = new MemoryStorage(),
  onArchived?: (athleteId: number) => void,
): AthleteCatalogService {
  return new AthleteCatalogService(
    new AthleteRepository(storage),
    { now: () => 1000, onArchived },
  )
}

test('creates normalized athletes with monotonically increasing permanent IDs', async () => {
  const service = createService()

  const first = await service.create(' 张三 ', '3333f337')
  const second = await service.create('张三', '01020304')

  assert.deepEqual([first.id, first.name, first.epc], [1, '张三', '3333F337'])
  assert.equal(second.id, 2)
  assert.equal(service.catalogSnapshot.nextId, 3)
  assert.equal(service.catalogSnapshot.revision, 2)
  assert.deepEqual(service.catalogSnapshot.activeEpcIndex, {
    '3333F337': 1,
    '01020304': 2,
  })
})

test('validates names, EPC values, active uniqueness, and ID exhaustion', async () => {
  const service = createService()
  await service.create('张三', '3333F337')

  await assert.rejects(() => service.create('', '01020304'), /姓名不能为空/)
  await assert.rejects(
    () => service.create('123456789012345678901234567890123', '01020304'),
    /32 个 UTF-8 字节/,
  )
  await assert.rejects(() => service.create('李四', 'XYZ'), /8 位十六进制/)
  await assert.rejects(() => service.create('李四', '3333f337'), /EPC 已绑定/)

  const exhaustedStorage = new MemoryStorage()
  exhaustedStorage.value = {
    schemaVersion: 1,
    revision: 0,
    nextId: 65536,
    idReusePolicy: 'never',
    athletes: [],
    activeEpcIndex: {},
  } satisfies AthleteCatalog
  await assert.rejects(() => createService(exhaustedStorage).create('李四', '01020304'), /ID 已耗尽/)
})

test('edits active profiles and releases the previous EPC binding', async () => {
  const service = createService()
  const athlete = await service.create('张三', '3333F337')

  const updated = await service.update(athlete.id, ' 张三甲 ', 'AABBccdd')

  assert.equal(updated.id, athlete.id)
  assert.equal(updated.name, '张三甲')
  assert.equal(updated.epc, 'AABBCCDD')
  assert.equal(service.lookupActiveByEpc('3333F337'), null)
  assert.equal(service.lookupActiveByEpc('aabbccdd')?.id, athlete.id)
  assert.equal(service.lookupActiveById(athlete.id)?.epc, 'AABBCCDD')
  assert.equal(service.lookupActiveById(999), null)
})

test('archives without reusing IDs and restores only after resolving EPC conflicts', async () => {
  const archivedIds: number[] = []
  const service = createService(new MemoryStorage(), (id) => archivedIds.push(id))
  const first = await service.create('张三', '3333F337')
  await service.create('李四', '01020304')

  await service.archive(first.id)
  assert.deepEqual(archivedIds, [first.id])
  assert.equal(service.activeSnapshot.length, 1)
  assert.equal(service.archivedSnapshot[0]!.id, first.id)
  assert.equal(service.lookupActiveByEpc('3333f337'), null)
  assert.equal(service.lookupActiveById(first.id), null)

  const replacement = await service.create('王五', '3333F337')
  assert.equal(replacement.id, 3)
  await assert.rejects(() => service.restore(first.id), /EPC 已绑定/)

  await service.update(first.id, '张三', 'AABBCCDD')
  const restored = await service.restore(first.id)
  assert.equal(restored.id, first.id)
  assert.equal(restored.status, 'active')
  assert.equal(restored.archivedAt, null)
  assert.equal(service.lookupActiveByEpc('aabbccdd')?.id, first.id)
})

test('serializes concurrent creates so IDs and snapshots cannot overwrite each other', async () => {
  const service = createService()

  const athletes = await Promise.all([
    service.create('A', '00000001'),
    service.create('B', '00000002'),
    service.create('C', '00000003'),
  ])

  assert.deepEqual(athletes.map(({ id }) => id), [1, 2, 3])
  assert.deepEqual(service.activeSnapshot.map(({ id }) => id), [1, 2, 3])
  assert.equal(service.catalogSnapshot.nextId, 4)
})

test('publishes cloned active and archived snapshots after mutations', async () => {
  const service = createService()
  const observed: Array<{ active: number; archived: number }> = []
  const unsubscribe = service.subscribe((active, archived) => {
    observed.push({ active: active.length, archived: archived.length })
    active.splice(0)
  })

  const athlete = await service.create('A', '00000001')
  await service.archive(athlete.id)
  unsubscribe()

  assert.deepEqual(observed, [
    { active: 0, archived: 0 },
    { active: 1, archived: 0 },
    { active: 0, archived: 1 },
  ])
  assert.equal(service.archivedSnapshot.length, 1)
})
