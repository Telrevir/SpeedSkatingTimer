import type { Athlete } from '../domain/athlete'
import { LocalRaceScoring } from '../domain/local-race-scoring'
import {
  AutoConnectState,
  ConnectionState,
  FirmwareDetectionState,
  TargetDeviceNotFoundError,
} from '../domain/race-state'
import {
  decodeAthleteTransferState,
  decodeFirmwareAthleteScore,
  decodeOrdinaryEpc,
  encodeAthleteDefinition,
  type AthleteClassification,
} from '../protocol/athlete-sync-codec'
import { CommandId } from '../protocol/commands'
import { encodePacket, LoraPacketDecoder, type LoraPacket } from '../protocol/lora-packet-codec'
import { AthleteStore } from '../stores/athlete-store'
import type { GroupStore } from '../stores/group-store'
import { RaceStore, type RaceSnapshot } from '../stores/race-store'
import type { AthleteCatalogService } from './athlete-catalog-service'
import type { ActiveRaceSessionRepository } from './active-race-session-repository'
import { EpcDefinitionQueue } from './epc-definition-queue'
import type { ScoreRepository } from './score-repository'

export interface RaceTransport {
  connect(): Promise<void>
  send(packet: Uint8Array): Promise<void>
  onData(listener: (value: Uint8Array) => void): () => void
  onDisconnect(listener: () => void): () => void
}

export interface ProtocolPacketLogger {
  record(packet: Uint8Array): void
}

export class RaceController {
  private readonly decoder = new LoraPacketDecoder()
  private readonly raceStore = new RaceStore()
  private readonly athleteStore = new AthleteStore()
  private readonly scoring = new LocalRaceScoring()
  private readonly definitionQueue: EpcDefinitionQueue | null
  private sendQueue: Promise<void> = Promise.resolve()
  private raceHistoryFinished = false
  private foregroundSync: Promise<void> | null = null
  private raceStateRequest: Promise<FirmwareDetectionState> | null = null
  private connectionAttempt: Promise<void> | null = null
  private pendingRaceState: {
    resolve: (state: FirmwareDetectionState) => void
    reject: (error: Error) => void
    timeoutId: ReturnType<typeof setTimeout>
  } | null = null
  private pendingAthleteTransfer: {
    started: boolean
    resolve: () => void
    reject: (error: Error) => void
    timeoutId: ReturnType<typeof setTimeout>
  } | null = null
  private pendingControl: {
    commandId: CommandId
    resolve: () => void
    reject: (error: Error) => void
    onSuccess: () => void
    timeoutId: ReturnType<typeof setTimeout>
  } | null = null

  constructor(
    private readonly transport: RaceTransport,
    private readonly athleteCatalog: AthleteCatalogService,
    private readonly scoreRepository?: ScoreRepository,
    private readonly groupStore?: GroupStore,
    private readonly activeSessionRepository?: ActiveRaceSessionRepository,
    private readonly protocolLog?: ProtocolPacketLogger,
  ) {
    this.definitionQueue = activeSessionRepository
      ? new EpcDefinitionQueue(activeSessionRepository, async (definition) => {
        await this.sendAcknowledgedCommand(
          CommandId.DefineEpc,
          encodeAthleteDefinition(definition),
          () => undefined,
        )
      })
      : null
    this.transport.onData((chunk) => {
      this.decoder.push(chunk).forEach((packet) => {
        this.protocolLog?.record(encodePacket(packet.commandId, packet.payload))
        this.handlePacket(packet)
      })
    })
    this.transport.onDisconnect(() => this.handleDisconnect())
    this.athleteCatalog.subscribe((active) => this.athleteStore.replaceProfiles(active))
  }

  get snapshot(): RaceSnapshot { return this.raceStore.snapshot }
  get athletesSnapshot(): Athlete[] { return this.athleteStore.snapshot }
  get groupsSnapshot() { return this.groupStore?.snapshot ?? [] }
  get activeGroup() { return this.groupStore?.active ?? null }

  get canManageAthletes(): boolean {
    return this.scoring.phase === 'idle'
      && this.raceStore.snapshot.firmwareState !== FirmwareDetectionState.Detecting
      && this.pendingControl === null
      && (this.activeSessionRepository?.load() ?? null) === null
  }

  selectGroup(id: string | null): void {
    if (!this.canManageAthletes) throw new Error('本场比赛重置前不能切换分组')
    this.groupStore?.select(id)
  }

  subscribe(listener: (snapshot: RaceSnapshot) => void): () => void {
    return this.raceStore.subscribe(listener)
  }

  subscribeAthletes(listener: (athletes: Athlete[]) => void): () => void {
    return this.athleteStore.subscribe(listener)
  }

  async connect(): Promise<void> {
    await this.getOrStartConnectionAttempt()
  }

  async autoConnect(): Promise<void> {
    if (this.isConnected()) {
      await this.syncForegroundState().catch(() => undefined)
      return
    }
    const startedThisAttempt = this.connectionAttempt === null
    if (startedThisAttempt) this.raceStore.setAutoConnectState(AutoConnectState.Searching)
    try {
      await this.getOrStartConnectionAttempt()
      if (startedThisAttempt) this.raceStore.setAutoConnectState(AutoConnectState.Connected)
    } catch (error) {
      if (!startedThisAttempt) return
      if (this.isConnected()) {
        this.raceStore.setAutoConnectState(AutoConnectState.Connected)
      } else if (error instanceof TargetDeviceNotFoundError) {
        this.raceStore.setAutoConnectState(AutoConnectState.NotFound)
      } else {
        this.raceStore.setAutoConnectState(AutoConnectState.Failed)
      }
    }
  }

  async syncForegroundState(): Promise<void> {
    if (this.raceStore.snapshot.connectionState !== ConnectionState.Connected) return
    if (this.foregroundSync) return this.foregroundSync
    const operation = this.performForegroundSync()
    this.foregroundSync = operation
    this.raceStore.setSyncError(null)
    try {
      await operation
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('同步设备状态失败')
      this.raceStore.setSyncError(failure.message)
      throw failure
    } finally {
      if (this.foregroundSync === operation) this.foregroundSync = null
    }
  }

  async requestLiveState(): Promise<void> {
    await this.requestFirmwareState()
  }

  async startRace(): Promise<void> {
    if (this.scoring.phase !== 'idle') throw new Error('当前比赛尚未重置')
    const firmwareState = this.raceStore.snapshot.firmwareState
    if (firmwareState === FirmwareDetectionState.Detecting) {
      throw new Error('设备仍在检测，请先重置')
    }
    if (firmwareState !== FirmwareDetectionState.Stopped) {
      throw new Error('正在同步设备状态，请稍后重试')
    }
    const activeGroup = this.groupStore?.active
    const participantIds = this.athleteCatalog.activeSnapshot
      .filter(({ id }) => !activeGroup || activeGroup.athleteIds.includes(id))
      .map(({ id }) => id)
    if (participantIds.length === 0) throw new Error('当前参赛名单为空')
    if (participantIds.length > 50) throw new Error('每场比赛最多选择 50 名运动员')

    await this.sendAcknowledgedCommand(CommandId.StartDetection, undefined, () => {
      this.activeSessionRepository?.save({
        participantIds,
        activeGroupId: activeGroup?.id ?? null,
        athleteDefinitionCount: 0,
        nonAthleteDefinitionCount: 0,
        lapCorrectionStates: [],
        localPhase: 'running',
        finishLap: null,
      })
      this.scoring.start(participantIds)
      this.raceHistoryFinished = false
      this.scoreRepository?.beginRace()
      this.raceStore.setFirmwareState(FirmwareDetectionState.Detecting)
      this.syncViews()
    })
  }

  endRace(): void {
    this.scoring.beginFinishing()
    this.persistRaceProgress()
    this.syncViews()
    this.finishHistoryIfNeeded()
  }

  async resetRace(): Promise<void> {
    await this.sendAcknowledgedCommand(CommandId.StopDetection, undefined, () => {
      this.scoreRepository?.finishRace()
      this.raceHistoryFinished = true
      this.definitionQueue?.clear()
      this.activeSessionRepository?.clear()
      this.scoring.reset()
      this.raceStore.setFirmwareState(FirmwareDetectionState.Stopped)
      this.syncViews()
    })
  }

  private async sendCommand(commandId: CommandId, payload?: Uint8Array): Promise<void> {
    const packet = encodePacket(commandId, payload)
    const operation = this.sendQueue.then(() => this.transport.send(packet))
    this.sendQueue = operation.catch(() => undefined)
    await operation
  }

  private handleDisconnect(): void {
    const error = new Error('蓝牙连接已断开')
    this.decoder.reset()

    const pendingRaceState = this.pendingRaceState
    this.pendingRaceState = null
    this.raceStateRequest = null
    this.foregroundSync = null
    // 断联后的自动重连必须创建新连接，不能复用旧连接尚未结束的同步 Promise。
    this.connectionAttempt = null
    if (pendingRaceState) {
      clearTimeout(pendingRaceState.timeoutId)
      pendingRaceState.reject(error)
    }

    const pendingAthleteTransfer = this.pendingAthleteTransfer
    this.pendingAthleteTransfer = null
    if (pendingAthleteTransfer) {
      clearTimeout(pendingAthleteTransfer.timeoutId)
      pendingAthleteTransfer.reject(error)
    }

    const pendingControl = this.pendingControl
    this.pendingControl = null
    if (pendingControl) {
      clearTimeout(pendingControl.timeoutId)
      pendingControl.reject(error)
    }

    this.sendQueue = Promise.resolve()
    this.raceStore.setConnectionState(ConnectionState.Disconnected)
    this.raceStore.setAutoConnectState(AutoConnectState.Idle)
    this.raceStore.setFirmwareState(FirmwareDetectionState.Unknown)
    this.raceStore.setAthleteTransferState('idle')
    void this.autoConnect()
  }

  private async getOrStartConnectionAttempt(): Promise<void> {
    if (this.connectionAttempt) return this.connectionAttempt
    const operation = this.performConnection()
    this.connectionAttempt = operation
    try {
      await operation
    } finally {
      if (this.connectionAttempt === operation) this.connectionAttempt = null
    }
  }

  private async performConnection(): Promise<void> {
    await this.transport.connect()
    this.raceStore.setConnectionState(ConnectionState.Connected)
    await this.syncForegroundState()
  }

  private isConnected(): boolean {
    return this.raceStore.snapshot.connectionState === ConnectionState.Connected
  }

  private async performForegroundSync(): Promise<void> {
    const firmwareState = await this.requestFirmwareState()
    if (firmwareState !== FirmwareDetectionState.Detecting) return
    const session = this.activeSessionRepository?.load()
    if (session) {
      this.groupStore?.select(session.activeGroupId)
      this.scoring.resume(
        session.participantIds,
        session.lapCorrectionStates ?? [],
        session.localPhase ?? 'running',
        session.finishLap ?? null,
      )
      this.syncViews()
    }
    await this.requestAllAthletes()
  }

  private async requestFirmwareState(): Promise<FirmwareDetectionState> {
    if (this.raceStateRequest) return this.raceStateRequest
    const operation = this.performRaceStateRequest()
    this.raceStateRequest = operation
    try {
      return await operation
    } finally {
      if (this.raceStateRequest === operation) this.raceStateRequest = null
    }
  }

  private async performRaceStateRequest(): Promise<FirmwareDetectionState> {
    if (this.pendingRaceState) throw new Error('比赛状态查询正在进行中')
    let resolveState!: (state: FirmwareDetectionState) => void
    let rejectState!: (error: Error) => void
    const response = new Promise<FirmwareDetectionState>((resolve, reject) => {
      resolveState = resolve
      rejectState = reject
    })
    void response.catch(() => undefined)
    let pending!: {
      resolve: (state: FirmwareDetectionState) => void
      reject: (error: Error) => void
      timeoutId: ReturnType<typeof setTimeout>
    }
    const timeoutId = setTimeout(() => {
      if (this.pendingRaceState !== pending) return
      this.pendingRaceState = null
      rejectState(new Error('设备未返回比赛状态'))
    }, 10_000)
    pending = { resolve: resolveState, reject: rejectState, timeoutId }
    this.pendingRaceState = pending
    try {
      await this.sendCommand(CommandId.GetRaceState)
    } catch (error) {
      clearTimeout(timeoutId)
      if (this.pendingRaceState === pending) this.pendingRaceState = null
      rejectState(error instanceof Error ? error : new Error('比赛状态查询发送失败'))
    }
    return response
  }

  private async requestAllAthletes(): Promise<void> {
    if (this.pendingAthleteTransfer) throw new Error('运动员状态同步正在进行中')
    let resolveTransfer!: () => void
    let rejectTransfer!: (error: Error) => void
    const completion = new Promise<void>((resolve, reject) => {
      resolveTransfer = resolve
      rejectTransfer = reject
    })
    void completion.catch(() => undefined)
    let pending!: {
      started: boolean
      resolve: () => void
      reject: (error: Error) => void
      timeoutId: ReturnType<typeof setTimeout>
    }
    const timeoutId = setTimeout(() => {
      if (this.pendingAthleteTransfer !== pending) return
      this.pendingAthleteTransfer = null
      rejectTransfer(new Error('运动员状态传输超时'))
    }, 10_000)
    pending = {
      started: false,
      resolve: resolveTransfer,
      reject: rejectTransfer,
      timeoutId,
    }
    this.pendingAthleteTransfer = pending
    try {
      await this.sendCommand(CommandId.GetAllAthletes)
    } catch (error) {
      clearTimeout(timeoutId)
      if (this.pendingAthleteTransfer === pending) this.pendingAthleteTransfer = null
      rejectTransfer(error instanceof Error ? error : new Error('运动员状态查询发送失败'))
    }
    return completion
  }

  private async sendAcknowledgedCommand(
    commandId: CommandId,
    payload: Uint8Array | undefined,
    onSuccess: () => void,
  ): Promise<void> {
    if (this.pendingControl) throw new Error('另一项设备控制操作正在等待确认')
    let resolveConfirmation!: () => void
    let rejectConfirmation!: (error: Error) => void
    const confirmation = new Promise<void>((resolve, reject) => {
      resolveConfirmation = resolve
      rejectConfirmation = reject
    })
    void confirmation.catch(() => undefined)
    let pending!: {
      commandId: CommandId
      resolve: () => void
      reject: (error: Error) => void
      onSuccess: () => void
      timeoutId: ReturnType<typeof setTimeout>
    }
    const timeoutId = setTimeout(() => {
      if (this.pendingControl !== pending) return
      this.pendingControl = null
      rejectConfirmation(new Error('设备未确认控制操作'))
    }, 10_000)
    pending = {
      commandId,
      resolve: resolveConfirmation,
      reject: rejectConfirmation,
      onSuccess,
      timeoutId,
    }
    this.pendingControl = pending
    try {
      await this.sendCommand(commandId, payload)
    } catch (error) {
      clearTimeout(timeoutId)
      if (this.pendingControl === pending) this.pendingControl = null
      throw error
    }
    return confirmation
  }

  private handlePacket(packet: LoraPacket): void {
    if (packet.commandId === CommandId.RaceState && packet.payload.length === 1) {
      const state = packet.payload[0]
      if (state === FirmwareDetectionState.Stopped || state === FirmwareDetectionState.Detecting) {
        this.raceStore.setFirmwareState(state)
        const pending = this.pendingRaceState
        if (pending) {
          clearTimeout(pending.timeoutId)
          this.pendingRaceState = null
          pending.resolve(state)
        }
      }
      return
    }
    if (packet.commandId === CommandId.AthleteTransferState) {
      const state = decodeAthleteTransferState(packet.payload)
      if (state) {
        this.handleAthleteTransferState(state)
        return
      }
      this.raceStore.setSyncError('0x13 Payload无效')
      return
    }
    if (packet.commandId === CommandId.AthleteInfo) {
      this.handleAthleteInfo(packet.payload)
      return
    }
    if (packet.commandId === CommandId.OrdinaryEpcDetected) {
      this.handleOrdinaryEpc(packet.payload)
      return
    }
    if (packet.commandId === CommandId.CommandResult && packet.payload.length === 2) {
      this.handleCommandResult(packet.payload[0]!, packet.payload[1]!)
    }
  }

  private handleAthleteTransferState(state: 'receiving' | 'idle'): void {
    this.raceStore.setAthleteTransferState(state)
    const pending = this.pendingAthleteTransfer
    if (!pending) return
    if (state === 'receiving') {
      pending.started = true
      return
    }
    if (!pending.started) return
    clearTimeout(pending.timeoutId)
    this.pendingAthleteTransfer = null
    pending.resolve()
  }

  private handleAthleteInfo(payload: Uint8Array): void {
    const firmwareScore = decodeFirmwareAthleteScore(payload)
    if (!firmwareScore) {
      this.raceStore.setSyncError('0x12 Payload无效')
      return
    }
    const session = this.activeSessionRepository?.load()
    if (!session) {
      this.recordMissingSessionIfDetecting()
      return
    }
    const profile = this.athleteCatalog.lookupActiveById(firmwareScore.athleteId)
    if (!profile || !session.participantIds.includes(profile.id)) return
    const score = this.scoring.applyFirmwareScore(
      profile.id,
      firmwareScore.lapCount,
      firmwareScore.lapCentiseconds,
      firmwareScore.totalCentiseconds,
    )
    if (!score) return

    this.persistRaceProgress()
    this.syncViews()
    this.scoreRepository?.appendScore({
      athleteId: profile.id,
      name: profile.name,
      epc: profile.epc,
      lap: score.correctedLapCount,
      rawLap: score.rawLapCount,
      correctionOffset: score.correctionOffset,
      correctedLap: score.correctedLapCount,
      lapCentiseconds: score.lapCentiseconds,
      totalCentiseconds: score.totalCentiseconds,
      rank: score.currentRank,
    }, this.raceStore.snapshot.athleteTransferState === 'receiving')
    this.finishHistoryIfNeeded()
  }

  private handleOrdinaryEpc(payload: Uint8Array): void {
    const epc = decodeOrdinaryEpc(payload)
    if (!epc) {
      this.raceStore.setSyncError('0x14 Payload无效')
      return
    }
    const session = this.activeSessionRepository?.load()
    if (!session) {
      this.recordMissingSessionIfDetecting()
      return
    }
    const profile = this.athleteCatalog.lookupActiveByEpc(epc)
    const isAthlete = profile !== null && session.participantIds.includes(profile.id)
    const definition: AthleteClassification = {
      isAthlete,
      epc,
      athleteId: isAthlete ? profile.id : null,
    }
    void this.definitionQueue?.enqueue(definition).catch((error) => {
      const failure = error instanceof Error ? error : new Error('EPC 定义失败')
      this.raceStore.setSyncError(failure.message)
    })
  }

  private recordMissingSessionIfDetecting(): void {
    if (this.raceStore.snapshot.firmwareState === FirmwareDetectionState.Detecting) {
      this.raceStore.setSyncError('缺少本地比赛会话')
    }
  }

  private handleCommandResult(originalCommandId: number, statusCode: number): void {
    const pending = this.pendingControl
    if (!pending || pending.commandId !== originalCommandId) return
    clearTimeout(pending.timeoutId)
    this.pendingControl = null
    if (statusCode !== 0x00) {
      pending.reject(new Error(commandStatusMessage(statusCode)))
      return
    }
    try {
      pending.onSuccess()
      pending.resolve()
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error('控制操作失败'))
    }
  }

  private syncViews(): void {
    const leaderId = this.scoring.leaderAthleteId
    const leader = leaderId === null ? null : this.scoring.getScore(leaderId)
    this.athleteStore.replaceScores(this.scoring.snapshot)
    this.raceStore.setRaceState({
      localPhase: this.scoring.phase,
      finishLap: this.scoring.finishLap,
      leaderAthleteId: leaderId,
      leaderLapCount: leader?.lapCount ?? null,
      leaderLapCentiseconds: leader?.lapCentiseconds ?? null,
    })
  }

  private finishHistoryIfNeeded(): void {
    if (this.scoring.phase !== 'finished' || this.raceHistoryFinished) return
    this.scoreRepository?.finishRace()
    this.raceHistoryFinished = true
  }

  private persistRaceProgress(): void {
    const phase = this.scoring.phase
    if (phase === 'idle') return
    this.activeSessionRepository?.saveRaceProgress(
      this.scoring.correctionSnapshot,
      phase,
      this.scoring.finishLap,
    )
  }
}

function commandStatusMessage(statusCode: number): string {
  switch (statusCode) {
    case 0x01: return 'Payload长度错误'
    case 0x02: return '未知命令'
    case 0x03: return 'RFID未初始化'
    case 0x04: return 'RFID启动失败'
    case 0x05: return 'RFID停止失败'
    case 0x06: return 'EPC格式错误'
    case 0x07: return 'RFID接收队列溢出'
    case 0x08: return 'EPC去重表已满'
    case 0x09: return 'LoRa发送失败'
    case 0x0a: return '当前状态不允许执行'
    case 0x0b: return '数据包校验和错误'
    case 0x0c: return '数据包尾错误'
    case 0x0d: return 'Payload长度超过上限'
    case 0x0e: return '数据包接收超时'
    case 0x0f: return 'RFID通信错误'
    default: return `设备返回错误状态 0x${statusCode.toString(16).padStart(2, '0').toUpperCase()}`
  }
}
