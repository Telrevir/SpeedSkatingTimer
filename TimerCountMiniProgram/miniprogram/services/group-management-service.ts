import type { AthleteGroup } from '../domain/athlete-group'
import { createGroupBundle } from './backend-api/groups/create-group-bundle'
import { deleteGroupBundle } from './backend-api/groups/delete-group-bundle'
import { updateGroupBundle } from './backend-api/groups/update-group-bundle'
import type { BackendClient } from './backend-api/request'
import type { GroupBundleCreateDto, GroupBundleDto, GroupBundleUpdateDto } from './backend-api/types'
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
      const ids = new SyncIdMapping(this.options.mappingStorage, this.options.clubId)
      const current = this.options.cache.load(this.options.clubId)
      const draft = validateDraft(name, athleteIds, this.options.athleteCatalog)
      const bundle = toCreateBundle(draft, this.options.clubId)
      const receipt = await createGroupBundle(this.options.client, bundle)
      if (!receipt.ok) return failure(receipt.message)
      const group = fromReceipt(receipt.data, bundle, undefined, this.now())
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
      const groupId = serverId(id)
      const ids = new SyncIdMapping(this.options.mappingStorage, this.options.clubId)
      if (ids.get('group', groupKey(id)) === undefined) ids.bind('group', groupKey(id), groupId)
      const draft = validateDraft(name, athleteIds, this.options.athleteCatalog)
      const bundle = toUpdateBundle(draft, this.options.clubId, ids, id)
      const receipt = await updateGroupBundle(this.options.client, groupId, bundle)
      if (!receipt.ok) return failure(receipt.message)
      const group = fromReceipt(receipt.data, bundle, previous, this.now(), groupId)
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

interface GroupDraft {
  name: string
  athleteIds: number[]
}

function validateDraft(name: string, athleteIds: number[], athletes: AthleteCatalogService): GroupDraft {
  const normalized = name.trim()
  if (!normalized) throw new Error('分组名称不能为空')
  const members = [...new Set(athleteIds)]
  if (members.some((athleteId) => !Number.isSafeInteger(athleteId) || athleteId < 1 || !athletes.lookupActiveById(athleteId))) {
    throw new Error('分组成员不存在或已禁用')
  }
  return { name: normalized, athleteIds: members }
}

function toCreateBundle(draft: GroupDraft, clubId: number): GroupBundleCreateDto {
  return {
    AthleteGroup: { ClubID: clubId, AthleteGroupName: draft.name, Enabled: true },
    AthleteGroupForms: draft.athleteIds.map((AthleteID) => ({ AthleteID, Enabled: true })),
  }
}

function toUpdateBundle(draft: GroupDraft, clubId: number, ids: SyncIdMapping, groupId: string): GroupBundleUpdateDto {
  return {
    AthleteGroup: { ClubID: clubId, AthleteGroupName: draft.name, Enabled: true },
    AthleteGroupForms: draft.athleteIds.map((AthleteID) => {
      const formId = ids.get('member', memberKey(groupId, AthleteID))
      return { ...(formId === undefined ? {} : { AthleteGroupFormID: formId }), AthleteID, Enabled: true }
    }),
  }
}

function fromReceipt(value: GroupBundleDto | undefined, expected: GroupBundleCreateDto | GroupBundleUpdateDto,
  previous: AthleteGroup | undefined, timestamp: number, expectedGroupId?: number): AthleteGroup {
  const group = value?.AthleteGroup
  if (!group || !validPositiveId(group.AthleteGroupID) || (expectedGroupId !== undefined && group.AthleteGroupID !== expectedGroupId)
    || group.ClubID !== expected.AthleteGroup.ClubID || group.AthleteGroupName !== expected.AthleteGroup.AthleteGroupName
    || group.Enabled !== expected.AthleteGroup.Enabled || !Array.isArray(value.AthleteGroupForms)) {
    throw new Error('服务器回执无效')
  }
  const expectedIds = new Set(expected.AthleteGroupForms.map((form) => form.AthleteID))
  const forms = new Map<number, GroupBundleDto['AthleteGroupForms'][number]>()
  value.AthleteGroupForms.forEach((form) => {
    if (!validPositiveId(form.AthleteGroupFormID) || !Number.isSafeInteger(form.AthleteID) || form.AthleteID < 1
      || form.AthleteGroupID !== group.AthleteGroupID || !form.Enabled || !expectedIds.has(form.AthleteID) || forms.has(form.AthleteID)) {
      throw new Error('服务器回执无效')
    }
    forms.set(form.AthleteID, form)
  })
  if (forms.size !== expectedIds.size) throw new Error('服务器回执无效')
  const athleteIds = value.AthleteGroupForms.map((form) => form.AthleteID)
  return {
    id: String(group.AthleteGroupID),
    name: group.AthleteGroupName,
    athleteIds,
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
    enabled: group.Enabled,
    memberEnabled: Object.fromEntries(value.AthleteGroupForms.map((form) => [String(form.AthleteID), form.Enabled])),
  }
}

function validPositiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
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
