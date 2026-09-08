import type { AthleteCatalog, AthleteProfile } from '../domain/athlete-profile'
import { utf8Bytes } from '../protocol/binary'
import { createAthlete } from './backend-api/athletes/create-athlete'
import { updateAthlete } from './backend-api/athletes/update-athlete'
import type { BackendClient } from './backend-api/request'
import type { AthleteDto } from './backend-api/types'
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
      const athlete = candidate(current.athletes, undefined, name, epc, this.now())
      const dto = toDto(athlete, this.options.clubId)
      const receipt = await createAthlete(this.options.client, dto)
      if (!receipt.ok || !sameDto(receipt.data, dto)) return failure(receipt.ok ? '服务器回执无效' : receipt.message)
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

function candidate(catalog: AthleteCatalog, id: number | undefined, name: string, epc: string, timestamp: number): AthleteProfile {
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
  const nextId = id ?? catalog.nextId
  if (!Number.isInteger(nextId) || nextId < 1 || nextId > 65535) throw new Error('运动员 ID 已耗尽')
  return {
    id: nextId,
    name: normalizedName,
    epc: normalizedEpc,
    status: existing?.status ?? 'active',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    archivedAt: existing?.archivedAt ?? null,
  }
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
