import type { GroupStorage } from '../stores/group-store'

const STORAGE_KEY = 'roller-timer-athlete-groups-v1'

export class WechatGroupStorage implements GroupStorage {
  read(): unknown { return wx.getStorageSync(STORAGE_KEY) }
  write(value: unknown): void { wx.setStorageSync(STORAGE_KEY, value) }
}
