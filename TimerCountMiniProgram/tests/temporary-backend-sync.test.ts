import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import {
  TemporaryBackendSync,
  createTemporaryBackendSync,
  type TemporarySyncSnapshot,
  type TemporarySyncRequest,
} from '../miniprogram/services/temporary-backend-sync'

function snapshot(): TemporarySyncSnapshot {
  return {
    athletes: [
      { id: 7, name: '甲', epc: 'FFFFFFFF', status: 'active', createdAt: 0, updatedAt: 0, archivedAt: null },
      { id: 9, name: '乙', epc: '0000000A', status: 'active', createdAt: 0, updatedAt: 1, archivedAt: null },
    ],
    groups: [{ id: 'group-a', name: '一队', athleteIds: [7, 9], createdAt: 0, updatedAt: 0 }],
    races: [{ id: 'race-a', startedAt: new Date(2026, 8, 2, 10, 0).getTime(), finishedAt: null,
      scores: [{ athleteId: 7, name: '甲', epc: 'FFFFFFFF', lap: 4, rawLap: 3,
        correctionOffset: 1, correctedLap: 4, lapCentiseconds: 6100, totalCentiseconds: 12300, rank: 2 }] }],
  }
}

function fixture(enabled = true, request?: (value: TemporarySyncRequest) => Promise<{ statusCode: number; data: unknown }>) {
  const requests: TemporarySyncRequest[] = []
  const storage = {
    value: undefined as unknown,
    read(): unknown { return this.value },
    write(value: unknown): void { this.value = JSON.parse(JSON.stringify(value)) },
  }
  let reads = 0
  const options = {
    enabled,
    readSnapshot: () => { reads += 1; return snapshot() },
    idStorage: storage,
    request: async (value: TemporarySyncRequest) => {
      requests.push(value)
      return request ? request(value) : { statusCode: 200, data: { code: 0 } }
    },
  }
  return { sync: new TemporaryBackendSync(options), options, storage, requests, reads: () => reads }
}

// 只替换微信平台边界，实际执行同步、状态归并和弹窗装配，不访问真实后端。
async function withPlatform(
  options: { enableLegacy?: boolean; empty?: boolean; storageFailure?: boolean; modalFailure?: boolean; response?: 'partial' | 'http' | 'business' | 'network' },
  check: (sync: TemporaryBackendSync, modals: WechatMiniprogram.ShowModalOption[], requests: () => number) => Promise<void>,
) {
  const runtime = globalThis as unknown as { wx?: unknown }
  const originalWx = runtime.wx
  // 只在旧模块的回归测试内临时启用；生产默认值及启动解耦另有测试覆盖。
  const legacy = createRequire(__filename)('../miniprogram/services/temporary-backend-sync') as { TEMPORARY_BACKEND_SYNC_ENABLED: boolean }
  const originalEnabled = legacy.TEMPORARY_BACKEND_SYNC_ENABLED
  const modals: WechatMiniprogram.ShowModalOption[] = []
  let requests = 0
  const data = options.empty ? { athletes: [], groups: [], races: [] } : snapshot()
  try {
    if (options.enableLegacy) legacy.TEMPORARY_BACKEND_SYNC_ENABLED = true
    runtime.wx = {
      getStorageSync: () => '',
      setStorageSync: () => { if (options.storageFailure) throw new Error('storage full') },
      request: (request: {
        fail?: (error: { errMsg: string }) => void
        success?: (response: { statusCode: number; data: unknown; header: object; cookies: string[]; errMsg: string }) => void
      }) => {
        requests += 1
        if (options.response === 'network') {
          request.fail?.({ errMsg: 'request:fail' })
          return
        }
        request.success?.({
          statusCode: options.response === 'http' || (options.response === 'partial' && requests === 1) ? 409 : 200,
          data: { code: options.response === 'business' ? 500 : 0 },
          header: {}, cookies: [], errMsg: 'request:ok',
        })
      },
      showModal: (modal: WechatMiniprogram.ShowModalOption) => {
        modals.push(modal)
        if (options.modalFailure) modal.fail?.({ errMsg: 'showModal:fail' })
      },
    }
    const sync = createTemporaryBackendSync({
      athleteCatalog: { catalogSnapshot: { athletes: data.athletes } },
      groupStore: { snapshot: data.groups },
      scoreRepository: { listRaces: () => data.races },
    } as Parameters<typeof createTemporaryBackendSync>[0])
    await check(sync, modals, () => requests)
  } finally {
    legacy.TEMPORARY_BACKEND_SYNC_ENABLED = originalEnabled
    runtime.wx = originalWx
  }
}

for (const scenario of [
  { name: 'success', options: {}, state: 'completed', content: /同步成功[\s\S]*成功 8 条[\s\S]*失败 0 条/ },
  { name: 'partial failure', options: { response: 'partial' as const }, state: 'partial', content: /部分失败[\s\S]*成功 7 条[\s\S]*失败 1 条[\s\S]*409/ },
  { name: 'HTTP failure', options: { response: 'http' as const }, state: 'failed', content: /同步失败[\s\S]*成功 0 条[\s\S]*失败 8 条[\s\S]*409/ },
  { name: 'business failure', options: { response: 'business' as const }, state: 'failed', content: /同步失败[\s\S]*失败 8 条[\s\S]*接口/ },
  { name: 'network failure', options: { response: 'network' as const }, state: 'failed', content: /同步失败[\s\S]*失败 8 条[\s\S]*temporary-backend-network/ },
  { name: 'local storage failure', options: { storageFailure: true }, state: 'failed', content: /同步失败[\s\S]*本地/ },
  { name: 'empty data', options: { empty: true }, state: 'completed', content: /暂无需要同步的数据/ },
]) {
  test(`temporary sync shows one final popup for ${scenario.name}`, async () => {
    await withPlatform({ ...scenario.options, enableLegacy: true }, async (sync, modals) => {
      const first = sync.runOnce()
      assert.equal(modals.length, 0)
      assert.equal(sync.runOnce(), first)
      assert.equal((await first).state, scenario.state)
      await sync.runOnce()
      assert.equal(modals.length, 1)
      assert.match(modals[0]!.content!, scenario.content)
      assert.equal(modals[0]!.showCancel, false)
      assert.doesNotMatch(modals[0]!.content!, /FFFFFFFF|0000000A/)
    })
  })
}

test('popup failure does not reject the completed sync or cause another upload', async () => {
  await withPlatform({ modalFailure: true, enableLegacy: true }, async (sync, modals, requests) => {
    assert.equal((await sync.runOnce()).state, 'completed')
    await sync.runOnce()
    assert.equal(modals.length, 1)
    assert.equal(requests(), 8)
    assert.equal(typeof modals[0]!.fail, 'function')
  })
})

test('temporary startup sync maps all local resources and uses original stored rank', async () => {
  const { sync, requests } = fixture()
  const result = await sync.runOnce()
  assert.equal(result.state, 'completed')
  assert.equal(result.succeeded, 8)
  assert.deepEqual(requests.map((r) => r.path), [
    '/athletes', '/athletes', '/athlete-groups', '/athlete-group-forms', '/athlete-group-forms',
    '/races', '/athlete-race-joins', '/scores',
  ])
  assert.deepEqual(requests[0]!.data, {
    AthleteID: 7, ClubID: 1, AthleteName: '甲', AthleteEPC: 4294967295, Enabled: true,
  })
  assert.equal(requests[1]!.data.Enabled, true)
  assert.equal(requests[2]!.data.AthleteGroupName, '一队')
  assert.equal(requests[3]!.data.AthleteGroupID, requests[2]!.data.AthleteGroupID)
  assert.equal(requests[5]!.data.RaceDate, '2026-09-02 10:00:00')
  assert.deepEqual(requests[7]!.data, {
    ScoreID: requests[7]!.data.ScoreID, RaceID: requests[5]!.data.RaceID,
    AthleteID: 7, LapCount: 4, SingleLapTime: 61000, TotalTime: 123000, Rank: 2, Enabled: true,
  })
  assert.equal(requests[6]!.data.RaceID, requests[5]!.data.RaceID)
  assert.ok(Number.isInteger(requests[5]!.data.RaceID))
})

test('disabled temporary sync does not read local data or send requests', async () => {
  const f = fixture(false)
  assert.equal((await f.sync.runOnce()).state, 'disabled')
  assert.equal(f.reads(), 0)
  assert.equal(f.requests.length, 0)
  assert.equal(f.storage.value, undefined)
})

test('retained legacy uploader preserves the existing active-only athlete filter', async () => {
  const f = fixture()
  f.options.readSnapshot = () => {
    const data = snapshot()
    data.athletes[1]!.status = 'archived'
    return data
  }
  await f.sync.runOnce()
  assert.equal(f.requests.length, 7)
  assert.deepEqual(f.requests.filter((request) => request.path === '/athletes').map((request) => request.data.AthleteID), [7])
})

test('temporary sync shares one pending run and never resends in the same process', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const f = fixture(true, async () => { await gate; return { statusCode: 200, data: { code: 0 } } })
  const first = f.sync.runOnce()
  const second = f.sync.runOnce()
  assert.equal(first, second)
  release()
  await first
  await f.sync.runOnce()
  assert.equal(f.reads(), 1)
  assert.equal(f.requests.length, 8)
})

test('network, HTTP and business failures are counted without rejecting or stopping later rows', async () => {
  let count = 0
  const f = fixture(true, async () => {
    count += 1
    if (count === 1) throw new Error('network unavailable')
    if (count === 2) return { statusCode: 404, data: 'not found' }
    if (count === 3) return { statusCode: 500, data: { code: 500 } }
    if (count === 4) return { statusCode: 200, data: { code: 409 } }
    return { statusCode: 200, data: { code: 0 } }
  })
  const result = await f.sync.runOnce()
  assert.equal(result.state, 'partial')
  assert.equal(result.failed, 4)
  assert.equal(result.succeeded, 4)
  assert.equal(f.requests.length, 8)
})

test('temporary integer IDs persist across restarts and changes in snapshot order', async () => {
  const f = fixture()
  await f.sync.runOnce()
  const firstRaceId = f.requests.find((r) => r.path === '/races')!.data.RaceID
  const firstScoreId = f.requests.find((r) => r.path === '/scores')!.data.ScoreID
  const next = new TemporaryBackendSync({ ...f.options, readSnapshot: () => {
    const data = snapshot()
    data.races.unshift({ id: 'new-race', startedAt: 0, finishedAt: null, scores: [] })
    return data
  } })
  f.requests.length = 0
  await next.runOnce()
  assert.equal(f.requests.filter((r) => r.path === '/races')[1]!.data.RaceID, firstRaceId)
  assert.equal(f.requests.find((r) => r.path === '/scores')!.data.ScoreID, firstScoreId)
})

test('temporary mapping storage failure cannot affect startup or local records', async () => {
  const f = fixture()
  f.storage.write = () => { throw new Error('storage full') }
  const result = await f.sync.runOnce()
  assert.equal(result.state, 'failed')
  assert.equal(f.requests.length, 0)
})

test('app launch and later shows never start the legacy upload and keep BLE available', async () => {
  const loadModule = createRequire(__filename)
  const f = fixture()
  const runtime = globalThis as unknown as { App?: (hooks: { onLaunch?: () => void; onShow?: () => void }) => void }
  const originalApp = runtime.App
  const servicesPath = loadModule.resolve('../miniprogram/services/app-services')
  const appPath = loadModule.resolve('../miniprogram/app')
  const originalServices = loadModule.cache[servicesPath]
  const originalModule = loadModule.cache[appPath]
  let hooks: { onLaunch?: () => void; onShow?: () => void } = {}
  let bluetoothCalls = 0
  try {
    runtime.App = (value) => { hooks = value }
    loadModule.cache[servicesPath] = { exports: {
      temporaryBackendSync: f.sync, startupSync: { runOnce: async () => ({ state: 'skipped' }) },
      raceController: { autoConnect: async () => { bluetoothCalls += 1 } },
    } } as NodeModule
    delete loadModule.cache[appPath]
    loadModule(appPath)
    assert.equal(hooks.onLaunch?.(), undefined)
    hooks.onShow?.()
    hooks.onShow?.()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(f.sync.status.state, 'idle')
    assert.equal(f.requests.length, 0)
    assert.equal(f.reads(), 0)
    assert.equal(bluetoothCalls, 2)
  } finally {
    runtime.App = originalApp
    if (originalServices) loadModule.cache[servicesPath] = originalServices
    else delete loadModule.cache[servicesPath]
    if (originalModule) loadModule.cache[appPath] = originalModule
    else delete loadModule.cache[appPath]
  }
})

test('legacy production factory is disabled by default without requests or popups', async () => {
  await withPlatform({}, async (sync, modals, requests) => {
    assert.equal((await sync.runOnce()).state, 'disabled')
    assert.equal(requests(), 0)
    assert.equal(modals.length, 0)
  })
})
