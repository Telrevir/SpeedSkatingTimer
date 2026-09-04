import type { AthleteCatalogService } from '../athlete-catalog-service'
import type { GroupStore } from '../../stores/group-store'
import type { ScoreRepository } from '../score-repository'
import { BackendClient, type ApiResult } from '../backend-api/request'
import { SyncIdMapping, type MappingStorage } from './id-mapping'
import { AthletesApi, type AthleteDto } from '../backend-api/athletes'
import { GroupsApi, type GroupDto } from '../backend-api/groups'
import { GroupMembersApi, type GroupMemberDto } from '../backend-api/group-members'
import { RaceBundlesApi, type RaceBundleDto } from '../backend-api/race-bundles'
import { SyncDataApi, type ClubDataDto } from '../backend-api/sync-data'
import { validateClubData } from './validation'
import { fromRaceBundle, toRaceBundle, joinKey, scoreKey } from './race-mapping'
import { athleteDto, sameAthlete, sameIds, sameRace } from './comparison'

function receiptObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

// 经 validateClubData 严格校验的远端快照中 RaceID 必然存在；此处仅做类型收窄与防御。
function requiredRaceID(info: { RaceID?: number }): number {
  if (info.RaceID === undefined) throw new Error('远端比赛缺少 RaceID')
  return info.RaceID
}

// 回执只接受“身份与内容都与请求一致”的对象；data 为 null、被篡改或 ClubID 不符都算失败，防止放行依赖上传。
function verifyAthleteReceipt(sent: AthleteDto, clubId: number) {
  return (data: unknown): boolean => {
    const row = receiptObject(data)
    return row !== null && row.AthleteID === sent.AthleteID && row.ClubID === clubId
      && row.AthleteName === sent.AthleteName && row.AthleteEPC === sent.AthleteEPC && row.Enabled === sent.Enabled
  }
}

function verifyGroupReceipt(sent: GroupDto) {
  return (data: unknown): boolean => {
    const row = receiptObject(data)
    return row !== null && row.AthleteGroupID === sent.AthleteGroupID && row.ClubID === sent.ClubID
      && row.AthleteGroupName === sent.AthleteGroupName && row.Enabled === sent.Enabled
  }
}

function verifyMemberReceipt(sent: GroupMemberDto) {
  return (data: unknown): boolean => {
    const row = receiptObject(data)
    return row !== null && row.AthleteGroupFormID === sent.AthleteGroupFormID && row.AthleteGroupID === sent.AthleteGroupID
      && row.AthleteID === sent.AthleteID && row.Enabled === sent.Enabled
  }
}

function verifyRaceReceipt(sent: RaceBundleDto) {
  return (data: unknown): boolean => {
    const bundle = receiptObject(data)
    const info = bundle === null ? null : receiptObject(bundle.RaceInfo)
    if (!bundle || !info) return false
    // 回执必须携带有效 RaceID；若请求已带 RaceID 则必须一致（更新），否则为后端新建分配的 ID。
    const receivedRaceID = typeof info.RaceID === 'number' ? info.RaceID : NaN
    if (!Number.isSafeInteger(receivedRaceID) || receivedRaceID < 1) return false
    if (sent.RaceInfo.RaceID !== undefined && receivedRaceID !== sent.RaceInfo.RaceID) return false
    if (info.ClubID !== sent.RaceInfo.ClubID || info.RaceDate !== sent.RaceInfo.RaceDate
      || info.Enabled !== sent.RaceInfo.Enabled) return false
    const childIds = (rows: unknown, pick: (row: Record<string, unknown>) => unknown): number[] | null => {
      if (!Array.isArray(rows)) return null
      const values = rows.map((row) => { const o = receiptObject(row); return o === null ? NaN : Number(pick(o)) })
      if (values.some((value) => !Number.isSafeInteger(value))) return null
      return values.sort((a, b) => a - b)
    }
    const joinIds = childIds(bundle.AthleteRaceJoins, (row) => row.id)
    const scoreIds = childIds(bundle.Scores, (row) => row.ScoreID)
    const athleteIds = childIds(bundle.Scores, (row) => row.AthleteID)
    const joinExpected = sent.AthleteRaceJoins.map((row) => row.id).sort((a, b) => a - b)
    const scoreExpected = sent.Scores.map((row) => row.ScoreID).sort((a, b) => a - b)
    const athleteExpected = sent.Scores.map((row) => row.AthleteID).sort((a, b) => a - b)
    return JSON.stringify(joinIds) === JSON.stringify(joinExpected)
      && JSON.stringify(scoreIds) === JSON.stringify(scoreExpected)
      && JSON.stringify(athleteIds) === JSON.stringify(athleteExpected)
  }
}

interface Options {
  athleteCatalog: AthleteCatalogService
  groupStore: GroupStore
  scoreRepository: ScoreRepository
  mappingStorage: MappingStorage
  clubId: number
  client?: BackendClient
  isBusy(): boolean
}
export interface SyncStatus {
  state: 'idle' | 'running' | 'completed' | 'partial' | 'skipped' | 'failed'
  uploaded: number
  downloaded: number
  ignored: number
  conflicts: number
  failed: number
  reason?: string
  issues: string[]
}
export class StartupSync {
  private run: Promise<SyncStatus> | null = null
  private value: SyncStatus = { state: 'idle', uploaded: 0, downloaded: 0, ignored: 0, conflicts: 0, failed: 0, issues: [] }
  private expected = ''
  private readonly client: BackendClient
  private readonly availableAthletes = new Set<number>()

  constructor(private readonly options: Options) { this.client = options.client ?? new BackendClient() }

  get status(): SyncStatus { return { ...this.value, issues: [...this.value.issues] } }

  runOnce(): Promise<SyncStatus> {
    if (!this.run) this.run = Promise.resolve().then(() => this.execute()).catch((error: unknown) => {
      this.value.state = error instanceof SyncSkipped ? 'skipped' : 'failed'
      this.value.reason = error instanceof SyncSkipped ? error.message : '本地同步准备或保存失败'
      return this.status
    })
    return this.run
  }

  private fingerprint(): string {
    return JSON.stringify([this.options.athleteCatalog.catalogSnapshot, this.options.groupStore.snapshot, this.options.scoreRepository.listRaces()])
  }

  private guard(): void {
    if (this.options.isBusy()) throw new SyncSkipped('正在比赛，跳过同步')
    if (this.fingerprint() !== this.expected) throw new SyncSkipped('本地数据已变化，停止本轮同步')
  }

  private conflict(entity: string): void {
    this.value.conflicts += 1
    if (this.value.issues.length < 50) this.value.issues.push(`${entity}：冲突或关联不可用，保留本地`)
  }

  private async upload(ids: SyncIdMapping, entity: string, send: () => Promise<ApiResult<unknown>>,
    verify?: (data: unknown) => boolean, onVerified?: (data: unknown) => void): Promise<boolean> {
    this.guard()
    ids.save()
    const result = await send()
    const verified = result.ok && (verify === undefined || verify(result.data))
    if (verified) {
      if (onVerified !== undefined) onVerified(result.data)
      this.value.uploaded += 1
    } else {
      this.value.failed += 1
      if (this.value.issues.length < 50) {
        const detail = !result.ok
          ? `${result.kind}，HTTP ${result.httpStatus ?? '-'}，code ${result.code ?? '-'}`
          : '回执 data 为空或身份与请求不符，不视为成功'
        this.value.issues.push(`${entity}：${detail}`)
      }
    }
    this.guard()
    return verified
  }

  private async execute(): Promise<SyncStatus> {
    this.value.state = 'running'
    this.expected = this.fingerprint()
    this.guard()
    const clubId = this.options.clubId
    if (!Number.isInteger(clubId) || clubId < 1 || clubId > 0x7fffffff) throw new SyncSkipped('ClubID 无效')
    const response = await new SyncDataApi(this.client).fetchAll(clubId)
    this.guard()
    if (!response.ok) throw new SyncSkipped(`拉取失败：${response.kind}，HTTP ${response.httpStatus ?? '-'}，code ${response.code ?? '-'}`)
    let remote: ClubDataDto
    try { remote = validateClubData(response.data, clubId) }
    catch(error) { throw new SyncSkipped('服务器快照无效或关联不完整:'+(error as Error).message) }
    const ids = new SyncIdMapping(this.options.mappingStorage, clubId)
    ids.reserve('group', remote.AthleteGroups.map((row) => row.AthleteGroupID))
    ids.reserve('member', remote.AthleteGroupForms.map((row) => row.AthleteGroupFormID))
    ids.reserve('race', remote.RaceBundles.map((row) => requiredRaceID(row.RaceInfo)))
    ids.reserve('join', remote.RaceBundles.flatMap((row) => row.AthleteRaceJoins.map((join) => join.id)))
    ids.reserve('score', remote.RaceBundles.flatMap((row) => row.Scores.map((score) => score.ScoreID)))
    await this.athletes(remote, ids)
    await this.groups(remote, ids)
    await this.races(remote, ids)
    this.guard()
    ids.save()
    this.value.state = this.value.failed || this.value.conflicts ? 'partial' : 'completed'
    return this.status
  }

  private async athletes(remote: ClubDataDto, ids: SyncIdMapping): Promise<void> {
    const service = this.options.athleteCatalog
    const local = service.catalogSnapshot.athletes
    const api = new AthletesApi(this.client)
    for (const profile of local) {
      this.guard()
      const row = remote.Athletes.find((candidate) => candidate.AthleteID === profile.id)
      if (row) {
        if (sameAthlete(profile, row, this.options.clubId)) { this.value.ignored += 1; this.availableAthletes.add(profile.id) }
        else this.conflict(`运动员 ${profile.id}`)
        continue
      }
      const dto = athleteDto(profile, this.options.clubId)
      if (!/^[0-9a-fA-F]{8}$/.test(profile.epc) || remote.Athletes.some((candidate) => candidate.AthleteEPC === dto.AthleteEPC)
        || local.some((candidate) => candidate.id !== profile.id && candidate.epc.toUpperCase() === profile.epc.toUpperCase())) {
        this.conflict(`运动员 ${profile.id}`); continue
      }
      // 用同一运行时规则检查待上传运动员，避免损坏本地记录污染云端。
      try { validateClubData({ ClubID: this.options.clubId, Athletes: [dto], AthleteGroups: [], AthleteGroupForms: [], RaceBundles: [] }, this.options.clubId) }
      catch { this.conflict(`运动员 ${profile.id}`); continue }
      if (await this.upload(ids, `运动员 ${profile.id}`, () => api.create(dto), verifyAthleteReceipt(dto, this.options.clubId))) this.availableAthletes.add(profile.id)
    }
    for (const row of remote.Athletes) {
      this.guard()
      if (local.some((profile) => profile.id === row.AthleteID)) continue
      if (local.some((profile) => Number.parseInt(profile.epc, 16) === row.AthleteEPC)) { this.conflict(`运动员 ${row.AthleteID}`); continue }
      const before = service.catalogSnapshot.revision
      const now = Date.now()
      const added = await service.importIfMissing({ id: row.AthleteID, name: row.AthleteName,
        epc: row.AthleteEPC.toString(16).toUpperCase().padStart(8, '0'), status: row.Enabled ? 'active' : 'archived',
        createdAt: now, updatedAt: now, archivedAt: row.Enabled ? null : now }, () => {
        this.guard(); return true
      })
      if (!added) { this.guard(); this.conflict(`运动员 ${row.AthleteID}`); continue }
      if (service.catalogSnapshot.revision !== before + 1) throw new SyncSkipped('导入期间本地运动员已变化')
      this.expected = this.fingerprint()
      this.guard()
      this.value.downloaded += 1
      this.availableAthletes.add(row.AthleteID)
    }
  }

  private async groups(remote: ClubDataDto, ids: SyncIdMapping): Promise<void> {
    const store = this.options.groupStore
    const api = new GroupsApi(this.client)
    const members = new GroupMembersApi(this.client)
    const visited = new Set<number>()
    for (const group of store.snapshot) {
      this.guard()
      const mapped = ids.get('group', group.id)
      const candidates = remote.AthleteGroups.filter((row) => row.AthleteGroupID === mapped || row.AthleteGroupName === group.name)
      candidates.forEach((row) => visited.add(row.AthleteGroupID))
      if (candidates.length > 1 || group.athleteIds.some((id) => !this.availableAthletes.has(id))) { this.conflict(`分组 ${group.id}`); continue }
      const row = candidates[0]
      if (row) {
        const relations = remote.AthleteGroupForms.filter((member) => member.AthleteGroupID === row.AthleteGroupID)
        if (!row.Enabled || row.AthleteGroupName !== group.name || relations.some((member) => !member.Enabled)
          || !sameIds(group.athleteIds, relations.map((member) => member.AthleteID))) { this.conflict(`分组 ${group.id}`); continue }
        try {
          ids.bind('group', group.id, row.AthleteGroupID)
          relations.forEach((member) => ids.bind('member', joinKey(group.id, member.AthleteID), member.AthleteGroupFormID))
          this.value.ignored += 1
        } catch { this.conflict(`分组 ${group.id}`) }
        continue
      }
      // 发送前核对：既有组员绑定若已被其他云端分组占用，整体不上传，避免错误 upsert 覆盖其他分组。
      const staleMember = group.athleteIds.map((athleteId) => joinKey(group.id, athleteId))
        .map((key) => ids.get('member', key))
        .find((bound) => bound !== undefined && ids.isRemote('member', bound))
      if (staleMember !== undefined) { this.conflict(`分组 ${group.id}：组员记录 ${staleMember} 已被其他云端分组占用`); continue }
      const groupId = ids.assign('group', group.id)
      const groupDto = { AthleteGroupID: groupId, ClubID: this.options.clubId, AthleteGroupName: group.name, Enabled: true }
      if (await this.upload(ids, `分组 ${group.id}`, () => api.create(groupDto), verifyGroupReceipt(groupDto))) {
        for (const athleteId of group.athleteIds) {
          const memberId = ids.assign('member', joinKey(group.id, athleteId))
          const memberDto = { AthleteGroupFormID: memberId, AthleteGroupID: groupId, AthleteID: athleteId, Enabled: true }
          await this.upload(ids, `组员 ${athleteId}`, () => members.create(memberDto), verifyMemberReceipt(memberDto))
        }
      }
    }
    for (const row of remote.AthleteGroups) {
      this.guard()
      if (visited.has(row.AthleteGroupID)) continue
      const relations = remote.AthleteGroupForms.filter((member) => member.AthleteGroupID === row.AthleteGroupID)
      if (!row.Enabled || relations.some((member) => !member.Enabled || !this.availableAthletes.has(member.AthleteID)
        || !this.options.athleteCatalog.lookupActiveById(member.AthleteID))) { this.conflict(`云端分组 ${row.AthleteGroupID}`); continue }
      const key = `backend:${this.options.clubId}:group:${row.AthleteGroupID}`
      try {
        ids.bind('group', key, row.AthleteGroupID)
        relations.forEach((member) => ids.bind('member', joinKey(key, member.AthleteID), member.AthleteGroupFormID))
      } catch { this.conflict(`云端分组 ${row.AthleteGroupID}`); continue }
      ids.save()
      const now = Date.now()
      if (store.importIfMissing({ id: key, name: row.AthleteGroupName, athleteIds: relations.map((member) => member.AthleteID), createdAt: now, updatedAt: now })) {
        this.expected = this.fingerprint(); this.value.downloaded += 1
      } else this.conflict(`云端分组 ${row.AthleteGroupID}`)
    }
  }

  private bindRace(ids: SyncIdMapping, localId: string, bundle: RaceBundleDto): void {
    ids.bind('race', localId, requiredRaceID(bundle.RaceInfo))
    bundle.AthleteRaceJoins.forEach((row) => ids.bind('join', joinKey(localId, row.AthleteID), row.id))
    ;[...bundle.Scores].sort((a, b) => a.ScoreID - b.ScoreID).forEach((row, index) => ids.bind('score', scoreKey(localId, index), row.ScoreID))
  }

  private async races(remote: ClubDataDto, ids: SyncIdMapping): Promise<void> {
    const repository = this.options.scoreRepository
    const api = new RaceBundlesApi(this.client)
    const visited = new Set<number>()
    for (const record of repository.listRaces()) {
      this.guard()
      const mapped = ids.get('race', record.id)
      const candidates = remote.RaceBundles.filter((bundle) => bundle.RaceInfo.RaceID === mapped)
      candidates.forEach((bundle) => visited.add(requiredRaceID(bundle.RaceInfo)))
      const participants = [...new Set([...(record.participantIds ?? []), ...record.scores.map((score) => score.athleteId)])]
      if (candidates.length > 1 || participants.some((id) => !this.availableAthletes.has(id))) { this.conflict(`比赛 ${record.id}`); continue }
      const bundle = candidates[0]
      if (bundle) {
        if (!sameRace(record, bundle)) { this.conflict(`比赛 ${record.id}`); continue }
        try { this.bindRace(ids, record.id, bundle); this.value.ignored += 1 }
        catch { this.conflict(`比赛 ${record.id}`) }
        continue
      }
      // 发送前核对：既有 join/score 绑定若已被其他云端父记录占用，整体不上传，避免错误 upsert 覆盖别的比赛。
      const joinConflict = participants.map((athleteId) => ids.get('join', joinKey(record.id, athleteId)))
        .some((bound) => bound !== undefined && ids.isRemote('join', bound))
      const scoreConflict = record.scores.map((_, index) => ids.get('score', scoreKey(record.id, index)))
        .some((bound) => bound !== undefined && ids.isRemote('score', bound))
      if (joinConflict || scoreConflict) { this.conflict(`比赛 ${record.id}：子记录 ID 已被其他云端父记录占用`); continue }
      const dto = toRaceBundle(record, this.options.clubId, ids)
      try {
        validateClubData({ ClubID: this.options.clubId,
          Athletes: this.options.athleteCatalog.catalogSnapshot.athletes.filter((row) => participants.includes(row.id)).map((row) => athleteDto(row, this.options.clubId)),
          AthleteGroups: [], AthleteGroupForms: [], RaceBundles: [dto] }, this.options.clubId, { raceIdOptional: true })
      } catch { this.conflict(`比赛 ${record.id}`); continue }
      await this.upload(ids, `比赛 ${record.id}`, () => api.upload(dto), verifyRaceReceipt(dto), (data) => {
        // 首次添加成功后，把后端返回的 RaceID 绑定并持久化到本地比赛，后续同步以该 RaceID 去重/更新。
        if (ids.get('race', record.id) !== undefined) return
        const info = receiptObject(receiptObject(data)?.RaceInfo)
        const raceId = info === null ? NaN : Number(info.RaceID)
        if (Number.isSafeInteger(raceId) && raceId >= 1) {
          ids.bind('race', record.id, raceId)
          ids.save()
        }
      })
    }
    for (const bundle of remote.RaceBundles) {
      this.guard()
      const raceId = requiredRaceID(bundle.RaceInfo)
      if (visited.has(raceId)) continue
      if (!bundle.RaceInfo.Enabled || bundle.AthleteRaceJoins.some((row) => !row.Enabled || !this.availableAthletes.has(row.AthleteID))
        || bundle.Scores.some((row) => !row.Enabled)) { this.conflict(`云端比赛 ${raceId}`); continue }
      const key = `backend:${this.options.clubId}:race:${raceId}`
      try { this.bindRace(ids, key, bundle) }
      catch { this.conflict(`云端比赛 ${raceId}`); continue }
      ids.save()
      if (repository.importIfMissing(fromRaceBundle(bundle, remote.Athletes, key))) {
        this.expected = this.fingerprint(); this.value.downloaded += 1
      } else this.conflict(`云端比赛 ${raceId}`)
    }
  }
}

class SyncSkipped extends Error {}
