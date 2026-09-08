import type { AthleteCatalog, AthleteProfile } from '../../domain/athlete-profile'
import type { AthleteGroup } from '../../domain/athlete-group'
import { listAthletes } from '../backend-api/athletes/list-athletes'
import { listGroupMembers } from '../backend-api/groups/list-group-members'
import { listGroups } from '../backend-api/groups/list-groups'
import type { ApiResult, BackendClient } from '../backend-api/request'
import type { AthleteDto, GroupDto, GroupMemberDto, PageResultDto } from '../backend-api/types'
import type { AthleteCatalogService } from '../athlete-catalog-service'
import type { CatalogCacheRepository } from '../catalog-cache-repository'
import type { GroupStore } from '../../stores/group-store'
import { SyncIdMapping, type MappingStorage } from './id-mapping'

export interface CacheSyncStatus {
  state: 'completed' | 'failed'
  message?: string
}

interface Options {
  clubId: number
  cache: CatalogCacheRepository
  athleteCatalog: AthleteCatalogService
  groupStore: GroupStore
  client: BackendClient
  mappingStorage?: MappingStorage
  now?: () => number
}

/**
 * 目录同步只在所有分页数据均验证完成后提交一次；任一页失败时绝不清空旧缓存。
 */
export class CatalogCacheSync {
  private readonly now: () => number
  private running: Promise<CacheSyncStatus> | null = null

  constructor(private readonly options: Options) {
    this.now = options.now ?? (() => Date.now())
  }

  refresh(): Promise<CacheSyncStatus> {
    if (!this.running) {
      this.running = this.execute().finally(() => { this.running = null })
    }
    return this.running
  }

  private async execute(): Promise<CacheSyncStatus> {
    try {
      const athletes = await pages((page) => listAthletes(this.options.client, {
        ClubID: this.options.clubId, page, pageSize: 200, includeDisabled: true,
      }))
      const groups = await pages((page) => listGroups(this.options.client, {
        ClubID: this.options.clubId, page, pageSize: 200, includeDisabled: true,
      }))
      const forms: GroupMemberDto[] = []
      for (const group of groups) {
        forms.push(...await pages((page) => listGroupMembers(this.options.client, {
          AthleteGroupID: group.AthleteGroupID, page, pageSize: 200, includeDisabled: true,
        })))
      }
      if (this.options.mappingStorage) {
        const ids = new SyncIdMapping(this.options.mappingStorage, this.options.clubId)
        ids.reserve('group', groups.map((group) => group.AthleteGroupID))
        ids.reserve('member', forms.map((form) => form.AthleteGroupFormID ?? 0))
        groups.forEach((group) => ids.bind('group', groupKey(group.AthleteGroupID), group.AthleteGroupID))
        forms.forEach((form) => ids.bind('member', memberKey(form.AthleteGroupID, form.AthleteID), form.AthleteGroupFormID!))
        // 映射落盘失败时不能发布本次目录；远端 ID 也不会被新建请求误用。
        ids.save()
      }
      const timestamp = this.now()
      const catalog = toCatalog(athletes, timestamp, this.options.clubId)
      const cachedGroups = toGroups(groups, forms, new Set(catalog.athletes.map(({ id }) => id)), timestamp, this.options.clubId)
      const entry = this.options.cache.replaceFromServer(this.options.clubId, catalog, cachedGroups, timestamp)
      // 联合缓存已经成功落盘；以下调用均不再触及旧版两个独立存储键。
      this.options.athleteCatalog.replaceFromServer(entry.athletes)
      this.options.groupStore.replaceFromServer(entry.groups)
      return { state: 'completed' }
    } catch (error) {
      return { state: 'failed', message: error instanceof Error ? error.message : '目录同步失败' }
    }
  }
}

async function pages<T>(fetch: (page: number) => Promise<ApiResult<PageResultDto<T>>>): Promise<T[]> {
  const first = await fetch(1)
  const firstPage = checkedPage(first, 1)
  const result = [...firstPage.list]
  const pageCount = Math.max(1, Math.ceil(firstPage.total / firstPage.pageSize))
  for (let page = 2; page <= pageCount; page += 1) {
    const response = checkedPage(await fetch(page), page)
    if (response.total !== firstPage.total || response.pageSize !== firstPage.pageSize) {
      throw new Error('分页数据在读取期间变化')
    }
    result.push(...response.list)
  }
  if (result.length !== firstPage.total) throw new Error('分页数据不完整')
  return result
}

function checkedPage<T>(response: ApiResult<PageResultDto<T>>, expectedPage: number): PageResultDto<T> {
  if (!response.ok) throw new Error(`服务器目录读取失败：${response.kind}`)
  const page = response.data
  if (!page || !Array.isArray(page.list) || !Number.isInteger(page.page) || !Number.isInteger(page.pageSize)
    || !Number.isInteger(page.total) || page.page !== expectedPage || page.pageSize < 1 || page.total < 0
    || page.list.length > page.pageSize) {
    throw new Error('服务器目录分页格式无效')
  }
  return page
}

function toCatalog(rows: AthleteDto[], timestamp: number, clubId: number): AthleteCatalog {
  const ids = new Set<number>()
  const epcs = new Set<number>()
  const athletes: AthleteProfile[] = rows.map((row) => {
    if (!validId(row.AthleteID, 65535) || row.ClubID !== clubId
      || !Number.isInteger(row.AthleteEPC) || row.AthleteEPC < 0 || row.AthleteEPC > 0xffffffff
      || typeof row.AthleteName !== 'string' || !row.AthleteName.trim() || typeof row.Enabled !== 'boolean') {
      throw new Error('服务器运动员数据无效')
    }
    if (ids.has(row.AthleteID) || epcs.has(row.AthleteEPC)) throw new Error('服务器运动员主键或 EPC 重复')
    ids.add(row.AthleteID); epcs.add(row.AthleteEPC)
    return {
      id: row.AthleteID,
      name: row.AthleteName.trim(),
      epc: row.AthleteEPC.toString(16).toUpperCase().padStart(8, '0'),
      status: row.Enabled ? 'active' : 'archived',
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: row.Enabled ? null : timestamp,
    }
  })
  const activeEpcIndex: Record<string, number> = {}
  athletes.forEach((row) => { if (row.status === 'active') activeEpcIndex[row.epc] = row.id })
  return {
    schemaVersion: 1,
    revision: 1,
    nextId: Math.max(1, ...athletes.map(({ id }) => id + 1)),
    idReusePolicy: 'never',
    athletes,
    activeEpcIndex,
  }
}

function toGroups(rows: GroupDto[], forms: GroupMemberDto[], athleteIds: Set<number>, timestamp: number, clubId: number): AthleteGroup[] {
  const groupIds = new Set<number>()
  rows.forEach((row) => {
    if (!validId(row.AthleteGroupID, 0x7fffffff) || row.ClubID !== clubId
      || typeof row.AthleteGroupName !== 'string' || !row.AthleteGroupName.trim() || typeof row.Enabled !== 'boolean'
      || groupIds.has(row.AthleteGroupID)) throw new Error('服务器分组数据无效')
    groupIds.add(row.AthleteGroupID)
  })
  const members = new Map<number, GroupMemberDto[]>()
  const formIds = new Set<number>()
  forms.forEach((form) => {
    if (!validId(form.AthleteGroupFormID ?? 0, Number.MAX_SAFE_INTEGER) || !validId(form.AthleteGroupID, 0x7fffffff)
      || !validId(form.AthleteID, 65535) || !groupIds.has(form.AthleteGroupID)
      || typeof form.Enabled !== 'boolean' || formIds.has(form.AthleteGroupFormID!)) {
      throw new Error('服务器分组成员数据无效')
    }
    formIds.add(form.AthleteGroupFormID!)
    const list = members.get(form.AthleteGroupID) ?? []
    list.push(form)
    members.set(form.AthleteGroupID, list)
  })
  return rows.map((row) => {
    const relations = members.get(row.AthleteGroupID) ?? []
    const memberIds = relations.map(({ AthleteID }) => AthleteID)
    if (new Set(memberIds).size !== memberIds.length || memberIds.some((id) => !athleteIds.has(id))) {
      throw new Error('服务器分组成员关联无效')
    }
    return {
      id: String(row.AthleteGroupID),
      name: row.AthleteGroupName.trim(),
      athleteIds: memberIds,
      createdAt: timestamp,
      updatedAt: timestamp,
      enabled: row.Enabled,
      memberEnabled: Object.fromEntries(relations.map((relation) => [String(relation.AthleteID), relation.Enabled])),
    }
  })
}

function validId(value: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= max
}

function groupKey(groupId: number): string { return `group:${groupId}` }
function memberKey(groupId: number, athleteId: number): string { return `member:${groupId}:${athleteId}` }
