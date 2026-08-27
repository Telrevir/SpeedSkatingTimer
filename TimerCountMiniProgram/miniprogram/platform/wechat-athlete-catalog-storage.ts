import type {
  AthleteCatalog,
  AthleteCatalogStorage,
} from '../domain/athlete-profile'

const STORAGE_KEY = 'timer_count_athlete_catalog_v1'

export class WechatAthleteCatalogStorage implements AthleteCatalogStorage {
  read(): unknown { return wx.getStorageSync(STORAGE_KEY) }
  write(value: AthleteCatalog): void { wx.setStorageSync(STORAGE_KEY, value) }
}
