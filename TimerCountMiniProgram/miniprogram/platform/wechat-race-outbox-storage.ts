import type { RaceOutboxStorage } from '../services/race-outbox-repository'

const STORAGE_KEY = 'roller-timer-race-outbox-v1'

export class WechatRaceOutboxStorage implements RaceOutboxStorage {
  read(): unknown { return wx.getStorageSync(STORAGE_KEY) }
  write(value: unknown): void { wx.setStorageSync(STORAGE_KEY, value) }
}
