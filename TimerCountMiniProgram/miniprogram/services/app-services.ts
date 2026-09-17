import { BleTransport } from '../transport/ble-transport'
import { WechatBluetoothApiAdapter } from '../transport/wechat-bluetooth-api'
import { RaceController } from './race-controller'
import { ScoreRepository } from './score-repository'
import { WechatScoreStorage } from '../platform/wechat-score-storage'
import { WechatGroupStorage } from '../platform/wechat-group-storage'
import { WechatCatalogCacheStorage } from '../platform/wechat-catalog-cache-storage'
import { WechatRaceOutboxStorage } from '../platform/wechat-race-outbox-storage'
import { GroupStore } from '../stores/group-store'
import { AthleteRepository } from './athlete-repository'
import { AthleteCatalogService } from './athlete-catalog-service'
import { WechatAthleteCatalogStorage } from '../platform/wechat-athlete-catalog-storage'
import { WechatActiveRaceSessionStorage } from '../platform/wechat-active-race-session-storage'
import { ActiveRaceSessionRepository } from './active-race-session-repository'
import { ProtocolLogStore } from '../stores/protocol-log-store'
import { StartupSync } from './backend-sync/startup-sync'
import { CatalogCacheSync } from './backend-sync/catalog-cache-sync'
import { CatalogCacheRepository } from './catalog-cache-repository'
import { RaceOutboxRepository } from './race-outbox-repository'
import { RaceSyncScheduler } from './backend-sync/race-sync-scheduler'
import { createWechatEnginePort } from './backend-sync/race-sync-engine-port'
import { WorkerRequestBridge } from './backend-sync/worker-request-bridge'
import { RaceSyncService } from './race-sync-service'
import { AthleteManagementService } from './athlete-management-service'
import { GroupManagementService } from './group-management-service'
import { backendClient } from './backend-api/request'
import type { ApiResult } from './backend-api/request'
import { BACKEND_CONFIG } from './backend-api/config'

import { WechatBleProfileStorage } from '../platform/wechat-ble-profile-storage'
import { BleProfileRepository } from './ble-profile-repository'
const bluetoothApi = new WechatBluetoothApiAdapter()
export const bleProfileRepository = new BleProfileRepository(new WechatBleProfileStorage())
const bleTransport = new BleTransport(bluetoothApi, () => bleProfileRepository.active())
export const scoreRepository = new ScoreRepository(new WechatScoreStorage())
export const groupStore = new GroupStore(new WechatGroupStorage())
export const athleteCatalog = new AthleteCatalogService(new AthleteRepository(new WechatAthleteCatalogStorage()), {
  onArchived: (athleteId) => groupStore.removeMember(athleteId),
})
export const activeRaceSessionRepository = new ActiveRaceSessionRepository(new WechatActiveRaceSessionStorage())
export const protocolLog = new ProtocolLogStore()
export const catalogCacheRepository = new CatalogCacheRepository(new WechatCatalogCacheStorage())
export const mappingStorage = {
  read: () => wx.getStorageSync('timer_count_backend_sync_ids_v1'),
  write: (value: unknown) => wx.setStorageSync('timer_count_backend_sync_ids_v1', value),
}
export const raceOutboxRepository = new RaceOutboxRepository(new WechatRaceOutboxStorage())
const workerRequestBridge = new WorkerRequestBridge(backendClient)
let requestSequence = 0
export const raceSyncScheduler: RaceSyncScheduler = new RaceSyncScheduler({
  outbox: raceOutboxRepository,
  enginePort: createWechatEnginePort(),
  execute: (task): Promise<ApiResult<unknown>> => raceSyncService.execute(task),
})
export const raceSyncService: RaceSyncService = new RaceSyncService({
  scoreRepository,
  outbox: raceOutboxRepository,
  scheduler: raceSyncScheduler,
  client: backendClient,
  clubId: BACKEND_CONFIG.clubId,
  request: (endpoint, payload, task) => workerRequestBridge.request({
    type: 'request',
    requestId: `race:${task.taskId}:${task.attempt}:${++requestSequence}`,
    taskId: task.taskId,
    endpoint,
    payload,
  }),
})
export const raceController = new RaceController(
  bleTransport, athleteCatalog, scoreRepository, groupStore, activeRaceSessionRepository, protocolLog, raceSyncService,
)
export const catalogSync = new CatalogCacheSync({
  clubId: BACKEND_CONFIG.clubId, cache: catalogCacheRepository, athleteCatalog, groupStore,
  client: backendClient, mappingStorage,
})
export const athleteManagement = new AthleteManagementService({
  clubId: BACKEND_CONFIG.clubId, cache: catalogCacheRepository, athleteCatalog, groupStore, client: backendClient,
})
export const groupManagement = new GroupManagementService({
  clubId: BACKEND_CONFIG.clubId, cache: catalogCacheRepository, athleteCatalog, groupStore,
  client: backendClient, mappingStorage,
})
export const startupSync = new StartupSync({ catalogRefresher: catalogSync, wakePendingRaces: () => raceSyncScheduler.wake() })
