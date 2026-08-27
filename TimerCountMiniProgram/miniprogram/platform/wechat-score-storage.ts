import type { ScoreStorage } from '../services/score-repository'

const STORAGE_KEY = 'roller-timer-race-records-v1'

export class WechatScoreStorage implements ScoreStorage {
  read(): unknown {
    return wx.getStorageSync(STORAGE_KEY)
  }

  write(value: unknown): void {
    wx.setStorageSync(STORAGE_KEY, value)
  }
}
