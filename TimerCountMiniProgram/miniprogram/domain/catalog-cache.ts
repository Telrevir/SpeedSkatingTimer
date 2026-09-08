import { emptyAthleteCatalog, type AthleteCatalog } from './athlete-profile'
import type { AthleteGroup } from './athlete-group'

export interface ClubCatalogCacheEntry {
  athletes: AthleteCatalog
  groups: AthleteGroup[]
  refreshedAt: number
}

export interface ClubCatalogCacheV2 {
  schemaVersion: 2
  clubs: Record<string, ClubCatalogCacheEntry>
}

export interface CatalogCacheStorage {
  read(): unknown
  write(value: ClubCatalogCacheV2): void
}

export function emptyClubCatalogCache(): ClubCatalogCacheV2 {
  return { schemaVersion: 2, clubs: {} }
}

export function emptyClubCatalogEntry(): ClubCatalogCacheEntry {
  return { athletes: emptyAthleteCatalog(), groups: [], refreshedAt: 0 }
}

export function cloneCatalogCache(cache: ClubCatalogCacheV2): ClubCatalogCacheV2 {
  return {
    schemaVersion: 2,
    clubs: Object.fromEntries(Object.entries(cache.clubs).map(([clubId, entry]) => [clubId, cloneEntry(entry)])),
  }
}

export function cloneEntry(entry: ClubCatalogCacheEntry): ClubCatalogCacheEntry {
  return {
    athletes: {
      ...entry.athletes,
      athletes: entry.athletes.athletes.map((athlete) => ({ ...athlete })),
      activeEpcIndex: { ...entry.athletes.activeEpcIndex },
    },
    groups: entry.groups.map((group) => ({
      ...group,
      athleteIds: [...group.athleteIds],
      ...(group.memberEnabled ? { memberEnabled: { ...group.memberEnabled } } : {}),
    })),
    refreshedAt: entry.refreshedAt,
  }
}

export function parseCatalogCache(value: unknown): ClubCatalogCacheV2 {
  if (value === null || value === undefined || value === '') return emptyClubCatalogCache()
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('运动员分组缓存损坏')
  const root = value as Partial<ClubCatalogCacheV2>
  if (root.schemaVersion !== 2 || !root.clubs || typeof root.clubs !== 'object' || Array.isArray(root.clubs)) {
    throw new Error('运动员分组缓存版本不支持')
  }
  const result = emptyClubCatalogCache()
  Object.entries(root.clubs).forEach(([clubId, entry]) => {
    if (!/^[1-9]\d*$/.test(clubId) || Number(clubId) > 0x7fffffff) throw new Error('运动员分组缓存俱乐部无效')
    validateEntry(entry)
    result.clubs[clubId] = cloneEntry(entry)
  })
  return result
}

function validateEntry(entry: unknown): asserts entry is ClubCatalogCacheEntry {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('运动员分组缓存条目无效')
  const value = entry as Partial<ClubCatalogCacheEntry>
  const catalog = value.athletes
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.athletes)
    || !catalog.activeEpcIndex || typeof catalog.activeEpcIndex !== 'object'
    || !Number.isInteger(catalog.revision) || !Number.isInteger(catalog.nextId)) {
    throw new Error('运动员分组缓存运动员无效')
  }
  if (!Array.isArray(value.groups) || !Number.isFinite(value.refreshedAt)) throw new Error('运动员分组缓存分组无效')
}
