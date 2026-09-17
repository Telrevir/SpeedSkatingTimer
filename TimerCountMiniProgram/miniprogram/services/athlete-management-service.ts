import type { AthleteCatalog, AthleteProfile } from '../domain/athlete-profile'
import { utf8Bytes } from '../protocol/binary'
import { createAthlete } from './backend-api/athletes/create-athlete'
import { updateAthlete } from './backend-api/athletes/update-athlete'
import type { BackendClient } from './backend-api/request'
import type { AthleteCreateDto, AthleteDto } from './backend-api/types'
import type { AthleteCatalogService } from './athlete-catalog-service'
import type { CatalogCacheRepository } from './catalog-cache-repository'
import type { GroupStore } from '../stores/group-store'
import { CatalogCacheSync } from './backend-sync/catalog-cache-sync'

export interface ManagementResult {
  ok: boolean
  message: string
}

interface Options {
  clubId: number
  cache: CatalogCacheRepository
  athleteCatalog: AthleteCatalogService
  groupStore: GroupStore
  client: BackendClient
  now?: () => number
  refresh?: () => Promise<unknown>
}

/** 运动员编辑采用远端优先：请求或回执失败时，不会写缓存或通知订阅者。 */
export class AthleteManagementService {
  private readonly now: () => number
  private readonly refresh: () => Promise<unknown>

  constructor(private readonly options: Options) {
    this.now = options.now ?? (() => Date.now())
    this.refresh = options.refresh ?? (() => new CatalogCacheSync({
      clubId: options.clubId,
      cache: options.cache,
      athleteCatalog: options.athleteCatalog,
      groupStore: options.groupStore,
      client: options.client,
      now: this.now,
    }).refresh())
  }

  async create(name: string, epc: string): Promise<ManagementResult> {
    try {
      const current = this.options.cache.load(this.options.clubId)
      const draft = validateDraft(current.athletes, undefined, name, epc)
      const dto = toCreateDto(draft, this.options.clubId)
      const receipt = await createAthlete(this.options.client, dto)
      if (!receipt.ok) return failure(receipt.message)
      const athlete = fromCreateReceipt(current.athletes, receipt.data, dto, this.now())
      const next = replace(current.athletes, athlete)
      return await this.commit(next, current.groups)
    } catch (error) {
      return failure(error instanceof Error ? error.message : '运动员保存失败')
    }
  }

  async update(id: number, name: string, epc: string): Promise<ManagementResult> {
    try {
      const current = this.options.cache.load(this.options.clubId)
      const athlete = candidate(current.athletes, id, name, epc, this.now())
      const dto = toDto(athlete, this.options.clubId)
      const receipt = await updateAthlete(this.options.client, id, dto)
      if (!receipt.ok || !sameDto(receipt.data, dto)) return failure(receipt.ok ? '服务器回执无效' : receipt.message)
      const next = replace(current.athletes, athlete)
      return await this.commit(next, current.groups)
    } catch (error) {
      return failure(error instanceof Error ? error.message : '运动员保存失败')
    }
  }

  async archive(id: number): Promise<ManagementResult> {
    return this.setEnabled(id, false)
  }

  async restore(id: number): Promise<ManagementResult> {
    return this.setEnabled(id, true)
  }

  private async setEnabled(id: number, enabled: boolean): Promise<ManagementResult> {
    try {
      const current = this.options.cache.load(this.options.clubId)
      const existing = current.athletes.athletes.find((athlete) => athlete.id === id)
      if (!existing) throw new Error('未找到运动员')
      if ((existing.status === 'active') === enabled) throw new Error(enabled ? '运动员未归档' : '运动员已归档')
      const athlete: AthleteProfile = {
        ...existing,
        status: enabled ? 'active' : 'archived',
        archivedAt: enabled ? null : this.now(),
        updatedAt: this.now(),
      }
      const dto = toDto(athlete, this.options.clubId)
      const receipt = await updateAthlete(this.options.client, id, dto)
      if (!receipt.ok || !sameDto(receipt.data, dto)) return failure(receipt.ok ? '服务器回执无效' : receipt.message)
      return await this.commit(replace(current.athletes, athlete), current.groups)
    } catch (error) {
      return failure(error instanceof Error ? error.message : '运动员状态更新失败')
    }
  }

  private async commit(athletes: AthleteCatalog, groups: ReturnType<CatalogCacheRepository['load']>['groups']): Promise<ManagementResult> {
    try {
      const entry = this.options.cache.replaceFromServer(this.options.clubId, athletes, groups, this.now())
      this.options.athleteCatalog.replaceFromServer(entry.athletes)
      this.options.groupStore.replaceFromServer(entry.groups)
      return { ok: true, message: '已保存' }
    } catch {
      // 后端已成功，必须立刻尝试拉取权威快照；失败也不能把旧缓存伪装成新数据。
      await this.refresh().catch(() => undefined)
      return failure('服务器已保存，本地刷新失败')
    }
  }
}

interface AthleteDraft {
  name: string
  epc: string
  existing?: AthleteProfile
}

function validateDraft(catalog: AthleteCatalog, id: number | undefined, name: string, epc: string): AthleteDraft {
  const normalizedName = name.trim()
  if (!normalizedName) throw new Error('运动员姓名不能为空')
  if (utf8Bytes(normalizedName).length > 32) throw new Error('运动员姓名不能超过 32 个 UTF-8 字节')
  const normalizedEpc = epc.trim().toUpperCase()
  if (!/^[0-9A-F]{8}$/.test(normalizedEpc)) throw new Error('EPC 必须是 8 位十六进制字符')
  const existing = id === undefined ? undefined : catalog.athletes.find((row) => row.id === id)
  if (id !== undefined && !existing) throw new Error('未找到运动员')
  if (catalog.athletes.some((row) => row.id !== id && row.epc === normalizedEpc && row.status === 'active')) {
    throw new Error('EPC 已绑定其他运动员')
  }
  return { name: normalizedName, epc: normalizedEpc, existing }
}

function candidate(catalog: AthleteCatalog, id: number, name: string, epc: string, timestamp: number): AthleteProfile {
  const draft = validateDraft(catalog, id, name, epc)
  return {
    id,
    name: draft.name,
    epc: draft.epc,
    status: draft.existing!.status,
    createdAt: draft.existing!.createdAt,
    updatedAt: timestamp,
    archivedAt: draft.existing!.archivedAt,
  }
}

function fromCreateReceipt(catalog: AthleteCatalog, value: AthleteDto | undefined, expected: AthleteCreateDto, timestamp: number): AthleteProfile {
  if (!value || !Number.isSafeInteger(value.AthleteID) || value.AthleteID < 1
    || catalog.athletes.some((athlete) => athlete.id === value.AthleteID)
    || value.ClubID !== expected.ClubID || value.AthleteName !== expected.AthleteName
    || value.AthleteEPC !== expected.AthleteEPC || value.Enabled !== expected.Enabled) {
    throw new Error('服务器回执无效')
  }
  return {
    id: value.AthleteID,
    name: value.AthleteName,
    epc: value.AthleteEPC.toString(16).toUpperCase().padStart(8, '0'),
    status: value.Enabled ? 'active' : 'archived',
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: value.Enabled ? null : timestamp,
  }
}

function toCreateDto(draft: AthleteDraft, clubId: number): AthleteCreateDto {
  return { ClubID: clubId, AthleteName: draft.name, AthleteEPC: Number.parseInt(draft.epc, 16), Enabled: true }
}
function toDto(profile: AthleteProfile, clubId: number): AthleteDto {
  return { AthleteID: profile.id, ClubID: clubId, AthleteName: profile.name,
    AthleteEPC: Number.parseInt(profile.epc, 16), Enabled: profile.status === 'active' }
}

function sameDto(value: AthleteDto, expected: AthleteDto): boolean {
  return !!value && value.AthleteID === expected.AthleteID && value.ClubID === expected.ClubID
    && value.AthleteName === expected.AthleteName && value.AthleteEPC === expected.AthleteEPC
    && value.Enabled === expected.Enabled
}

function replace(catalog: AthleteCatalog, athlete: AthleteProfile): AthleteCatalog {
  const exists = catalog.athletes.some(({ id }) => id === athlete.id)
  const athletes = exists ? catalog.athletes.map((row) => row.id === athlete.id ? athlete : row) : [...catalog.athletes, athlete]
  const activeEpcIndex: Record<string, number> = {}
  athletes.forEach((row) => { if (row.status === 'active') activeEpcIndex[row.epc] = row.id })
  return { ...catalog, revision: catalog.revision + 1, nextId: Math.max(catalog.nextId, athlete.id + 1), athletes, activeEpcIndex }
}

function failure(message: string): ManagementResult { return { ok: false, message } }
