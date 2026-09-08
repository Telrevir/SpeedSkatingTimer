import type {
  AthleteCatalog,
  AthleteCatalogStorage,
} from '../domain/athlete-profile'
import { parseCatalogCache } from '../domain/catalog-cache'
import { BACKEND_CONFIG } from '../services/backend-api/config'
import { CATALOG_CACHE_STORAGE_KEY } from './wechat-catalog-cache-storage'

const STORAGE_KEY = 'timer_count_athlete_catalog_v1'

export class WechatAthleteCatalogStorage implements AthleteCatalogStorage {
  read(): unknown {
    // v2 联合快照只在完整写成功后才会出现；优先读它，旧 v1 仅作为迁移回退。
    try {
      const value = wx.getStorageSync(CATALOG_CACHE_STORAGE_KEY)
      if (value && typeof value === 'object' && (value as { schemaVersion?: unknown }).schemaVersion === 2) {
        return parseCatalogCache(value).clubs[String(BACKEND_CONFIG.clubId)]?.athletes
      }
    } catch { /* 旧目录缓存仍可离线读取，不因损坏的新键覆盖它。 */ }
    return wx.getStorageSync(STORAGE_KEY)
  }
  write(value: AthleteCatalog): void { wx.setStorageSync(STORAGE_KEY, value) }
}
