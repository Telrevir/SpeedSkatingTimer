/** 新目录缓存只允许分配分组及成员关系的稳定 ID。 */
export type EntityKind = 'group' | 'member'
/** 仅为尚未迁移的旧启动同步保留的历史实体种类。 */
export type LegacyEntityKind = EntityKind | 'race' | 'join' | 'score'
export interface MappingStorage { read(): unknown; write(value: unknown): void }
interface ClubMapping {
  nextLong: number
  nextGroup: number
  ids: Record<string, number>
  /** v1 兼容扩展：服务端已占用但尚未绑定本地键的 ID。 */
  reserved?: Partial<Record<LegacyEntityKind, number[]>>
}
interface StoredMapping { schemaVersion: 1; clubs: Record<string, ClubMapping> }
const kinds: LegacyEntityKind[] = ['group', 'member', 'race', 'join', 'score']
const limit = (kind: LegacyEntityKind) => kind === 'group' ? 0x7fffffff : Number.MAX_SAFE_INTEGER

export class LegacySyncIdMapping {
  private readonly data: StoredMapping
  private readonly club: ClubMapping
  private readonly occupied = new Map<LegacyEntityKind, Set<number>>()
  // 仅记录本次 execute 开始时从远端快照 reserve 的 ID，用于上传前核对“既有绑定是否已被其他远端父记录占用”。
  private readonly remote = new Map<LegacyEntityKind, Set<number>>()

  constructor(private readonly storage: MappingStorage, clubId: number, now: () => number = Date.now, random: () => number = Math.random) {
    if (!Number.isInteger(clubId) || clubId < 1 || clubId > 0x7fffffff) throw new Error('ClubID 无效')
    this.data = readMapping(storage.read())
    const key = String(clubId)
    // 时间戳加随机低位降低跨设备碰撞；服务端和本地占用检查仍不可省略。
    this.club = this.data.clubs[key] ?? {
      nextLong: Math.max(1, now() * 1024 + Math.floor(random() * 1024)),
      nextGroup: 1 + Math.floor(random() * 1000000000), ids: {}, reserved: {},
    }
    this.data.clubs[key] = this.club
    this.club.reserved ??= {}
    kinds.forEach((kind) => { this.occupied.set(kind, new Set()); this.remote.set(kind, new Set()) })
    Object.entries(this.club.ids).forEach(([storedKey, id]) => {
      this.occupied.get(JSON.parse(storedKey)[0] as LegacyEntityKind)!.add(id)
    })
    kinds.forEach((kind) => (this.club.reserved?.[kind] ?? []).forEach((id) => {
      checkId(kind, id)
      this.occupied.get(kind)!.add(id)
      this.remote.get(kind)!.add(id)
    }))
  }

  reserve(kind: LegacyEntityKind, values: number[]): void {
    const saved = this.club.reserved![kind] ?? []
    values.forEach((id) => {
      checkId(kind, id)
      this.occupied.get(kind)!.add(id)
      this.remote.get(kind)!.add(id)
      if (!saved.includes(id)) saved.push(id)
    })
    this.club.reserved![kind] = saved
  }

  /** 某 ID 是否来自本次拉取的远端快照（即被某个云端父记录占用）。 */
  isRemote(kind: LegacyEntityKind, id: number): boolean { return this.remote.get(kind)!.has(id) }

  get(kind: LegacyEntityKind, key: string): number | undefined { return this.club.ids[JSON.stringify([kind, key])] }

  assign(kind: LegacyEntityKind, key: string): number {
    const existing = this.get(kind, key)
    if (existing !== undefined) return existing
    const field = kind === 'group' ? 'nextGroup' : 'nextLong'
    while (this.occupied.get(kind)!.has(this.club[field])) this.club[field] += 1
    const id = this.club[field]
    checkId(kind, id)
    this.bind(kind, key, id)
    this.club[field] += 1
    return id
  }

  bind(kind: LegacyEntityKind, key: string, id: number): void {
    checkId(kind, id)
    if (!key) throw new Error('本地 ID 为空')
    const storedKey = JSON.stringify([kind, key])
    const old = this.club.ids[storedKey]
    if (old !== undefined && old !== id) throw new Error('本地与云端 ID 映射冲突')
    if (Object.entries(this.club.ids).some(([other, value]) => other !== storedKey && value === id && JSON.parse(other)[0] === kind)) {
      throw new Error('云端 ID 已绑定其他本地记录')
    }
    this.club.ids[storedKey] = id
    this.occupied.get(kind)!.add(id)
  }

  rekey(kind: LegacyEntityKind, from: string, to: string): void {
    const id = this.get(kind, from)
    if (id === undefined) throw new Error('待迁移的同步 ID 不存在')
    if (from === to) return
    const target = this.get(kind, to)
    if (target !== undefined && target !== id) throw new Error('本地与云端 ID 映射冲突')
    delete this.club.ids[JSON.stringify([kind, from])]
    this.bind(kind, to, id)
  }

  save(): void { this.storage.write(JSON.parse(JSON.stringify(this.data))) }
}

/**
 * Task 2 的目录缓存只能使用 group/member。旧 schema 中 race/join/score 键由
 * LegacySyncIdMapping 兼容读取，因而不会被新目录分配或覆盖。
 */
export class SyncIdMapping {
  private readonly legacy: LegacySyncIdMapping

  constructor(storage: MappingStorage, clubId: number, now: () => number = Date.now, random: () => number = Math.random) {
    this.legacy = new LegacySyncIdMapping(storage, clubId, now, random)
  }

  // 签名保持旧启动同步兼容；Task 2 新目录服务只传 EntityKind（group/member）。
  reserve(kind: EntityKind, values: number[]): void { this.legacy.reserve(kind, values) }
  isRemote(kind: EntityKind, id: number): boolean { return this.legacy.isRemote(kind, id) }
  get(kind: EntityKind, key: string): number | undefined { return this.legacy.get(kind, key) }
  assign(kind: EntityKind, key: string): number { return this.legacy.assign(kind, key) }
  bind(kind: EntityKind, key: string, id: number): void { this.legacy.bind(kind, key, id) }
  rekey(kind: EntityKind, from: string, to: string): void { this.legacy.rekey(kind, from, to) }
  save(): void { this.legacy.save() }
}

function checkId(kind: LegacyEntityKind, id: number): void {
  if (!Number.isSafeInteger(id) || id < 1 || id > limit(kind)) throw new Error('同步 ID 超出安全范围')
}

function readMapping(value: unknown): StoredMapping {
  if (value === undefined || value === null || value === '') return { schemaVersion: 1, clubs: {} }
  const data = value as StoredMapping
  if (!data || data.schemaVersion !== 1 || !data.clubs || typeof data.clubs !== 'object' || Array.isArray(data.clubs)) throw new Error('同步 ID 存储损坏')
  for (const [clubId, club] of Object.entries(data.clubs)) {
    if (!/^[1-9]\d*$/.test(clubId) || Number(clubId) > 0x7fffffff || !club || !Number.isSafeInteger(club.nextLong)
      || club.nextLong < 1 || !Number.isInteger(club.nextGroup) || club.nextGroup < 1 || club.nextGroup > 0x80000000
      || !club.ids || typeof club.ids !== 'object' || Array.isArray(club.ids)
      || (club.reserved !== undefined && (!club.reserved || typeof club.reserved !== 'object' || Array.isArray(club.reserved)))) throw new Error('同步 ID 存储损坏')
    const used = new Set<string>()
    for (const [key, id] of Object.entries(club.ids)) {
      const parts: unknown = JSON.parse(key)
      if (!Array.isArray(parts) || parts.length !== 2 || !kinds.includes(parts[0] as LegacyEntityKind) || typeof parts[1] !== 'string' || !parts[1]) throw new Error('同步 ID 键损坏')
      checkId(parts[0] as LegacyEntityKind, id)
      const identity = `${parts[0] as LegacyEntityKind}:${id}`
      if (used.has(identity)) throw new Error('同步 ID 重复')
      used.add(identity)
    }
    for (const [kind, ids] of Object.entries(club.reserved ?? {})) {
      if (!kinds.includes(kind as LegacyEntityKind) || !Array.isArray(ids)) throw new Error('同步 ID 保留项损坏')
      ids.forEach((id) => checkId(kind as LegacyEntityKind, id))
    }
  }
  return JSON.parse(JSON.stringify(data)) as StoredMapping
}
