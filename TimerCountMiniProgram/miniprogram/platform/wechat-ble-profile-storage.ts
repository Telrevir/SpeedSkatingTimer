import type { BleProfileStorage } from '../services/ble-profile-repository'

const STORAGE_KEY = 'timer_count_ble_profiles_v1'

export class WechatBleProfileStorage implements BleProfileStorage {
  read(): unknown {
    return wx.getStorageSync(STORAGE_KEY)
  }

  write(value: unknown): void {
    wx.setStorageSync(STORAGE_KEY, value)
  }
}
