import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_BLE_PROFILE } from '../miniprogram/config/ble-config'
import {
  BleProfileRepository,
  type BleProfileStorage,
} from '../miniprogram/services/ble-profile-repository'

class MemoryStorage implements BleProfileStorage {
  value: unknown = null

  read(): unknown { return this.value }
  write(value: unknown): void { this.value = value }
}

test('stores several BLE profiles and changes the active profile immediately', () => {
  const storage = new MemoryStorage()
  const repository = new BleProfileRepository(storage, () => 1000)

  assert.deepEqual(repository.list(), [{ ...DEFAULT_BLE_PROFILE, isActive: true }])

  const saved = repository.save({
    name: '备用 BT04',
    serviceUuid: 'ffe0',
    commandRxUuid: 'ffe2',
    notificationTxUuid: 'ffe1',
  })
  assert.equal(saved.name, '备用 BT04')
  assert.equal(repository.list().length, 2)

  repository.activate(saved.id)
  assert.equal(repository.active().id, saved.id)
  assert.equal(repository.active().serviceUuid, '0000FFE0-0000-1000-8000-00805F9B34FB')

  const restored = new BleProfileRepository(storage, () => 2000)
  assert.equal(restored.active().id, saved.id)
  assert.equal(restored.list().length, 2)
})

test('updates an active profile, validates fields, and keeps at least one profile', () => {
  const repository = new BleProfileRepository(new MemoryStorage(), () => 1000)
  const active = repository.active()

  const updated = repository.save({
    ...active,
    name: '比赛设备',
    serviceUuid: '0000ffe0-0000-1000-8000-00805f9b34fb',
  })
  assert.equal(updated.id, active.id)
  assert.equal(repository.active().name, '比赛设备')
  assert.equal(repository.active().serviceUuid, '0000FFE0-0000-1000-8000-00805F9B34FB')

  assert.throws(() => repository.save({
    name: '', serviceUuid: 'FFE0', commandRxUuid: 'FFE2', notificationTxUuid: 'FFE1',
  }), /名称/)
  assert.throws(() => repository.save({
    name: '错误', serviceUuid: 'unknown', commandRxUuid: 'FFE2', notificationTxUuid: 'FFE1',
  }), /UUID/)
  assert.throws(() => repository.remove(active.id), /至少保留/)
})

