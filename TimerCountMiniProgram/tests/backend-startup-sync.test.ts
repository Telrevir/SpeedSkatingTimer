import assert from 'node:assert/strict'
import test from 'node:test'

import { StartupSync } from '../miniprogram/services/backend-sync/startup-sync'

test('startup refreshes catalogs and wakes pending races only', async () => {
  let refreshes = 0
  let wakes = 0
  const sync = new StartupSync({
    catalogRefresher: { refresh: async () => { refreshes += 1; return { state: 'completed' as const } } },
    wakePendingRaces: async () => { wakes += 1 },
  })

  assert.deepEqual(await sync.runOnce(), { state: 'completed', catalog: { state: 'completed' }, racesWoken: true })
  assert.equal(refreshes, 1)
  assert.equal(wakes, 1)
})

test('startup catalog failure preserves cache and does not block BLE', async () => {
  const cached = { athlete: 'offline-cache' }
  let wakes = 0
  const sync = new StartupSync({
    catalogRefresher: { refresh: async () => ({ state: 'failed' as const, message: 'offline' }) },
    wakePendingRaces: async () => { wakes += 1 },
  })

  const result = await sync.runOnce()
  assert.equal(result.state, 'partial')
  assert.equal(result.racesWoken, true)
  assert.equal(wakes, 1)
  assert.deepEqual(cached, { athlete: 'offline-cache' })
})

test('startup never downloads online race history', async () => {
  const requested: string[] = []
  const sync = new StartupSync({
    catalogRefresher: { refresh: async () => { requested.push('/athletes-and-groups-only'); return { state: 'completed' as const } } },
    wakePendingRaces: () => undefined,
  })

  await sync.runOnce()
  assert.deepEqual(requested, ['/athletes-and-groups-only'])
  assert.equal(requested.some((path) => path.includes('race-bundles')), false)
})