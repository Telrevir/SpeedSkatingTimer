import type { ScoreStorage } from '../services/score-repository'

const WORKING_COPY_STORAGE_KEY = 'roller-timer-race-working-copies-v2'
const LEGACY_STORAGE_KEY = 'roller-timer-race-records-v1'

export class WechatScoreStorage implements ScoreStorage {
  read(): unknown {
    const workingCopies = wx.getStorageSync(WORKING_COPY_STORAGE_KEY)
    return workingCopies === '' || workingCopies === undefined || workingCopies === null
      ? wx.getStorageSync(LEGACY_STORAGE_KEY)
      : workingCopies
  }

  write(value: unknown): void {
    wx.setStorageSync(WORKING_COPY_STORAGE_KEY, value)
  }
}
