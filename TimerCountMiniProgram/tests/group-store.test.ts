import assert from 'node:assert/strict'
import test from 'node:test'

import { GroupStore } from '../miniprogram/stores/group-store'

class MemoryStorage {
  value: unknown
  read(): unknown { return this.value }
  write(value: unknown): void { this.value = value }
}

test('creates, updates, selects and removes athlete groups', () => {
  const storage = new MemoryStorage()
  const store = new GroupStore(storage, () => 1000)
  const group = store.create('A组', [1, 1, 2])
  assert.deepEqual(group.athleteIds, [1, 2])
  store.select(group.id)
  assert.equal(store.active?.name, 'A组')
  store.update(group.id, '新A组', [2])
  assert.deepEqual(store.active?.athleteIds, [2])
  store.remove(group.id)
  assert.equal(store.active, null)
})

test('prunes deleted athletes from all groups', () => {
  const store = new GroupStore(new MemoryStorage(), () => 1000)
  const group = store.create('A组', [1, 2, 3])
  store.pruneMembers([1, 3])
  assert.deepEqual(store.snapshot.find(({ id }) => id === group.id)?.athleteIds, [1, 3])
})

test('removes one archived athlete from every group', () => {
  const store = new GroupStore(new MemoryStorage(), () => 1000)
  const first = store.create('A组', [1, 2, 3])
  const second = store.create('B组', [2, 4])

  store.removeMember(2)

  assert.deepEqual(store.snapshot.find(({ id }) => id === first.id)?.athleteIds, [1, 3])
  assert.deepEqual(store.snapshot.find(({ id }) => id === second.id)?.athleteIds, [4])
})
