import {
  cloneCatalogCache,
  cloneEntry,
  emptyClubCatalogEntry,
  parseCatalogCache,
  type CatalogCacheStorage,
  type ClubCatalogCacheEntry,
} from '../domain/catalog-cache'
import type { AthleteCatalog } from '../domain/athlete-profile'
import type { AthleteGroup } from '../domain/athlete-group'

export class CatalogCacheRepository {
  private readonly storage: CatalogCacheStorage
  private cache: ReturnType<typeof parseCatalogCache>

  constructor(storage: CatalogCacheStorage) {
    // 不使用参数属性和字段初始化器的组合：部分小程序编译产物会先执行
    // 字段初始化器，导致 this.storage 尚未赋值时便调用 read()。
    this.storage = storage
    this.cache = parseCatalogCache(storage.read())
  }

  load(clubId: number): ClubCatalogCacheEntry {
    validateClubId(clubId)
    const entry = this.cache.clubs[String(clubId)]
    return cloneEntry(entry ?? emptyClubCatalogEntry())
  }

  /** 先写入单一联合快照，写成功后才替换进程内版本。 */
  replaceFromServer(
    clubId: number,
    athletes: AthleteCatalog,
    groups: AthleteGroup[],
    refreshedAt: number = Date.now(),
  ): ClubCatalogCacheEntry {
    validateClubId(clubId)
    if (!Number.isFinite(refreshedAt)) throw new Error('缓存刷新时间无效')
    const next = cloneCatalogCache(this.cache)
    next.clubs[String(clubId)] = cloneEntry({ athletes, groups, refreshedAt })
    // storage.write 抛错时 this.cache 保持旧完整快照，调用方也不会收到发布。
    this.storage.write(next)
    this.cache = next
    return cloneEntry(next.clubs[String(clubId)]!)
  }
}

function validateClubId(clubId: number): void {
  if (!Number.isInteger(clubId) || clubId < 1 || clubId > 0x7fffffff) throw new Error('ClubID 无效')
}
