import type { AthleteGroup } from '../domain/athlete-group'
import { createGroupBundle } from './backend-api/groups/create-group-bundle'
import { deleteGroupBundle } from './backend-api/groups/delete-group-bundle'
import { updateGroupBundle } from './backend-api/groups/update-group-bundle'
import type { BackendClient } from './backend-api/request'
import type { GroupBundleDto } from './backend-api/types'
import type { AthleteCatalogService } from './athlete-catalog-service'
import type { CatalogCacheRepository } from './catalog-cache-repository'
import { CatalogCacheSync } from './backend-sync/catalog-cache-sync'
import { SyncIdMapping, type MappingStorage } from './backend-sync/id-mapping'
import type { GroupStore } from '../stores/group-store'
import type { ManagementResult } from './athlete-management-service'

interface Options {
  clubId: number
  cache: CatalogCacheRepository
  athleteCatalog: AthleteCatalogService
  groupStore: GroupStore
  client: BackendClient
  mappingStorage: MappingStorage
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
      groupStore: options.groupStore, client: options.client, mappingStorage: options.mappingStorage, now: this.now,
    }).refresh())
  }

  async create(name: string, athleteIds: number[]): Promise<ManagementResult> {
    try {
      const current = this.options.cache.load(this.options.clubId)
      const ids = new SyncIdMapping(this.options.mappingStorage, this.options.clubId)
      const pendingKey = `pending:${this.now()}:${current.groups.length}`
      const id = ids.assign('group', pendingKey)
      const group = candidate(id, name, athleteIds, undefined, this.now(), this.options.athleteCatalog)
      const bundle = toBundle(group, this.options.clubId, ids, pendingKey)
      ids.save()
      const receipt = await createGroupBundle(this.options.client, bundle)
      if (!receipt.ok || !sameBundle(receipt.data, bundle)) return failure(receipt.ok ? '服务器回执无效' : receipt.message)
      ids.rekey('group', pendingKey, groupKey(group.id))
      bindReceipt(ids, group.id, receipt.data)
      ids.save()
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
      const ids = new SyncIdMapping(this.options.mappingStorage, this.options.clubId)
      if (ids.get('group', groupKey(id)) === undefined) ids.bind('group', groupKey(id), serverId(id))
      const group = candidate(serverId(id), name, athleteIds, previous, this.now(), this.options.athleteCatalog)
      const bundle = toBundle(group, this.options.clubId, ids, groupKey(id))
      ids.save()
      const receipt = await updateGroupBundle(this.options.client, serverId(group.id), bundle)
      if (!receipt.ok || !sameBundle(receipt.data, bundle)) return failure(receipt.ok ? '服务器回执无效' : receipt.message)
      bindReceipt(ids, group.id, receipt.data)
      ids.save()
      return await this.commit(current.groups, group)
    } catch (error) {
      return failure(error instanceof Error ? error.message : '分组保存失败')
    }
  }

  async delete(id: string): Promise<ManagementResult> {
    try {
      const current = this.options.cache.load(this.options.clubId)
      if (!current.groups.some((group) => group.id === id)) throw new Error('分组不存在')
      const groupId = serverId(id)
      const receipt = await deleteGroupBundle(this.options.client, groupId)
      if (!receipt.ok || receipt.data?.deleted !== true || receipt.data.AthleteGroupID !== groupId) {
        return failure(receipt.ok ? '服务器回执无效' : receipt.message)
      }
      return await this.commitGroups(current.groups.filter((group) => group.id !== id))
    } catch (error) {
      return failure(error instanceof Error ? error.message : '删除分组失败')
    }
  }

  private async commit(groups: AthleteGroup[], group: AthleteGroup): Promise<ManagementResult> {
    const next = groups.some(({ id }) => id === group.id)
      ? groups.map((row) => row.id === group.id ? group : row)
      : [...groups, group]
    return this.commitGroups(next)
  }

  private async commitGroups(next: AthleteGroup[]): Promise<ManagementResult> {
    try {
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

function toBundle(group: AthleteGroup, clubId: number, ids: SyncIdMapping, groupMappingKey: string): GroupBundleDto {
  const groupId = ids.get('group', groupMappingKey)
  if (groupId === undefined) throw new Error('分组同步 ID 不存在')
  return {
    AthleteGroup: { AthleteGroupID: groupId, ClubID: clubId, AthleteGroupName: group.name, Enabled: true },
    AthleteGroupForms: group.athleteIds.map((AthleteID) => ({
      AthleteGroupFormID: ids.assign('member', memberKey(group.id, AthleteID)),
      AthleteGroupID: groupId, AthleteID, Enabled: true,
    })),
  }
}

function sameBundle(value: GroupBundleDto, expected: GroupBundleDto): boolean {
  if (!value || !value.AthleteGroup || value.AthleteGroup.AthleteGroupID !== expected.AthleteGroup.AthleteGroupID
    || value.AthleteGroup.ClubID !== expected.AthleteGroup.ClubID || value.AthleteGroup.AthleteGroupName !== expected.AthleteGroup.AthleteGroupName
    || value.AthleteGroup.Enabled !== expected.AthleteGroup.Enabled || !Array.isArray(value.AthleteGroupForms)) return false
  const received = value.AthleteGroupForms.map((form) => `${form.AthleteGroupFormID}:${form.AthleteGroupID}:${form.AthleteID}:${form.Enabled}`).sort()
  const sent = expected.AthleteGroupForms.map((form) => `${form.AthleteGroupFormID}:${form.AthleteGroupID}:${form.AthleteID}:${form.Enabled}`).sort()
  return JSON.stringify(received) === JSON.stringify(sent)
}

function serverId(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 0x7fffffff) throw new Error('服务器分组 ID 无效')
  return Number(value)
}

function groupKey(groupId: string): string { return `group:${groupId}` }
function memberKey(groupId: string, athleteId: number): string { return `member:${groupId}:${athleteId}` }

function bindReceipt(ids: SyncIdMapping, groupId: string, receipt: GroupBundleDto): void {
  ids.bind('group', groupKey(groupId), receipt.AthleteGroup.AthleteGroupID)
  receipt.AthleteGroupForms.forEach((form) => {
    const formId = form.AthleteGroupFormID
    if (typeof formId !== 'number' || !Number.isSafeInteger(formId) || formId < 1) {
      throw new Error('服务器成员回执 ID 无效')
    }
    ids.bind('member', memberKey(groupId, form.AthleteID), formId)
  })
}

function failure(message: string): ManagementResult { return { ok: false, message } }
