import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { StartupSync } from '../miniprogram/services/backend-sync/startup-sync'
import { BackendClient, type TransportRequest } from '../miniprogram/services/backend-api/request'
import { AthleteCatalogService } from '../miniprogram/services/athlete-catalog-service'
import { AthleteRepository } from '../miniprogram/services/athlete-repository'
import { GroupStore } from '../miniprogram/stores/group-store'
import { ScoreRepository } from '../miniprogram/services/score-repository'
import type { ClubDataDto } from '../miniprogram/services/backend-api/sync-data'
import type { RaceBundleDto } from '../miniprogram/services/backend-api/race-bundles'

const empty = (): ClubDataDto => ({ ClubID: 1, Athletes: [], AthleteGroups: [], AthleteGroupForms: [], RaceBundles: [] })
function memory() { return { value: undefined as unknown, read() { return this.value }, write(value: unknown) { this.value = JSON.parse(JSON.stringify(value)) } } }
// 模拟真实后端：POST /race-bundles 若未带 RaceID 则分配一个并随响应返回；其余 POST 原样回显。
function echoUpload(request: TransportRequest, raceSeq: { next: number }): unknown {
  const data = JSON.parse(JSON.stringify(request.data ?? {})) as Record<string, unknown>
  if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/race-bundles')) {
    const info = (data.RaceInfo ?? {}) as Record<string, unknown>
    if (info.RaceID === undefined) info.RaceID = raceSeq.next++
    data.RaceInfo = info
  }
  return data
}
function fixture(server: ClubDataDto = empty()) {
  const athleteCatalog = new AthleteCatalogService(new AthleteRepository(memory()), { now: () => 1000 })
  const groupStore = new GroupStore(memory(), () => 1000)
  const scoreRepository = new ScoreRepository(memory(), () => new Date(2026, 8, 3, 10).getTime())
  const mappingStorage = memory()
  const sent: TransportRequest[] = []
  const responses: unknown[] = []
  const raceSeq = { next: 900001 }
  let busy = false
  const echo = (request: TransportRequest) => echoUpload(request, raceSeq)
  const reply = {
    run: async (request: TransportRequest): Promise<{ statusCode: number; data: unknown }> => {
      const data = request.method === 'GET' ? server : echo(request)
      responses.push(data)
      return { statusCode: 200, data: { code: 0, data } }
    },
  }
  const options = { athleteCatalog, groupStore, scoreRepository, mappingStorage, clubId: 1,
    client: new BackendClient(async (request) => { sent.push(request); return reply.run(request) }), isBusy: () => busy }
  return { ...options, sent, responses, reply, echo, server, busy: () => { busy = true }, make: () => new StartupSync(options) }
}
async function localData(f: ReturnType<typeof fixture>) {
  const athlete = await f.athleteCatalog.create('甲', '0000000A')
  f.groupStore.create('一队', [athlete.id])
  f.scoreRepository.beginRace()
  f.scoreRepository.appendScore({ athleteId: athlete.id, name: '甲', epc: '0000000A', lap: 4, rawLap: 3, correctionOffset: 1, correctedLap: 4, lapCentiseconds: 6100, totalCentiseconds: 12300, rank: 1 }, false)
  f.scoreRepository.finishRace()
}

test('valid empty server uploads local athletes, groups, members and one race bundle', async () => {
  const f = fixture()
  await localData(f)
  const result = await f.make().runOnce()
  assert.equal(result.state, 'completed')
  assert.equal(result.uploaded, 4)
  assert.deepEqual(f.sent.map((r) => new URL(r.url).pathname), ['/api/v1/race-bundles', '/api/v1/athletes', '/api/v1/athlete-groups', '/api/v1/athlete-group-forms', '/api/v1/race-bundles'])
  assert.equal(new URL(f.sent[0]!.url).search, '?ClubID=1&includeDisabled=true')
  const payload = f.sent[4]!.data as { RaceInfo: { RaceID?: number }; Scores: Array<Record<string, unknown>> }
  assert.equal(payload.RaceInfo.RaceID, undefined)
  assert.equal(payload.Scores.length, 1)
  assert.equal(payload.Scores[0]!.TotalTime, 12300)
  assert.equal('CorrectionOffset' in payload.Scores[0]!, false)
  assert.equal('RawLap' in payload.Scores[0]!, false)
  assert.ok(f.mappingStorage.value)
  const created = f.responses[4] as unknown as RaceBundleDto
  assert.ok(typeof created.RaceInfo.RaceID === 'number' && created.RaceInfo.RaceID! >= 1)
})

test('server-only data is saved locally and repeated equivalent data is ignored', async () => {
  const first = fixture()
  await localData(first)
  await first.make().runOnce()
  const server = empty()
  server.Athletes = [first.responses[1] as unknown as ClubDataDto['Athletes'][number]]
  server.AthleteGroups = [first.responses[2] as unknown as ClubDataDto['AthleteGroups'][number]]
  server.AthleteGroupForms = [first.responses[3] as unknown as ClubDataDto['AthleteGroupForms'][number]]
  server.RaceBundles = [first.responses[4] as unknown as ClubDataDto['RaceBundles'][number]]
  const f = fixture(server)
  const result = await f.make().runOnce()
  assert.equal(result.downloaded, 3)
  assert.equal(f.athleteCatalog.activeSnapshot[0]!.epc, '0000000A')
  assert.deepEqual(f.groupStore.snapshot[0]!.athleteIds, [1])
  assert.equal(f.scoreRepository.listRaces()[0]!.finishedAt, null)
  assert.equal(f.scoreRepository.listRaces()[0]!.scores[0]!.lapCentiseconds, 6100)
  assert.equal(f.scoreRepository.listRaces()[0]!.scores[0]!.correctionOffset, undefined)
  f.sent.length = 0
  const repeated = await f.make().runOnce()
  assert.equal(repeated.uploaded, 0)
  assert.equal(repeated.downloaded, 0)
  assert.equal(repeated.conflicts, 0)
  assert.ok(repeated.ignored >= 3)
  assert.equal(f.sent.length, 1)
})

test('same ID with changed data or another ID with same EPC is not overwritten', async () => {
  const server = empty()
  server.Athletes = [{ AthleteID: 1, ClubID: 1, AthleteName: '云端', AthleteEPC: 10, Enabled: true }]
  const f = fixture(server)
  await localData(f)
  const result = await f.make().runOnce()
  assert.ok(result.conflicts > 0)
  assert.equal(f.athleteCatalog.activeSnapshot[0]!.name, '甲')
  assert.equal(f.sent.length, 1)
})

test('HTTP failures and invalid ClubID skip without uploads or local changes', async () => {
  for (const mode of ['http', 'business', 'network', 'club', 'null'] as const) {
    const f = fixture()
    await localData(f)
    const before = JSON.stringify(f.athleteCatalog.catalogSnapshot)
    f.reply.run = async () => {
      if (mode === 'network') throw new Error('offline')
      return { statusCode: mode === 'http' ? 404 : 200, data: { code: mode === 'business' ? 500 : 0,
        data: mode === 'null' ? null : { ...empty(), ClubID: mode === 'club' ? 2 : 1 } } }
    }
    const result = await f.make().runOnce()
    assert.equal(result.state, 'skipped')
    assert.equal(result.uploaded, 0)
    assert.equal(f.sent.length, 1)
    assert.equal(JSON.stringify(f.athleteCatalog.catalogSnapshot), before)
  }
})

test('one process shares one promise and active race prevents mutations after a delayed fetch', async () => {
  const f = fixture()
  await localData(f)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  f.reply.run = async () => { await gate; return { statusCode: 200, data: { code: 0, data: empty() } } }
  const sync = f.make()
  const first = sync.runOnce()
  assert.equal(sync.runOnce(), first)
  await new Promise<void>((resolve) => setImmediate(resolve))
  f.busy()
  release()
  assert.equal((await first).state, 'skipped')
  await sync.runOnce()
  assert.equal(f.sent.length, 1)
})

test('local edits during fetch are preserved and stop the stale sync', async () => {
  const f = fixture()
  f.reply.run = async () => {
    await f.athleteCatalog.create('现场添加', '0000000B')
    return { statusCode: 200, data: { code: 0, data: empty() } }
  }
  assert.equal((await f.make().runOnce()).state, 'skipped')
  assert.equal(f.athleteCatalog.activeSnapshot[0]!.name, '现场添加')
  assert.equal(f.sent.length, 1)
})

test('mapping storage failure prevents any POST', async () => {
  const f = fixture()
  await localData(f)
  f.mappingStorage.write = () => { throw new Error('full') }
  const result = await f.make().runOnce()
  assert.equal(result.state, 'failed')
  assert.equal(f.sent.length, 1)
})

test('failed athlete upload prevents dependent group and race uploads', async () => {
  const f = fixture()
  await localData(f)
  f.reply.run = async (request) => ({ statusCode: 200, data: { code: request.method === 'POST' ? 500 : 0, data: empty() } })
  const result = await f.make().runOnce()
  assert.equal(result.state, 'partial')
  assert.equal(result.failed, 1)
  assert.equal(f.sent.length, 2)
  assert.ok(result.conflicts >= 2)
})

test('disabled server record does not delete or replace local athlete', async () => {
  const server = empty()
  server.Athletes = [{ AthleteID: 1, ClubID: 1, AthleteName: '甲', AthleteEPC: 10, Enabled: false }]
  const f = fixture(server)
  await f.athleteCatalog.create('甲', '0000000A')
  const result = await f.make().runOnce()
  assert.equal(result.conflicts, 1)
  assert.equal(f.athleteCatalog.activeSnapshot.length, 1)
  assert.equal(f.sent.length, 1)
})

test('created race binds the returned RaceID and later re-uploads reuse it', async () => {
  const f = fixture()
  await localData(f)
  await f.make().runOnce()
  const created = f.responses[4] as unknown as RaceBundleDto
  const assigned = created.RaceInfo.RaceID!
  assert.ok(Number.isSafeInteger(assigned) && assigned >= 1)
  const firstScoreIds = (f.sent[4]!.data as unknown as RaceBundleDto).Scores.map((row) => row.ScoreID)
  const firstJoinIds = (f.sent[4]!.data as unknown as RaceBundleDto).AthleteRaceJoins.map((row) => row.id)
  f.sent.length = 0
  f.responses.length = 0
  await f.make().runOnce()
  const second = f.sent[4]!.data as unknown as RaceBundleDto
  assert.equal(second.RaceInfo.RaceID, assigned)
  assert.deepEqual(second.Scores.map((row) => row.ScoreID), firstScoreIds)
  assert.deepEqual(second.AthleteRaceJoins.map((row) => row.id), firstJoinIds)
  f.sent.length = 0
  await f.make().runOnce()
  assert.deepEqual(f.sent[4]!.data, second)
})

test('app launch starts one non-blocking sync while onShow remains available for BLE', async () => {
  const f = fixture()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  f.reply.run = async () => { await gate; return { statusCode: 200, data: { code: 0, data: empty() } } }
  const sync = f.make()
  const loadModule = createRequire(__filename)
  const servicesPath = loadModule.resolve('../miniprogram/services/app-services')
  const appPath = loadModule.resolve('../miniprogram/app')
  const oldServices = loadModule.cache[servicesPath]
  const oldAppModule = loadModule.cache[appPath]
  const runtime = globalThis as unknown as { App?: (hooks: { onLaunch?: () => void; onShow?: () => void }) => void }
  const oldApp = runtime.App
  let hooks: { onLaunch?: () => void; onShow?: () => void } = {}
  let ble = 0
  try {
    runtime.App = (value) => { hooks = value }
    loadModule.cache[servicesPath] = { exports: { startupSync: sync, raceController: { autoConnect: async () => { ble += 1 } } } } as NodeModule
    delete loadModule.cache[appPath]
    loadModule(appPath)
    assert.equal(typeof hooks.onLaunch, 'function')
    assert.equal(hooks.onLaunch!(), undefined)
    hooks.onShow?.(); hooks.onShow?.()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(f.sent.length, 1)
    assert.equal(ble, 2)
    release()
    await sync.runOnce()
    assert.equal(f.sent.length, 1)
  } finally {
    release()
    runtime.App = oldApp
    if (oldServices) loadModule.cache[servicesPath] = oldServices
    else delete loadModule.cache[servicesPath]
    if (oldAppModule) loadModule.cache[appPath] = oldAppModule
    else delete loadModule.cache[appPath]
  }
})

test('null athlete POST receipt is not counted and blocks dependent uploads', async () => {
  const f = fixture()
  await localData(f)
  f.reply.run = async (request) => {
    if (request.method === 'GET') return { statusCode: 200, data: { code: 0, data: empty() } }
    return request.method === 'POST' && new URL(request.url).pathname.endsWith('/athletes')
      ? { statusCode: 200, data: { code: 0, data: null } }
      : { statusCode: 200, data: { code: 0, data: request.data } }
  }
  const result = await f.make().runOnce()
  assert.equal(result.state, 'partial')
  assert.equal(result.uploaded, 0)
  assert.equal(result.failed, 1)
  assert.ok(result.conflicts >= 2)
  assert.deepEqual(f.sent.map((r) => new URL(r.url).pathname), ['/api/v1/race-bundles', '/api/v1/athletes'])
  assert.ok(result.issues.some((issue) => issue.includes('回执 data 为空')))
})

test('null race bundle POST receipt is not counted as uploaded', async () => {
  const f = fixture()
  await localData(f)
  f.reply.run = async (request) => {
    if (request.method === 'GET') return { statusCode: 200, data: { code: 0, data: empty() } }
    return request.method === 'POST' && new URL(request.url).pathname.endsWith('/race-bundles')
      ? { statusCode: 200, data: { code: 0, data: null } }
      : { statusCode: 200, data: { code: 0, data: request.data } }
  }
  const result = await f.make().runOnce()
  assert.equal(result.state, 'partial')
  assert.equal(result.uploaded, 3)
  assert.equal(result.failed, 1)
  const postPaths = f.sent.filter((r) => r.method === 'POST').map((r) => new URL(r.url).pathname)
  assert.deepEqual(postPaths, ['/api/v1/athletes', '/api/v1/athlete-groups', '/api/v1/athlete-group-forms', '/api/v1/race-bundles'])
})

test('POST receipt with a foreign ClubID is treated as a failed upload', async () => {
  const f = fixture()
  await localData(f)
  f.reply.run = async (request) => {
    if (request.method === 'GET') return { statusCode: 200, data: { code: 0, data: empty() } }
    if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/athlete-groups')) {
      const data = (request.data ?? {}) as unknown as Record<string, unknown>
      return { statusCode: 200, data: { code: 0, data: { ...data, ClubID: 2 } } }
    }
    return { statusCode: 200, data: { code: 0, data: f.echo(request) } }
  }
  const result = await f.make().runOnce()
  assert.equal(result.state, 'partial')
  assert.equal(result.uploaded, 2)
  assert.equal(result.failed, 1)
  assert.equal(f.sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/athlete-group-forms')).length, 0)
})

test('race child record IDs claimed by another remote parent prevent re-upload', async () => {
  const f = fixture()
  await localData(f)
  await f.make().runOnce()
  const sent = f.sent
  const server = empty()
  server.Athletes = [sent[1]!.data as unknown as ClubDataDto['Athletes'][number]]
  server.AthleteGroups = [sent[2]!.data as unknown as ClubDataDto['AthleteGroups'][number]]
  server.AthleteGroupForms = [sent[3]!.data as unknown as ClubDataDto['AthleteGroupForms'][number]]
  const reused = JSON.parse(JSON.stringify(f.responses[4])) as unknown as RaceBundleDto
  const newRaceId = reused.RaceInfo.RaceID! + 500000
  reused.RaceInfo = { ...reused.RaceInfo, RaceID: newRaceId }
  reused.AthleteRaceJoins = reused.AthleteRaceJoins.map((row) => ({ ...row, RaceID: newRaceId }))
  reused.Scores = reused.Scores.map((row) => ({ ...row, RaceID: newRaceId }))
  server.RaceBundles = [reused]
  f.reply.run = async (request) => request.method === 'GET'
    ? { statusCode: 200, data: { code: 0, data: server } }
    : { statusCode: 200, data: { code: 0, data: request.data } }
  f.sent.length = 0
  const result = await f.make().runOnce()
  assert.ok(result.conflicts >= 1)
  assert.equal(result.state, 'partial')
  assert.equal(f.sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/race-bundles')).length, 0)
})

test('group member IDs claimed by another remote group prevent group re-upload', async () => {
  const f = fixture()
  await localData(f)
  await f.make().runOnce()
  const sent = f.sent
  const server = empty()
  server.Athletes = [sent[1]!.data as unknown as ClubDataDto['Athletes'][number]]
  const member = sent[3]!.data as unknown as ClubDataDto['AthleteGroupForms'][number]
  server.AthleteGroups = [{ AthleteGroupID: member.AthleteGroupID + 900000, ClubID: 1, AthleteGroupName: '云端其他分组', Enabled: true }]
  server.AthleteGroupForms = [{ AthleteGroupFormID: member.AthleteGroupFormID, AthleteGroupID: member.AthleteGroupID + 900000, AthleteID: member.AthleteID, Enabled: true }]
  f.reply.run = async (request) => request.method === 'GET'
    ? { statusCode: 200, data: { code: 0, data: server } }
    : { statusCode: 200, data: { code: 0, data: f.echo(request) } }
  f.sent.length = 0
  const result = await f.make().runOnce()
  assert.ok(result.conflicts >= 1)
  assert.equal(result.state, 'partial')
  assert.equal(f.sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith('/athlete-groups')).length, 0)
})
