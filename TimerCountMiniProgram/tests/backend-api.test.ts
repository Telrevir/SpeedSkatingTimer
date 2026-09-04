import assert from 'node:assert/strict'
import test from 'node:test'
import { BackendClient, type TransportRequest } from '../miniprogram/services/backend-api/request'
import { AthletesApi } from '../miniprogram/services/backend-api/athletes'
import { GroupsApi } from '../miniprogram/services/backend-api/groups'
import { GroupMembersApi } from '../miniprogram/services/backend-api/group-members'
import { RaceBundlesApi } from '../miniprogram/services/backend-api/race-bundles'
import { SyncDataApi } from '../miniprogram/services/backend-api/sync-data'

test('backend request sends JSON through wx.request and returns the business payload', async () => {
  const runtime = globalThis as unknown as { wx?: unknown }
  const previous = runtime.wx
  const outgoing: Array<TransportRequest & { success: (response: { statusCode: number; data: unknown }) => void }> = []
  try {
    runtime.wx = { request: (request: typeof outgoing[number]) => {
      outgoing.push(request)
      request.success({ statusCode: 200, data: { code: 0, message: 'success', errorMsg: '', data: { AthleteID: 7 } } })
    } }
    const result = await new BackendClient().request<{ AthleteID: number }>({
      path: '/athletes', method: 'POST', data: { AthleteID: 7, AthleteName: '甲' },
    })
    assert.deepEqual(result, { ok: true, httpStatus: 200, data: { AthleteID: 7 } })
    assert.equal(outgoing.length, 1)
    assert.equal(outgoing[0]!.url, 'https://springboot-z3m5-307081-12-1465315659.sh.run.tcloudbase.com/api/v1/athletes')
    assert.equal(outgoing[0]!.method, 'POST')
    assert.equal(outgoing[0]!.header['Content-Type'], 'application/json')
    assert.deepEqual(outgoing[0]!.data, { AthleteID: 7, AthleteName: '甲' })
    assert.ok(outgoing[0]!.timeout > 0)
  } finally { runtime.wx = previous }
})

for (const scenario of [
  { name: 'HTTP failure despite business zero', status: 503, data: { code: 0, data: {} }, kind: 'http' },
  { name: 'business failure despite HTTP 200', status: 200, data: { code: 500, message: '失败', errorMsg: 'EPC 重复', data: {} }, kind: 'business' },
  { name: 'HTML response', status: 200, data: '<html>error</html>', kind: 'invalid-response' },
  { name: 'string success code', status: 200, data: { code: '0', data: {} }, kind: 'invalid-response' },
  { name: 'missing data', status: 200, data: { code: 0 }, kind: 'invalid-response' },
]) {
  test(`backend request distinguishes ${scenario.name}`, async () => {
    let calls = 0
    const client = new BackendClient(async () => {
      calls += 1
      return { statusCode: scenario.status, data: scenario.data }
    })
    const result = await client.request({ method: 'GET', path: '/athletes' })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, scenario.kind)
    assert.equal(result.httpStatus, scenario.status)
    if (scenario.kind === 'business') {
      assert.equal(result.code, 500)
      assert.equal(result.errorMsg, 'EPC 重复')
    }
    assert.equal(calls, 1)
  })
}

test('network failures return a state without rejection, retries or UI dependencies', async () => {
  let calls = 0
  const client = new BackendClient(async () => { calls += 1; throw new Error('timeout') })
  const result = await client.request({ method: 'POST', path: '/athletes', data: {} })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.kind, 'network')
  assert.equal(calls, 1)
})

test('GET encodes query values and preserves false and zero', async () => {
  let url = ''
  const client = new BackendClient(async (request) => {
    url = request.url
    return { statusCode: 200, data: { code: 0, data: [] } }
  })
  await client.request({ method: 'GET', path: '/athletes', query: { ClubID: 3, name: '甲 & 乙', enabled: false, page: 0 } })
  assert.equal(url, 'https://springboot-z3m5-307081-12-1465315659.sh.run.tcloudbase.com/api/v1/athletes?ClubID=3&name=%E7%94%B2%20%26%20%E4%B9%99&enabled=false&page=0')
})

test('business APIs keep separate paths and send only their explicit DTOs', async () => {
  const sent: TransportRequest[] = []
  const client = new BackendClient(async (request) => {
    sent.push(request)
    return { statusCode: 200, data: { code: 0, data: request.data } }
  })
  await new AthletesApi(client).create({ AthleteID: 7, ClubID: 3, AthleteName: '甲', AthleteEPC: 4294967295, Enabled: false })
  await new GroupsApi(client).create({ AthleteGroupID: 11, ClubID: 3, AthleteGroupName: '一队', Enabled: true })
  await new GroupMembersApi(client).create({ AthleteGroupFormID: 12, AthleteGroupID: 11, AthleteID: 7, Enabled: true })
  assert.deepEqual(sent.map((request) => new URL(request.url).pathname), ['/api/v1/athletes', '/api/v1/athlete-groups', '/api/v1/athlete-group-forms'])
  assert.ok(sent.every((request) => request.method === 'POST'))
  assert.deepEqual(sent[0]!.data, { AthleteID: 7, ClubID: 3, AthleteName: '甲', AthleteEPC: 4294967295, Enabled: false })
  assert.deepEqual(sent[1]!.data, { AthleteGroupID: 11, ClubID: 3, AthleteGroupName: '一队', Enabled: true })
  assert.deepEqual(sent[2]!.data, { AthleteGroupFormID: 12, AthleteGroupID: 11, AthleteID: 7, Enabled: true })
})

test('individual lists scope queries explicitly and expose pagination including disabled data', async () => {
  const sent: TransportRequest[] = []
  const client = new BackendClient(async (request) => {
    sent.push(request)
    return { statusCode: 200, data: { code: 0, data: { list: [], total: 0, page: 2, pageSize: 20 } } }
  })
  const athletes = await new AthletesApi(client).list(3, 2)
  await new GroupsApi(client).list(3, 2)
  await new GroupMembersApi(client).list(11, 2)
  assert.ok(athletes.ok)
  if (athletes.ok) assert.deepEqual(athletes.data, { list: [], total: 0, page: 2, pageSize: 20 })
  assert.deepEqual(sent.map((request) => new URL(request.url).search), [
    '?ClubID=3&page=2&pageSize=200&includeDisabled=true',
    '?ClubID=3&page=2&pageSize=200&includeDisabled=true',
    '?AthleteGroupID=11&page=2&pageSize=200&includeDisabled=true',
  ])
  assert.ok(sent.every((request) => request.method === 'GET' && request.data === undefined))
})

test('race bundle is one POST preserving centiseconds, raw laps and one real score event', async () => {
  const sent: TransportRequest[] = []
  const client = new BackendClient(async (request) => {
    sent.push(request)
    return { statusCode: 200, data: { code: 0, data: request.data } }
  })
  // 新增比赛：不带 RaceID/ClientRaceID，由后端生成；子记录 RaceID 省略由后端补齐。
  const result = await new RaceBundlesApi(client).upload({
    RaceInfo: { ClubID: 3, RaceDate: '2026-09-03 10:00:00', Enabled: true },
    AthleteRaceJoins: [{ id: 201, AthleteID: 7, Enabled: true }],
    Scores: [{ ScoreID: 301, AthleteID: 7, LapCount: 4, SingleLapTime: 6100, TotalTime: 12300, Rank: 2, Enabled: true }],
  })
  assert.equal(result.ok, true)
  assert.equal(sent.length, 1)
  assert.equal(new URL(sent[0]!.url).pathname, '/api/v1/race-bundles')
  assert.equal(sent[0]!.method, 'POST')
  const body = sent[0]!.data as { RaceInfo: Record<string, unknown>; Scores: Array<Record<string, unknown>> }
  assert.equal('RaceID' in body.RaceInfo, false)
  assert.equal('ClientRaceID' in body.RaceInfo, false)
  assert.deepEqual(body.Scores, [{ ScoreID: 301, AthleteID: 7, LapCount: 4, SingleLapTime: 6100, TotalTime: 12300, Rank: 2, Enabled: true }])
})

test('all-data fetch uses the confirmed race-bundles path with explicit or configured ClubID', async () => {
  const sent: TransportRequest[] = []
  const client = new BackendClient(async (request) => {
    sent.push(request)
    return { statusCode: 200, data: { code: 0, data: { ClubID: 3, Athletes: [], AthleteGroups: [], AthleteGroupForms: [], RaceBundles: [] } } }
  })
  const api = new SyncDataApi(client)
  const result = await api.fetchAll(3)
  await api.fetchAll()
  assert.ok(result.ok)
  if (result.ok) assert.deepEqual(result.data, { ClubID: 3, Athletes: [], AthleteGroups: [], AthleteGroupForms: [], RaceBundles: [] })
  assert.deepEqual(sent.map((request) => new URL(request.url).pathname + new URL(request.url).search), ['/api/v1/race-bundles?ClubID=3&includeDisabled=true', '/api/v1/race-bundles?ClubID=1&includeDisabled=true'])
  assert.ok(sent.every((request) => request.method === 'GET'))
})
