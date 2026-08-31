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
