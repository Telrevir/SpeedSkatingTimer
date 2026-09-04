import type { AthleteProfile } from '../domain/athlete-profile'
import type { AthleteGroup } from '../domain/athlete-group'
import type { AthleteCatalogService } from './athlete-catalog-service'
import type { GroupStore } from '../stores/group-store'
import type { RaceRecord, ScoreRepository } from './score-repository'
import { AthleteStore } from '../stores/athlete-store'

// 临时桥接入口：关闭此开关即可禁用，删除本模块及两个装配引用即可整体移除。
export const TEMPORARY_BACKEND_SYNC_ENABLED = false
const CONFIG = {
  baseUrl: 'https://springboot-z3m5-307081-12-1465315659.sh.run.tcloudbase.com/api/v1',
  timeoutMs: 5000,
  clubId: 1,
  centisecondsToBackendTime: 10,
  idStorageKey: 'timer_count_temporary_backend_ids_v1',
  paths: {
    athletes: '/athletes', groups: '/athlete-groups', forms: '/athlete-group-forms',
    races: '/races', joins: '/athlete-race-joins', scores: '/scores',
  },
} as const

export interface TemporarySyncSnapshot {
  athletes: AthleteProfile[]
  groups: AthleteGroup[]
  races: RaceRecord[]
}

export interface TemporarySyncRequest {
  path: string
  data: Record<string, string | number | boolean>
}

interface SyncResult {
  state: 'idle' | 'running' | 'disabled' | 'completed' | 'partial' | 'failed'
  succeeded: number
  failed: number
  lastFailure?: string
}

interface Options {
  enabled: boolean
  readSnapshot(): TemporarySyncSnapshot
  idStorage: { read(): unknown; write(value: unknown): void }
  request(request: TemporarySyncRequest): Promise<{ statusCode: number; data: unknown }>
  report?(result: SyncResult): void
}

interface IdMapping {
  schemaVersion: 1
  nextId: number
  ids: Record<string, number>
}

export class TemporaryBackendSync {
  private run: Promise<SyncResult> | null = null
  private value: SyncResult = { state: 'idle', succeeded: 0, failed: 0 }

  constructor(private readonly options: Options) {}

  get status(): SyncResult { return { ...this.value } }

  runOnce(): Promise<SyncResult> {
    if (this.run) return this.run
    // 延后读取快照，启动入口立即返回；已完成或失败的 Promise 也保留到进程结束。
    this.run = Promise.resolve().then(() => this.execute()).catch(() => {
      this.value = { state: 'failed', succeeded: 0, failed: 0, lastFailure: 'local-data' }
      return this.status
    }).then((result) => {
      try { this.options.report?.(result) } catch { /* 状态提示失败也不能打断页面启动。 */ }
      return result
    })
    return this.run
  }

  private async execute(): Promise<SyncResult> {
    if (!this.options.enabled) {
      this.value = { state: 'disabled', succeeded: 0, failed: 0 }
      return this.status
    }
    this.value = { state: 'running', succeeded: 0, failed: 0 }
    const mapping = readMapping(this.options.idStorage.read())
    const requests = mapSnapshot(this.options.readSnapshot(), mapping)
    // 必须先保存临时映射再发送，防止写入失败后下次启动复用已发送的 ID。
    this.options.idStorage.write(mapping)
    for (const request of requests) {
      let failure: string | null = null
      try {
        const response = await this.options.request(request)
        if (response.statusCode < 200 || response.statusCode >= 300) {
          failure = `http-${response.statusCode}`
        } else if (!response.data || typeof response.data !== 'object'
            || (response.data as { code?: unknown }).code !== 0) {
          failure = 'api-response'
          try { console.info('[临时后端错误]', response) } catch { /* 忽略控制台异常。 */ }

        }
      } catch(error) {
        //failure = 'network'
        failure = (error as Error).message
      }
      if (failure) {
        this.value.failed += 1
        this.value.lastFailure = failure
      } else {
        this.value.succeeded += 1
      }
    }
    this.value.state = this.value.failed === 0 ? 'completed'
      : this.value.succeeded === 0 ? 'failed' : 'partial'
    return this.status
  }
}

// 仅在 app-services 装配现有只读数据源，不给任何 store/repository 添加同步逻辑。
export function createTemporaryBackendSync(sources: {
  athleteCatalog: AthleteCatalogService
  groupStore: GroupStore
  scoreRepository: ScoreRepository
}): TemporaryBackendSync {
  return new TemporaryBackendSync({
    enabled: TEMPORARY_BACKEND_SYNC_ENABLED,
    readSnapshot: () => ({
      athletes: sources.athleteCatalog.catalogSnapshot.athletes,
      groups: sources.groupStore.snapshot,
      races: sources.scoreRepository.listRaces(),
    }),
    idStorage: {
      read: () => wx.getStorageSync(CONFIG.idStorageKey),
      write: (value) => wx.setStorageSync(CONFIG.idStorageKey, value),
    },
    request: (request) => new Promise((resolve, reject) => {
      wx.request({
        url: `${CONFIG.baseUrl}${request.path}`,
        method: 'POST',
        header: { 'Content-Type': 'application/json', Accept: 'application/json' },
        data: request.data,
        timeout: CONFIG.timeoutMs,
        success: (response) => resolve({ statusCode: response.statusCode, data: response.data }),
        fail: () => reject(new Error('temporary-backend-network')),
      })
    }),
    report: reportTemporarySync,
  })
}

function reportTemporarySync(result: SyncResult): void {
  // 不输出姓名、EPC、响应正文或凭证；日志异常不应阻止用户收到结果提示。
  try { console.info('[临时后端同步]', result) } catch { /* 忽略控制台异常。 */ }
  if (result.state !== 'completed' && result.state !== 'partial' && result.state !== 'failed') return

  const label = result.state === 'completed' ? '同步成功'
    : result.state === 'partial' ? '同步部分失败' : '同步失败'
  let content = result.state === 'completed' && result.succeeded === 0
    ? '暂无需要同步的数据'
    : `${label}\n成功 ${result.succeeded} 条，失败 ${result.failed} 条`
  if (result.lastFailure) {
    const reason = result.lastFailure === 'network' ? '网络请求失败或超时'
      : result.lastFailure === 'local-data' ? '本地数据读取、转换或保存失败，未开始上传'
      : result.lastFailure.startsWith('http-') ? `服务器返回 HTTP ${result.lastFailure.slice(5)}`
      : '接口返回业务错误或异常响应'
    content += `\n最近失败原因：${reason}`
    content += `\n具体原因：${result.lastFailure}`
  }
  // 只在整轮结束时提示一次，不等待用户确认，也不逐条弹窗或触发重试。
  wx.showModal({
    title: '临时后端同步', content, showCancel: false, confirmText: '知道了',
    fail: () => { /* 平台无法展示弹窗时，保留控制台结果，不影响同步状态。 */ },
  })
}

function mapSnapshot(snapshot: TemporarySyncSnapshot, mapping: IdMapping): TemporarySyncRequest[] {
  const requests: TemporarySyncRequest[] = []
  const add = (path: string, data: TemporarySyncRequest['data']) => requests.push({ path, data })
  const id = (...parts: Array<string | number>) => {
    const key = JSON.stringify(parts)
    const existing = mapping.ids[key]
    if (existing !== undefined) return existing
    // 统一使用正 int，兼容协议中参赛关系 RaceID 仍为 int 的临时差异。
    if (mapping.nextId > 0x7fffffff) throw new Error('temporary-backend-id-exhausted')
    const allocated = mapping.nextId++
    mapping.ids[key] = allocated
    return allocated
  }
  snapshot.athletes.forEach((athlete) => {
    if (!/^[0-9a-fA-F]{8}$/.test(athlete.epc)) throw new Error('invalid-local-epc')
    if(athlete.status === 'active'){
      add(CONFIG.paths.athletes, {
        AthleteID: athlete.id, ClubID: CONFIG.clubId, AthleteName: athlete.name,
        AthleteEPC: Number.parseInt(athlete.epc, 16), Enabled: athlete.status === 'active',
      })
    }
  })
  snapshot.groups.forEach((group) => {
    add(CONFIG.paths.groups, {
      AthleteGroupID: id('group', group.id), ClubID: CONFIG.clubId,
      AthleteGroupName: group.name, Enabled: true,
    })
  })
  snapshot.groups.forEach((group) => {
    [...new Set(group.athleteIds)].forEach((athleteId) => add(CONFIG.paths.forms, {
      AthleteGroupFormID: id('group-form', group.id, athleteId),
      AthleteGroupID: id('group', group.id), AthleteID: athleteId, Enabled: true,
    }))
  })
  snapshot.races.forEach((race) => add(CONFIG.paths.races, {
    RaceID: id('race', race.id), RaceDate: formatDate(race.startedAt), ClubID: CONFIG.clubId, Enabled: true,
  }))
  snapshot.races.forEach((race) => {
    [...new Set(race.scores.map((score) => score.athleteId))].forEach((athleteId) => add(CONFIG.paths.joins, {
      id: id('race-join', race.id, athleteId), RaceID: id('race', race.id), AthleteID: athleteId, Enabled: true,
    }))
  })
  snapshot.races.forEach((race) => {
    race.scores.forEach((score, index) => add(CONFIG.paths.scores, {
      // 本地成绩只追加；用比赛 ID + 原始事件下标区分记录，不生成虚拟补圈事件。
      ScoreID: id('score', race.id, index), RaceID: id('race', race.id), AthleteID: score.athleteId,
      LapCount: score.correctedLap ?? score.lap,
      // 协议时间单位尚待确认，临时按毫秒发送；本地百分秒和补圈偏移不改动。
      SingleLapTime: score.lapCentiseconds * CONFIG.centisecondsToBackendTime,
      TotalTime: score.totalCentiseconds * CONFIG.centisecondsToBackendTime,
      Rank: score.rank, Enabled: true,
    }))
  })
  return requests
}

function readMapping(value: unknown): IdMapping {
  if (value === undefined || value === null || value === '') return { schemaVersion: 1, nextId: 1, ids: {} }
  if (typeof value !== 'object') throw new Error('invalid-temporary-id-mapping')
  const candidate = value as Partial<IdMapping>
  if (candidate.schemaVersion !== 1 || !Number.isInteger(candidate.nextId)
      || !candidate.nextId || candidate.nextId < 1 || candidate.nextId > 0x80000000
      || !candidate.ids || typeof candidate.ids !== 'object' || Array.isArray(candidate.ids)) {
    throw new Error('invalid-temporary-id-mapping')
  }
  const ids = Object.values(candidate.ids)
  if (ids.some((id) => !Number.isInteger(id) || id < 1 || id >= candidate.nextId!)
      || new Set(ids).size !== ids.length) throw new Error('invalid-temporary-id-mapping')
  return { schemaVersion: 1, nextId: candidate.nextId, ids: { ...candidate.ids } }
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) throw new Error('invalid-local-race-date')
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
