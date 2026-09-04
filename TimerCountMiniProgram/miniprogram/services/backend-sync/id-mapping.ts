export type EntityKind = 'group' | 'member' | 'race' | 'join' | 'score'
export interface MappingStorage { read(): unknown; write(value: unknown): void }
interface ClubMapping { nextLong: number; nextGroup: number; ids: Record<string, number> }
interface StoredMapping { schemaVersion: 1; clubs: Record<string, ClubMapping> }
const kinds: EntityKind[] = ['group', 'member', 'race', 'join', 'score']
const limit = (kind: EntityKind) => kind === 'group' ? 0x7fffffff : Number.MAX_SAFE_INTEGER

export class SyncIdMapping {
  private readonly data: StoredMapping
  private readonly club: ClubMapping
  private readonly occupied = new Map<EntityKind, Set<number>>()
  // 仅记录本次 execute 开始时从远端快照 reserve 的 ID，用于上传前核对“既有绑定是否已被其他远端父记录占用”。
  private readonly remote = new Map<EntityKind, Set<number>>()

  constructor(private readonly storage: MappingStorage, clubId: number, now: () => number = Date.now, random: () => number = Math.random) {
    if (!Number.isInteger(clubId) || clubId < 1 || clubId > 0x7fffffff) throw new Error('ClubID 无效')
    this.data = readMapping(storage.read())
    const key = String(clubId)
    // 时间戳加随机低位降低跨设备碰撞；服务端和本地占用检查仍不可省略。
    this.club = this.data.clubs[key] ?? {
      nextLong: Math.max(1, now() * 1024 + Math.floor(random() * 1024)),
      nextGroup: 1 + Math.floor(random() * 1000000000), ids: {},
    }
    this.data.clubs[key] = this.club
    kinds.forEach((kind) => { this.occupied.set(kind, new Set()); this.remote.set(kind, new Set()) })
    Object.entries(this.club.ids).forEach(([storedKey, id]) => {
      this.occupied.get(JSON.parse(storedKey)[0] as EntityKind)!.add(id)
    })
  }

  reserve(kind: EntityKind, values: number[]): void {
    values.forEach((id) => { checkId(kind, id); this.occupied.get(kind)!.add(id); this.remote.get(kind)!.add(id) })
  }

  /** 某 ID 是否来自本次拉取的远端快照（即被某个云端父记录占用）。 */
  isRemote(kind: EntityKind, id: number): boolean { return this.remote.get(kind)!.has(id) }

  get(kind: EntityKind, key: string): number | undefined { return this.club.ids[JSON.stringify([kind, key])] }

  assign(kind: EntityKind, key: string): number {
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

  bind(kind: EntityKind, key: string, id: number): void {
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

  save(): void { this.storage.write(JSON.parse(JSON.stringify(this.data))) }
}

function checkId(kind: EntityKind, id: number): void {
  if (!Number.isSafeInteger(id) || id < 1 || id > limit(kind)) throw new Error('同步 ID 超出安全范围')
}

function readMapping(value: unknown): StoredMapping {
  if (value === undefined || value === null || value === '') return { schemaVersion: 1, clubs: {} }
  const data = value as StoredMapping
  if (!data || data.schemaVersion !== 1 || !data.clubs || typeof data.clubs !== 'object' || Array.isArray(data.clubs)) throw new Error('同步 ID 存储损坏')
  for (const [clubId, club] of Object.entries(data.clubs)) {
    if (!/^[1-9]\d*$/.test(clubId) || Number(clubId) > 0x7fffffff || !club || !Number.isSafeInteger(club.nextLong)
      || club.nextLong < 1 || !Number.isInteger(club.nextGroup) || club.nextGroup < 1 || club.nextGroup > 0x80000000
      || !club.ids || typeof club.ids !== 'object' || Array.isArray(club.ids)) throw new Error('同步 ID 存储损坏')
    const used = new Set<string>()
    for (const [key, id] of Object.entries(club.ids)) {
      const parts: unknown = JSON.parse(key)
      if (!Array.isArray(parts) || parts.length !== 2 || !kinds.includes(parts[0]) || typeof parts[1] !== 'string' || !parts[1]) throw new Error('同步 ID 键损坏')
      checkId(parts[0], id)
      const identity = `${parts[0]}:${id}`
      if (used.has(identity)) throw new Error('同步 ID 重复')
      used.add(identity)
    }
  }
  return JSON.parse(JSON.stringify(data)) as StoredMapping
}
