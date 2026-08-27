import type { ActiveRaceSessionStorage } from '../services/active-race-session-repository'

const STORAGE_KEY = 'roller-timer-active-race-session-v1'

export class WechatActiveRaceSessionStorage implements ActiveRaceSessionStorage {
  read(): unknown { return wx.getStorageSync(STORAGE_KEY) }
  write(value: unknown): void { wx.setStorageSync(STORAGE_KEY, value) }
  remove(): void { wx.removeStorageSync(STORAGE_KEY) }
}
