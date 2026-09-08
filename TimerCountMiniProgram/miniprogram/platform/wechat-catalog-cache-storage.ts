import type { CatalogCacheStorage, ClubCatalogCacheV2 } from '../domain/catalog-cache'

export const CATALOG_CACHE_STORAGE_KEY = 'timer_count_club_catalog_v2'

export class WechatCatalogCacheStorage implements CatalogCacheStorage {
  read(): unknown { return wx.getStorageSync(CATALOG_CACHE_STORAGE_KEY) }
  write(value: ClubCatalogCacheV2): void { wx.setStorageSync(CATALOG_CACHE_STORAGE_KEY, value) }
}
