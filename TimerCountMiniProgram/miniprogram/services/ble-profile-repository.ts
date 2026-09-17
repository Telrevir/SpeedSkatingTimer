import {
  DEFAULT_BLE_PROFILE,
  type BleConnectionProfile,
} from '../config/ble-config'

export interface BleProfileStorage {
  read(): unknown
  write(value: unknown): void
}

export interface BleProfileInput {
  id?: string
  name: string
  serviceUuid: string
  commandRxUuid: string
  notificationTxUuid: string
}

export interface BleProfileListItem extends BleConnectionProfile {
  isActive: boolean
}

interface StoredProfiles {
  schemaVersion: 1
  activeId: string
  profiles: BleConnectionProfile[]
}

let generatedProfileSequence = 0

export class BleProfileRepository {
  constructor(
    private readonly storage: BleProfileStorage,
    private readonly now: () => number = () => Date.now(),
  ) {}

  list(): BleProfileListItem[] {
    const stored = this.load()
    return stored.profiles.map((profile) => ({
      ...profile,
      isActive: profile.id === stored.activeId,
    }))
  }

  active(): BleConnectionProfile {
    const stored = this.load()
    const profile = stored.profiles.find(({ id }) => id === stored.activeId)
    return copyProfile(profile ?? stored.profiles[0] ?? DEFAULT_BLE_PROFILE)
  }

  save(input: BleProfileInput): BleConnectionProfile {
    const stored = this.load()
    const normalized = normalizeInput(input)
    const existingIndex = input.id === undefined
      ? -1
      : stored.profiles.findIndex(({ id }) => id === input.id)
    const profile: BleConnectionProfile = {
      ...normalized,
      id: existingIndex >= 0
        ? stored.profiles[existingIndex]!.id
        : this.newId(stored.profiles),
    }
    if (existingIndex >= 0) stored.profiles[existingIndex] = profile
    else stored.profiles.push(profile)
    this.persist(stored)
    return copyProfile(profile)
  }

  activate(id: string): BleConnectionProfile {
    const stored = this.load()
    const profile = stored.profiles.find((candidate) => candidate.id === id)
    if (!profile) throw new Error('未找到该蓝牙配置')
    stored.activeId = profile.id
    this.persist(stored)
    return copyProfile(profile)
  }

  remove(id: string): void {
    const stored = this.load()
    if (stored.profiles.length <= 1) throw new Error('至少保留一组蓝牙配置')
    const index = stored.profiles.findIndex((profile) => profile.id === id)
    if (index < 0) throw new Error('未找到该蓝牙配置')
    stored.profiles.splice(index, 1)
    if (stored.activeId === id) stored.activeId = stored.profiles[0]!.id
    this.persist(stored)
  }

  private load(): StoredProfiles {
    const parsed = parseStored(this.storage.read())
    return parsed ?? {
      schemaVersion: 1,
      activeId: DEFAULT_BLE_PROFILE.id,
      profiles: [copyProfile(DEFAULT_BLE_PROFILE)],
    }
  }

  private persist(stored: StoredProfiles): void {
    this.storage.write({
      schemaVersion: 1,
      activeId: stored.activeId,
      profiles: stored.profiles.map(copyProfile),
    })
  }

  private newId(profiles: BleConnectionProfile[]): string {
    let id: string
    do {
      generatedProfileSequence += 1
      id = `ble-${this.now()}-${generatedProfileSequence}`
    } while (profiles.some((profile) => profile.id === id))
    return id
  }
}

function normalizeInput(input: BleProfileInput): Omit<BleConnectionProfile, 'id'> {
  const name = input.name.trim()
  if (!name) throw new Error('蓝牙名称不能为空')
  if (name.length > 64) throw new Error('蓝牙名称不能超过 64 个字符')
  return {
    name,
    serviceUuid: normalizeUuid(input.serviceUuid),
    commandRxUuid: normalizeUuid(input.commandRxUuid),
    notificationTxUuid: normalizeUuid(input.notificationTxUuid),
  }
}

function normalizeUuid(value: string): string {
  const compact = value.trim().replace(/-/g, '').toUpperCase()
  if (/^[0-9A-F]{4}$/.test(compact)) {
    return `0000${compact}-0000-1000-8000-00805F9B34FB`
  }
  if (!/^[0-9A-F]{32}$/.test(compact)) throw new Error('UUID 格式无效')
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`
}

function parseStored(value: unknown): StoredProfiles | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { schemaVersion?: unknown; activeId?: unknown; profiles?: unknown }
  if (candidate.schemaVersion !== 1 || typeof candidate.activeId !== 'string' || !Array.isArray(candidate.profiles)) return null
  const profiles = candidate.profiles.filter(isProfile).map(copyProfile)
  if (!profiles.length || !profiles.some(({ id }) => id === candidate.activeId)) return null
  return { schemaVersion: 1, activeId: candidate.activeId, profiles }
}

function isProfile(value: unknown): value is BleConnectionProfile {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return ['id', 'name', 'serviceUuid', 'commandRxUuid', 'notificationTxUuid']
    .every((key) => typeof candidate[key] === 'string')
}

function copyProfile(profile: BleConnectionProfile): BleConnectionProfile {
  return { ...profile }
}
