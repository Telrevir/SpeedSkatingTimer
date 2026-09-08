import type { AthleteGroup } from '../domain/athlete-group'
import { createGroupBundle } from './backend-api/groups/create-group-bundle'
import { updateGroupBundle } from './backend-api/groups/update-group-bundle'
import type { BackendClient } from './backend-api/request'
import type { GroupBundleDto } from './backend-api/types'
import type { AthleteCatalogService } from './athlete-catalog-service'
import type { CatalogCacheRepository } from './catalog-cache-repository'
import { CatalogCacheSync } from './backend-sync/catalog-cache-sync'
import type { GroupStore } from '../stores/group-store'
import type { ManagementResult } from './athlete-management-service'

interface Options {
  clubId: number
  cache: CatalogCacheRepository
  athleteCatalog: AthleteCatalogService
  groupStore: GroupStore
  client: BackendClient
  now?: () => number
  refresh?: () => Promise<unknown>
}

/** 分组只使用后端聚合包接口，组名与完整成员集由同一回执一起确认。 */
export class GroupManagementService {
  private readonly now: () => number
  private readonly refresh: () => Promise<unknown>

  constructor(private readonly options: Options) {
    this.now = options.now ?? (() => Date.now())
    this.refresh = options.refresh ?? (() => new CatalogCacheSync({
      clubId: options.clubId, cache: options.cache, athleteCatalog: options.athleteCatalog,
      groupStore: options.groupStore, client: options.client, now: this.now,
    }).refresh())
  }

  async create(name: string, athleteIds: number[]): Promise<ManagementResult> {
    try {
      const current = this.options.cache.load(this.options.clubId)
      const id = nextServerId(current.groups)
      const group = candidate(id, name, athleteIds, undefined, this.now(), this.options.athleteCatalog)
      const bundle = toBundle(group, this.options.clubId)
      const receipt = await createGroupBundle(this.options.client, bundle)
      if (!receipt.ok || !sameBundle(receipt.data, bundle)) return failure(receipt.ok ? '服务器回执无效' : receipt.message)
      return await this.commit(current.groups, group)
    } catch (error) {
      return failure(error instanceof Error ? error.message : '分组保存失败')
    }
  }

  async update(id: string, name: string, athleteIds: number[]): Promise<ManagementResult> {
    try {
      const current = this.options.cache.load(this.options.clubId)
      const previous = current.groups.find((group) => group.id === id)
      if (!previous) throw new Error('分组不存在')
      const group = candidate(serverId(id), name, athleteIds, previous, this.now(), this.options.athleteCatalog)
      const bundle = toBundle(group, this.options.clubId)
      const receipt = await updateGroupBundle(this.options.client, serverId(group.id), bundle)
      if (!receipt.ok || !sameBundle(receipt.data, bundle)) return failure(receipt.ok ? '服务器回执无效' : receipt.message)
      return await this.commit(current.groups, group)
    } catch (error) {
      return failure(error instanceof Error ? error.message : '分组保存失败')
    }
  }

  private async commit(groups: AthleteGroup[], group: AthleteGroup): Promise<ManagementResult> {
    try {
      const next = groups.some(({ id }) => id === group.id)
        ? groups.map((row) => row.id === group.id ? group : row)
        : [...groups, group]
      const current = this.options.cache.load(this.options.clubId)
      const entry = this.options.cache.replaceFromServer(this.options.clubId, current.athletes, next, this.now())
      this.options.athleteCatalog.replaceFromServer(entry.athletes)
      this.options.groupStore.replaceFromServer(entry.groups)
      return { ok: true, message: '已保存' }
    } catch {
      await this.refresh().catch(() => undefined)
      return failure('服务器已保存，本地刷新失败')
    }
  }
}

function candidate(id: number, name: string, athleteIds: number[], previous: AthleteGroup | undefined, timestamp: number,
  athletes: AthleteCatalogService): AthleteGroup {
  const normalized = name.trim()
  if (!normalized) throw new Error('分组名称不能为空')
  const members = [...new Set(athleteIds)]
  if (members.some((athleteId) => !Number.isInteger(athleteId) || athleteId < 1 || !athletes.lookupActiveById(athleteId))) {
    throw new Error('分组成员不存在或已禁用')
  }
  return { id: String(id), name: normalized, athleteIds: members, createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp, enabled: true, memberEnabled: Object.fromEntries(members.map((member) => [String(member), true])) }
}

function toBundle(group: AthleteGroup, clubId: number): GroupBundleDto {
  return {
    AthleteGroup: { AthleteGroupID: serverId(group.id), ClubID: clubId, AthleteGroupName: group.name, Enabled: true },
    AthleteGroupForms: group.athleteIds.map((AthleteID) => ({ AthleteGroupID: serverId(group.id), AthleteID, Enabled: true })),
  }
}

function sameBundle(value: GroupBundleDto, expected: GroupBundleDto): boolean {
  if (!value || !value.AthleteGroup || value.AthleteGroup.AthleteGroupID !== expected.AthleteGroup.AthleteGroupID
    || value.AthleteGroup.ClubID !== expected.AthleteGroup.ClubID || value.AthleteGroup.AthleteGroupName !== expected.AthleteGroup.AthleteGroupName
    || value.AthleteGroup.Enabled !== expected.AthleteGroup.Enabled || !Array.isArray(value.AthleteGroupForms)) return false
  const received = value.AthleteGroupForms.map((form) => `${form.AthleteGroupID}:${form.AthleteID}:${form.Enabled}`).sort()
  const sent = expected.AthleteGroupForms.map((form) => `${form.AthleteGroupID}:${form.AthleteID}:${form.Enabled}`).sort()
  return JSON.stringify(received) === JSON.stringify(sent)
}

function serverId(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 0x7fffffff) throw new Error('服务器分组 ID 无效')
  return Number(value)
}

function nextServerId(groups: AthleteGroup[]): number {
  return Math.max(0, ...groups.map((group) => /^[1-9]\d*$/.test(group.id) ? Number(group.id) : 0)) + 1
}

function failure(message: string): ManagementResult { return { ok: false, message } }
