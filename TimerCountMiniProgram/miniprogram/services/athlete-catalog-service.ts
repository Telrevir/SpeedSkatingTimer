import type {
  AthleteCatalog,
  AthleteProfile,
} from '../domain/athlete-profile'
import { utf8Bytes } from '../protocol/binary'
import { AthleteRepository } from './athlete-repository'

export interface AthleteIdAllocator {
  allocate(catalog: AthleteCatalog): number
}

export class MonotonicAthleteIdAllocator implements AthleteIdAllocator {
  allocate(catalog: AthleteCatalog): number {
    if (catalog.nextId > 65535) throw new Error('运动员 ID 已耗尽')
    return catalog.nextId
  }
}

export class AthleteCatalogService {
  private catalog: AthleteCatalog
  private writeQueue: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<(
    active: AthleteProfile[],
    archived: AthleteProfile[],
  ) => void>()
  private readonly now: () => number
  private readonly onArchived?: (athleteId: number) => void
  private readonly idAllocator: AthleteIdAllocator

  constructor(
    private readonly repository: AthleteRepository,
    options: {
      now?: () => number
      onArchived?: (athleteId: number) => void
      idAllocator?: AthleteIdAllocator
    } = {},
  ) {
    this.now = options.now ?? (() => Date.now())
    this.onArchived = options.onArchived
    this.idAllocator = options.idAllocator ?? new MonotonicAthleteIdAllocator()
    this.catalog = repository.load()
  }

  get activeSnapshot(): AthleteProfile[] {
    return profilesByStatus(this.catalog, 'active')
  }

  get archivedSnapshot(): AthleteProfile[] {
    return profilesByStatus(this.catalog, 'archived')
  }

  get catalogSnapshot(): AthleteCatalog {
    return cloneCatalog(this.catalog)
  }

  lookupActiveByEpc(epc: string): AthleteProfile | null {
    const normalizedEpc = epc.trim().toUpperCase()
    if (!/^[0-9A-F]{8}$/.test(normalizedEpc)) return null
    const id = this.catalog.activeEpcIndex[normalizedEpc]
    if (id === undefined) return null
    const athlete = this.catalog.athletes.find((candidate) => (
      candidate.id === id && candidate.status === 'active'
    ))
    return athlete ? { ...athlete } : null
  }

  lookupActiveById(id: number): AthleteProfile | null {
    if (!Number.isInteger(id) || id <= 0 || id > 0xffff) return null
    const athlete = this.catalog.athletes.find((candidate) => (
      candidate.id === id && candidate.status === 'active'
    ))
    return athlete ? { ...athlete } : null
  }

  create(name: string, epc: string): Promise<AthleteProfile> {
    return this.enqueue(() => {
      const normalizedName = normalizeName(name)
      const normalizedEpc = normalizeEpc(epc)
      assertEpcAvailable(this.catalog, normalizedEpc)
      const id = this.idAllocator.allocate(this.catalog)
      const timestamp = this.now()
      const athlete: AthleteProfile = {
        id,
        name: normalizedName,
        epc: normalizedEpc,
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: null,
      }
      const next = cloneCatalog(this.catalog)
      next.athletes.push(athlete)
      if (id === next.nextId) next.nextId += 1
      this.persist(next)
      return { ...athlete }
    })
  }

  importIfMissing(profile: AthleteProfile, canImport: () => boolean = () => true): Promise<boolean> {
    return this.enqueue(() => {
      // 同步等待期间本地可能变化，必须在现有写队列内部再次检查。
      if (!canImport()) return false
      if (!profile || !Number.isInteger(profile.id) || profile.id < 1 || profile.id > 65535
        || (profile.status !== 'active' && profile.status !== 'archived')
        || !Number.isFinite(profile.createdAt) || !Number.isFinite(profile.updatedAt)
        || (profile.archivedAt !== null && !Number.isFinite(profile.archivedAt))) {
        throw new Error('导入运动员资料不合法')
      }
      const imported = { ...profile, name: normalizeName(profile.name), epc: normalizeEpc(profile.epc) }
      // 云端导入更保守：归档记录的 ID 和 EPC 也不能被其他资料占用。
      if (this.catalog.athletes.some(({ id, epc }) => id === imported.id || epc === imported.epc)) return false
      const next = cloneCatalog(this.catalog)
      next.athletes.push(imported)
      next.nextId = Math.max(next.nextId, imported.id + 1)
      this.persist(next)
      return true
    })
  }

  update(id: number, name: string, epc: string): Promise<AthleteProfile> {
    return this.enqueue(() => {
      const normalizedName = normalizeName(name)
      const normalizedEpc = normalizeEpc(epc)
      const existing = findAthlete(this.catalog, id)
      assertEpcAvailable(this.catalog, normalizedEpc, id)
      const updated: AthleteProfile = {
        ...existing,
        name: normalizedName,
        epc: normalizedEpc,
        updatedAt: this.now(),
      }
      const next = cloneCatalog(this.catalog)
      next.athletes = next.athletes.map((athlete) => athlete.id === id ? updated : athlete)
      this.persist(next)
      return { ...updated }
    })
  }

  archive(id: number): Promise<void> {
    return this.enqueue(() => {
      const existing = findAthlete(this.catalog, id)
      if (existing.status !== 'active') throw new Error('运动员已归档')
      const timestamp = this.now()
      const next = cloneCatalog(this.catalog)
      next.athletes = next.athletes.map((athlete) => athlete.id === id
        ? { ...athlete, status: 'archived', archivedAt: timestamp, updatedAt: timestamp }
        : athlete)
      this.persist(next)
      this.onArchived?.(id)
    })
  }

  restore(id: number): Promise<AthleteProfile> {
    return this.enqueue(() => {
      const existing = findAthlete(this.catalog, id)
      if (existing.status !== 'archived') throw new Error('运动员未归档')
      assertEpcAvailable(this.catalog, existing.epc, id)
      const restored: AthleteProfile = {
        ...existing,
        status: 'active',
        archivedAt: null,
        updatedAt: this.now(),
      }
      const next = cloneCatalog(this.catalog)
      next.athletes = next.athletes.map((athlete) => athlete.id === id ? restored : athlete)
      this.persist(next)
      return { ...restored }
    })
  }

  subscribe(listener: (
    active: AthleteProfile[],
    archived: AthleteProfile[],
  ) => void): () => void {
    this.listeners.add(listener)
    listener(this.activeSnapshot, this.archivedSnapshot)
    return () => this.listeners.delete(listener)
  }

  private enqueue<T>(operation: () => T): Promise<T> {
    const result = this.writeQueue.then(operation)
    this.writeQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private persist(next: AthleteCatalog): void {
    next.activeEpcIndex = buildActiveEpcIndex(next.athletes)
    next.revision += 1
    this.repository.save(next)
    this.catalog = next
    this.notify()
  }

  private notify(): void {
    this.listeners.forEach((listener) => {
      listener(this.activeSnapshot, this.archivedSnapshot)
    })
  }
}

function normalizeName(name: string): string {
  const normalized = name.trim()
  if (!normalized) throw new Error('运动员姓名不能为空')
  if (utf8Bytes(normalized).length > 32) {
    throw new Error('运动员姓名不能超过 32 个 UTF-8 字节')
  }
  return normalized
}

function normalizeEpc(epc: string): string {
  const normalized = epc.trim().toUpperCase()
  if (!/^[0-9A-F]{8}$/.test(normalized)) {
    throw new Error('EPC 必须是 8 位十六进制字符')
  }
  return normalized
}

function assertEpcAvailable(catalog: AthleteCatalog, epc: string, exceptId?: number): void {
  const boundId = catalog.activeEpcIndex[epc]
  if (boundId !== undefined && boundId !== exceptId) {
    throw new Error('EPC 已绑定其他运动员')
  }
}

function findAthlete(catalog: AthleteCatalog, id: number): AthleteProfile {
  const athlete = catalog.athletes.find((candidate) => candidate.id === id)
  if (!athlete) throw new Error('未找到运动员')
  return athlete
}

function buildActiveEpcIndex(athletes: AthleteProfile[]): Record<string, number> {
  const index: Record<string, number> = {}
  athletes.forEach((athlete) => {
    if (athlete.status === 'active') index[athlete.epc] = athlete.id
  })
  return index
}

function profilesByStatus(
  catalog: AthleteCatalog,
  status: AthleteProfile['status'],
): AthleteProfile[] {
  return catalog.athletes
    .filter((athlete) => athlete.status === status)
    .sort((left, right) => left.id - right.id)
    .map((athlete) => ({ ...athlete }))
}

function cloneCatalog(catalog: AthleteCatalog): AthleteCatalog {
  return {
    ...catalog,
    athletes: catalog.athletes.map((athlete) => ({ ...athlete })),
    activeEpcIndex: { ...catalog.activeEpcIndex },
  }
}
