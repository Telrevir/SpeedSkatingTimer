import type { AthleteGroup } from '../domain/athlete-group'

export interface GroupStorage {
  read(): unknown
  write(value: unknown): void
}

export class GroupStore {
  private groups: AthleteGroup[]
  private activeGroupId: string | null = null
  private readonly listeners = new Set<(groups: AthleteGroup[]) => void>()

  constructor(
    private readonly storage: GroupStorage,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.groups = parseGroups(storage.read())
  }

  get snapshot(): AthleteGroup[] {
    return this.groups.map((group) => ({ ...group, athleteIds: [...group.athleteIds] }))
  }

  get active(): AthleteGroup | null {
    const group = this.groups.find(({ id }) => id === this.activeGroupId)
    return group ? { ...group, athleteIds: [...group.athleteIds] } : null
  }

  select(id: string | null): void {
    if (id !== null && !this.groups.some((group) => group.id === id)) {
      throw new Error('分组不存在')
    }
    this.activeGroupId = id
    this.notify()
  }

  create(name: string, athleteIds: number[]): AthleteGroup {
    const normalizedName = name.trim()
    if (!normalizedName) throw new Error('分组名称不能为空')
    if (this.groups.some((group) => group.name === normalizedName)) {
      throw new Error('分组名称已存在')
    }
    const timestamp = this.now()
    const group: AthleteGroup = {
      id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      name: normalizedName,
      athleteIds: uniqueIds(athleteIds),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.groups = [...this.groups, group]
    this.persist()
    return { ...group, athleteIds: [...group.athleteIds] }
  }

  update(id: string, name: string, athleteIds: number[]): void {
    const normalizedName = name.trim()
    if (!normalizedName) throw new Error('分组名称不能为空')
    if (this.groups.some((group) => group.id !== id && group.name === normalizedName)) {
      throw new Error('分组名称已存在')
    }
    const existing = this.groups.find((group) => group.id === id)
    if (!existing) throw new Error('分组不存在')
    this.groups = this.groups.map((group) => group.id === id
      ? { ...group, name: normalizedName, athleteIds: uniqueIds(athleteIds), updatedAt: this.now() }
      : group)
    this.persist()
  }

  remove(id: string): void {
    this.groups = this.groups.filter((group) => group.id !== id)
    if (this.activeGroupId === id) this.activeGroupId = null
    this.persist()
  }

  pruneMembers(validIds: number[]): void {
    const valid = new Set(validIds)
    let changed = false
    this.groups = this.groups.map((group) => {
      const athleteIds = group.athleteIds.filter((id) => valid.has(id))
      if (athleteIds.length !== group.athleteIds.length) {
        changed = true
        return { ...group, athleteIds, updatedAt: this.now() }
      }
      return group
    })
    if (changed) this.persist()
  }

  removeMember(athleteId: number): void {
    let changed = false
    this.groups = this.groups.map((group) => {
      if (!group.athleteIds.includes(athleteId)) return group
      changed = true
      return {
        ...group,
        athleteIds: group.athleteIds.filter((id) => id !== athleteId),
        updatedAt: this.now(),
      }
    })
    if (changed) this.persist()
  }

  subscribe(listener: (groups: AthleteGroup[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  private persist(): void {
    this.storage.write(this.groups)
    this.notify()
  }

  private notify(): void {
    const snapshot = this.snapshot
    this.listeners.forEach((listener) => listener(snapshot))
  }
}

function uniqueIds(ids: number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))]
}

function parseGroups(value: unknown): AthleteGroup[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is AthleteGroup => {
    if (!item || typeof item !== 'object') return false
    const candidate = item as Partial<AthleteGroup>
    return typeof candidate.id === 'string'
      && typeof candidate.name === 'string'
      && Array.isArray(candidate.athleteIds)
  }).map((group) => ({
    id: group.id,
    name: group.name,
    athleteIds: uniqueIds(group.athleteIds),
    createdAt: typeof group.createdAt === 'number' ? group.createdAt : 0,
    updatedAt: typeof group.updatedAt === 'number' ? group.updatedAt : 0,
  }))
}
