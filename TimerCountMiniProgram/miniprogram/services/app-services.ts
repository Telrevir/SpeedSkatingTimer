import { BleTransport } from '../transport/ble-transport'
import { WechatBluetoothApiAdapter } from '../transport/wechat-bluetooth-api'
import { RaceController } from './race-controller'
import { ScoreRepository } from './score-repository'
import { WechatScoreStorage } from '../platform/wechat-score-storage'
import { WechatGroupStorage } from '../platform/wechat-group-storage'
import { GroupStore } from '../stores/group-store'
import { AthleteRepository } from './athlete-repository'
import { AthleteCatalogService } from './athlete-catalog-service'
import { WechatAthleteCatalogStorage } from '../platform/wechat-athlete-catalog-storage'
import { WechatActiveRaceSessionStorage } from '../platform/wechat-active-race-session-storage'
import { ActiveRaceSessionRepository } from './active-race-session-repository'
import { ProtocolLogStore } from '../stores/protocol-log-store'
import { StartupSync } from './backend-sync/startup-sync'
import { BACKEND_CONFIG } from './backend-api/config'

const bluetoothApi = new WechatBluetoothApiAdapter()
const bleTransport = new BleTransport(bluetoothApi)
export const scoreRepository = new ScoreRepository(new WechatScoreStorage())
export const groupStore = new GroupStore(new WechatGroupStorage())
export const athleteCatalog = new AthleteCatalogService(
  new AthleteRepository(new WechatAthleteCatalogStorage()),
  { onArchived: (athleteId) => groupStore.removeMember(athleteId) },
)
export const activeRaceSessionRepository = new ActiveRaceSessionRepository(
  new WechatActiveRaceSessionStorage(),
)
export const protocolLog = new ProtocolLogStore()

export const raceController = new RaceController(
  bleTransport,
  athleteCatalog,
  scoreRepository,
  groupStore,
  activeRaceSessionRepository,
  protocolLog,
)

// 与旧临时映射分离；存储损坏不会自动清理或重建已上传记录的身份。
export const startupSync = new StartupSync({
  athleteCatalog, groupStore, scoreRepository, clubId: BACKEND_CONFIG.clubId,
  mappingStorage: {
    read: () => wx.getStorageSync('timer_count_backend_sync_ids_v1'),
    write: (value) => wx.setStorageSync('timer_count_backend_sync_ids_v1', value),
  },
  isBusy: () => !raceController.canManageAthletes,
})
