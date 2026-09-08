import type { GroupStorage } from '../stores/group-store'
import { parseCatalogCache } from '../domain/catalog-cache'
import { BACKEND_CONFIG } from '../services/backend-api/config'
import { CATALOG_CACHE_STORAGE_KEY } from './wechat-catalog-cache-storage'

const STORAGE_KEY = 'roller-timer-athlete-groups-v1'

export class WechatGroupStorage implements GroupStorage {
  read(): unknown {
    try {
      const value = wx.getStorageSync(CATALOG_CACHE_STORAGE_KEY)
      if (value && typeof value === 'object' && (value as { schemaVersion?: unknown }).schemaVersion === 2) {
        return parseCatalogCache(value).clubs[String(BACKEND_CONFIG.clubId)]?.groups
      }
    } catch { /* 保留 v1 作为兼容读取路径。 */ }
    return wx.getStorageSync(STORAGE_KEY)
  }
  write(value: unknown): void { wx.setStorageSync(STORAGE_KEY, value) }
}
