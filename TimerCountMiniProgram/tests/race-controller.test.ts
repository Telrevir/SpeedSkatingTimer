import assert from 'node:assert/strict'
import test from 'node:test'

import type { AthleteCatalog, AthleteCatalogStorage } from '../miniprogram/domain/athlete-profile'
import {
  AutoConnectState,
  ConnectionState,
  FirmwareDetectionState,
  TargetDeviceNotFoundError,
} from '../miniprogram/domain/race-state'
import { CommandId } from '../miniprogram/protocol/commands'
import { encodePacket } from '../miniprogram/protocol/lora-packet-codec'
import {
  ActiveRaceSessionRepository,
  type ActiveRaceSessionStorage,
} from '../miniprogram/services/active-race-session-repository'
import { AthleteCatalogService } from '../miniprogram/services/athlete-catalog-service'
import { AthleteRepository } from '../miniprogram/services/athlete-repository'
import { RaceController, type RaceTransport } from '../miniprogram/services/race-controller'
import { ScoreRepository, type ScoreStorage } from '../miniprogram/services/score-repository'
import { GroupStore, type GroupStorage } from '../miniprogram/stores/group-store'
import { ProtocolLogStore } from '../miniprogram/stores/protocol-log-store'

class MemoryRaceTransport implements RaceTransport {
  readonly sent: Uint8Array[] = []
  connectCalls = 0
  connectError: Error | null = null
  failNextCommandId: CommandId | null = null
  private delayedFailure: {
    commandId: CommandId
    started: () => void
    completion: Promise<void>
  } | null = null
  private dataListener: ((value: Uint8Array) => void) | null = null
  private readonly disconnectListeners = new Set<() => void>()
  private delayedConnect: { started: () => void; completion: Promise<void> } | null = null

  async connect(): Promise<void> {
    this.connectCalls += 1
    const delayedConnect = this.delayedConnect
    if (delayedConnect) {
      this.delayedConnect = null
      delayedConnect.started()
      await delayedConnect.completion
    }
    if (this.connectError) throw this.connectError
  }
  async send(packet: Uint8Array): Promise<void> {
    const delayedFailure = this.delayedFailure
    if (delayedFailure && delayedFailure.commandId === packet[1]) {
      this.delayedFailure = null
      this.sent.push(packet)
      delayedFailure.started()
      await delayedFailure.completion
      throw new Error('delayed send failed')
    }
    if (packet[1] === this.failNextCommandId) {
      this.failNextCommandId = null
      throw new Error('send failed')
    }
    this.sent.push(packet)
  }
  onData(listener: (value: Uint8Array) => void): () => void {
    this.dataListener = listener
    return () => { this.dataListener = null }
  }
  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener)
    return () => this.disconnectListeners.delete(listener)
  }
  emit(value: Uint8Array): void { this.dataListener?.(value) }
  disconnect(): void { this.disconnectListeners.forEach((listener) => listener()) }
  delayNextConnect(): { started: Promise<void>; release: () => void } {
    let markStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const completion = new Promise<void>((resolve) => { release = resolve })
    this.delayedConnect = { started: markStarted, completion }
    return { started, release }
  }
  delayFailureForNext(commandId: CommandId): { started: Promise<void>; release: () => void } {
    let markStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const completion = new Promise<void>((resolve) => { release = resolve })
    this.delayedFailure = { commandId, started: markStarted, completion }
    return { started, release }
  }
}

class MemoryCatalogStorage implements AthleteCatalogStorage {
  value: unknown = null
  read(): unknown { return this.value }
  write(value: AthleteCatalog): void { this.value = value }
}

class MemoryScoreStorage implements ScoreStorage {
  value: unknown = null
  read(): unknown { return this.value }
  write(value: unknown): void { this.value = value }
}

class MemoryGroupStorage implements GroupStorage {
  value: unknown = null
  read(): unknown { return this.value }
  write(value: unknown): void { this.value = value }
}

class MemoryActiveSessionStorage implements ActiveRaceSessionStorage {
  value: unknown = null
  read(): unknown { return this.value }
  write(value: unknown): void { this.value = value }
  remove(): void { this.value = null }
}

async function waitForSentCommand(
  transport: MemoryRaceTransport,
  commandId: CommandId,
): Promise<void> {
  return waitForCondition(
    () => transport.sent.some((packet) => packet[1] === commandId),
    `Command 0x${commandId.toString(16)} was not sent`,
  )
}

async function waitForCondition(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  assert.fail(message)
}

async function fixture(athletes: Array<[string, string]> = [['张三', '3333F337']]) {
  const transport = new MemoryRaceTransport()
  const catalog = new AthleteCatalogService(
    new AthleteRepository(new MemoryCatalogStorage()),
    { now: () => 1000 },
  )
  for (const [name, epc] of athletes) await catalog.create(name, epc)
  const scoreRepository = new ScoreRepository(new MemoryScoreStorage(), () => 1000)
  const groupStore = new GroupStore(new MemoryGroupStorage(), () => 1000)
  const activeSessionRepository = new ActiveRaceSessionRepository(new MemoryActiveSessionStorage())
  const protocolLog = new ProtocolLogStore(500, () => (
    new Date(2026, 7, 27, 15, 4, 5, 67).getTime()
  ))
  const controller = new RaceController(
    transport,
    catalog,
    scoreRepository,
    groupStore,
    activeSessionRepository,
    protocolLog,
  )
  return {
    transport,
    catalog,
    scoreRepository,
    groupStore,
    activeSessionRepository,
    protocolLog,
    controller,
  }
}

async function startRace(controller: RaceController, transport: MemoryRaceTransport): Promise<void> {
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))
  const pending = controller.startRace()
  await Promise.resolve()
  transport.emit(encodePacket(
    CommandId.CommandResult,
    Uint8Array.of(CommandId.StartDetection, 0x00),
  ))
  await pending
}

function athleteInfoEvent(
  athleteId: number,
  lapCount: number,
  totalCentiseconds: number,
  lapCentiseconds = 0,
): Uint8Array {
  return encodePacket(CommandId.AthleteInfo, Uint8Array.of(
    (athleteId >> 8) & 0xff,
    athleteId & 0xff,
    lapCount,
    (lapCentiseconds >> 16) & 0xff,
    (lapCentiseconds >> 8) & 0xff,
    lapCentiseconds & 0xff,
    (totalCentiseconds >> 16) & 0xff,
    (totalCentiseconds >> 8) & 0xff,
    totalCentiseconds & 0xff,
  ))
}

function ordinaryEpcEvent(epc: number[]): Uint8Array {
  return encodePacket(CommandId.OrdinaryEpcDetected, Uint8Array.of(...epc))
}

test('connects and completes foreground sync without athlete query while stopped', async () => {
  const { controller, transport } = await fixture()

  const connecting = controller.connect()
  await Promise.resolve()
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))
  await connecting

  assert.equal(controller.snapshot.connectionState, ConnectionState.Connected)
  assert.deepEqual(transport.sent.map((packet) => [...packet]), [
    [...encodePacket(CommandId.GetRaceState)],
  ])
})

test('skips foreground synchronization while disconnected', async () => {
  const { controller, transport } = await fixture()

  await controller.syncForegroundState()

  assert.deepEqual(transport.sent, [])
})

test('keeps a successful BLE connection marked connected when protocol synchronization fails', async () => {
  const { controller, transport } = await fixture()
  transport.failNextCommandId = CommandId.GetRaceState

  await assert.rejects(() => controller.connect(), /send failed/)

  assert.equal(controller.snapshot.connectionState, ConnectionState.Connected)
  assert.equal(controller.snapshot.syncError, 'send failed')
})

test('automatic connection reports not found without rejecting or sending protocol commands', async () => {
  const { controller, transport } = await fixture()
  transport.connectError = new TargetDeviceNotFoundError('ESP32-LORA-BRIDGE')

  await controller.autoConnect()

  assert.equal(controller.snapshot.connectionState, ConnectionState.Disconnected)
  assert.equal(controller.snapshot.autoConnectState, AutoConnectState.NotFound)
  assert.equal(transport.connectCalls, 1)
  assert.equal(transport.sent.length, 0)
})

test('automatic connection finds the device and completes the normal foreground sync', async () => {
  const { controller, transport } = await fixture()

  const connecting = controller.autoConnect()
  assert.equal(controller.snapshot.autoConnectState, AutoConnectState.Searching)
  await waitForSentCommand(transport, CommandId.GetRaceState)
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))
  await connecting

  assert.equal(controller.snapshot.connectionState, ConnectionState.Connected)
  assert.equal(controller.snapshot.autoConnectState, AutoConnectState.Connected)
})

test('automatic and manual requests share one in-flight connection attempt', async () => {
  const { controller, transport } = await fixture()
  const gate = transport.delayNextConnect()

  const first = controller.autoConnect()
  const second = controller.autoConnect()
  const manual = controller.connect()
  await gate.started
  assert.equal(transport.connectCalls, 1)

  gate.release()
  await waitForSentCommand(transport, CommandId.GetRaceState)
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))
  await Promise.all([first, second, manual])
  assert.equal(transport.connectCalls, 1)
})

test('disconnect starts a fresh automatic connection attempt', async () => {
  const { controller, transport } = await fixture()
  const firstConnection = controller.connect()
  await waitForSentCommand(transport, CommandId.GetRaceState)
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))
  await firstConnection

  transport.disconnect()

  await waitForCondition(() => transport.connectCalls === 2, 'automatic reconnect did not start')
  await waitForCondition(
    () => transport.sent.filter((packet) => packet[1] === CommandId.GetRaceState).length === 2,
    'automatic reconnect did not synchronize firmware state',
  )
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))
  await waitForCondition(
    () => controller.snapshot.autoConnectState === AutoConnectState.Connected,
    'automatic reconnect did not finish',
  )
})

test('returns the controller to disconnected and unknown firmware state when BLE drops', async () => {
  const { controller, transport } = await fixture()
  const connecting = controller.connect()
  await Promise.resolve()
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))
  await connecting

  transport.connectError = new TargetDeviceNotFoundError('ESP32-LORA-BRIDGE')
  transport.disconnect()

  assert.equal(controller.snapshot.connectionState, ConnectionState.Disconnected)
  assert.equal(controller.snapshot.firmwareState, FirmwareDetectionState.Unknown)
})

test('preserves the active race session and local scoring state when BLE drops', async () => {
  const { controller, transport, activeSessionRepository } = await fixture()
  await startRace(controller, transport)
  transport.emit(athleteInfoEvent(1, 0, 123))
  const athletesBeforeDisconnect = controller.athletesSnapshot
  const sessionBeforeDisconnect = activeSessionRepository.load()

  transport.connectError = new TargetDeviceNotFoundError('ESP32-LORA-BRIDGE')
  transport.disconnect()

  assert.equal(controller.snapshot.localPhase, 'running')
  assert.deepEqual(controller.athletesSnapshot, athletesBeforeDisconnect)
  assert.deepEqual(activeSessionRepository.load(), sessionBeforeDisconnect)
})

test('cancels stale foreground sync so reconnect sends a fresh race-state query', async () => {
  const { controller, transport } = await fixture()
  const firstOutcome = controller.connect().then(
    () => null,
    (error: unknown) => error,
  )
  await waitForSentCommand(transport, CommandId.GetRaceState)

  transport.disconnect()
  const reconnecting = controller.connect()
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
  const queryCount = transport.sent.filter((packet) => packet[1] === CommandId.GetRaceState).length

  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))
  await reconnecting
  const firstError = await firstOutcome

  assert.equal(queryCount, 2)
  assert.match(firstError instanceof Error ? firstError.message : '', /蓝牙连接已断开/)
  assert.equal(controller.snapshot.connectionState, ConnectionState.Connected)
})

test('a delayed failure from the old connection cannot clear the new race-state request', async () => {
  const { controller, transport } = await fixture()
  const gate = transport.delayFailureForNext(CommandId.GetRaceState)
  const firstOutcome = controller.connect().catch((error: unknown) => error)
  await gate.started

  transport.disconnect()
  const reconnecting = controller.connect()
  await waitForCondition(
    () => transport.sent.filter((packet) => packet[1] === CommandId.GetRaceState).length === 2,
    'Reconnect did not send a fresh race-state query',
  )
  type PendingProbe = {
    resolve: (state: FirmwareDetectionState) => void
    timeoutId: ReturnType<typeof setTimeout>
  }
  const probe = controller as unknown as { pendingRaceState: PendingProbe | null }
  const newPending = probe.pendingRaceState
  assert.ok(newPending)

  gate.release()
  await new Promise<void>((resolve) => setImmediate(resolve))
  const retainedPending = probe.pendingRaceState
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))
  if (retainedPending !== newPending) {
    clearTimeout(newPending.timeoutId)
    newPending.resolve(FirmwareDetectionState.Stopped)
  }
  await reconnecting
  await firstOutcome

  assert.equal(retainedPending, newPending)
})

test('shares one in-flight 0x03 between page polling and foreground synchronization', async () => {
  const { controller, transport } = await fixture()
  const connecting = controller.connect()
  await Promise.resolve()
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))
  await connecting
  const sentBefore = transport.sent.length

  const polling = controller.requestLiveState()
  const foreground = controller.syncForegroundState()
  await new Promise<void>((resolve) => setImmediate(resolve))
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))
  await Promise.all([polling, foreground])

  assert.equal(transport.sent.length, sentBefore + 1)
})

test('queries athlete state while detecting and waits for transfer end', async () => {
  const { controller, transport, groupStore, activeSessionRepository } = await fixture([
    ['张三', '3333F337'],
    ['李四', '01020304'],
  ])
  const group = groupStore.create('A组', [1])
  activeSessionRepository.save({
    participantIds: [1],
    activeGroupId: group.id,
    athleteDefinitionCount: 1,
    nonAthleteDefinitionCount: 2,
  })

  let settled = false
  const connecting = controller.connect().then(() => { settled = true })
  await Promise.resolve()
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Detecting)))
  await waitForSentCommand(transport, CommandId.GetAllAthletes)
  assert.deepEqual(
    transport.sent.map((packet) => packet[1]),
    [CommandId.GetRaceState, CommandId.GetAllAthletes],
  )
  assert.equal(settled, false)

  transport.emit(encodePacket(CommandId.AthleteTransferState, Uint8Array.of(0x01)))
  assert.equal(controller.snapshot.athleteTransferState, 'receiving')
  transport.emit(encodePacket(CommandId.AthleteTransferState, Uint8Array.of(0x00)))
  await connecting

  assert.equal(controller.snapshot.localPhase, 'running')
  assert.equal(controller.activeGroup?.id, group.id)
  assert.equal(controller.snapshot.athleteTransferState, 'idle')
  assert.equal(controller.snapshot.syncError, null)
})

test('coalesces concurrent foreground synchronization calls', async () => {
  const { controller, transport } = await fixture()
  const connecting = controller.connect()
  await Promise.resolve()
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))
  await connecting
  const sentBefore = transport.sent.length

  const first = controller.syncForegroundState()
  const second = controller.syncForegroundState()
  await Promise.resolve()
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))
  await Promise.all([first, second])

  assert.equal(transport.sent.length, sentBefore + 1)
})

test('keeps local phase idle when firmware is detecting without a saved session', async () => {
  const { controller, transport } = await fixture()
  const connecting = controller.connect()
  await Promise.resolve()
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Detecting)))
  await waitForSentCommand(transport, CommandId.GetAllAthletes)
  transport.emit(encodePacket(CommandId.AthleteTransferState, Uint8Array.of(0x01)))
  transport.emit(athleteInfoEvent(1, 0, 100))
  transport.emit(encodePacket(CommandId.AthleteTransferState, Uint8Array.of(0x00)))
  await connecting

  assert.equal(controller.snapshot.localPhase, 'idle')
  assert.equal(controller.snapshot.firmwareState, FirmwareDetectionState.Detecting)
  assert.equal(controller.snapshot.syncError, '缺少本地比赛会话')
})

test('locks athlete and group management immediately when a persisted session exists', async () => {
  const { controller, activeSessionRepository } = await fixture()
  activeSessionRepository.save({
    participantIds: [1],
    activeGroupId: null,
    athleteDefinitionCount: 0,
    nonAthleteDefinitionCount: 0,
  })

  assert.equal(controller.canManageAthletes, false)
  assert.throws(() => controller.selectGroup(null))
})

test('parses the two firmware detection states from 0x04', async () => {
  const { controller, transport } = await fixture()
  const observed: FirmwareDetectionState[] = []
  controller.subscribe(({ firmwareState }) => observed.push(firmwareState))

  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(0x01)))
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(0x00)))
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(0x03)))

  assert.deepEqual(observed, [
    FirmwareDetectionState.Unknown,
    FirmwareDetectionState.Detecting,
    FirmwareDetectionState.Stopped,
  ])
})

test('records diagnostics for invalid 0x12, 0x13 and 0x14 payloads', async () => {
  const { controller, transport } = await fixture()

  transport.emit(encodePacket(CommandId.AthleteInfo, Uint8Array.of(0x00)))
  assert.equal(controller.snapshot.syncError, '0x12 Payload无效')
  transport.emit(encodePacket(CommandId.AthleteTransferState, Uint8Array.of(0x02)))
  assert.equal(controller.snapshot.syncError, '0x13 Payload无效')
  transport.emit(encodePacket(CommandId.OrdinaryEpcDetected, Uint8Array.of(0x01)))
  assert.equal(controller.snapshot.syncError, '0x14 Payload无效')
})

test('waits for matching Start acknowledgement before creating the local race', async () => {
  const { controller, transport, scoreRepository, activeSessionRepository } = await fixture()
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))

  const pending = controller.startRace()
  await Promise.resolve()
  assert.deepEqual(transport.sent.map((packet) => packet[1]), [CommandId.StartDetection])
  assert.equal(controller.snapshot.localPhase, 'idle')

  transport.emit(encodePacket(CommandId.CommandResult, Uint8Array.of(CommandId.StartDetection, 0x00)))
  await pending

  assert.equal(controller.snapshot.localPhase, 'running')
  assert.equal(controller.snapshot.firmwareState, FirmwareDetectionState.Detecting)
  assert.equal(scoreRepository.listRaces().length, 1)
  assert.deepEqual(activeSessionRepository.load(), {
    participantIds: [1],
    activeGroupId: null,
    athleteDefinitionCount: 0,
    nonAthleteDefinitionCount: 0,
    lapCorrectionStates: [],
    localPhase: 'running',
    finishLap: null,
  })
})

test('rejects Start when more than 50 athletes are selected', async () => {
  const athletes: Array<[string, string]> = Array.from({ length: 51 }, (_, index) => [
    `Athlete ${index + 1}`,
    (index + 1).toString(16).padStart(8, '0'),
  ])
  const { controller, transport, activeSessionRepository } = await fixture(athletes)
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))

  await assert.rejects(() => controller.startRace(), /50/)
  assert.equal(transport.sent.length, 0)
  assert.equal(activeSessionRepository.load(), null)
})

test('End sends nothing and captures the current leader lap', async () => {
  const { controller, transport } = await fixture()
  await startRace(controller, transport)
  transport.emit(athleteInfoEvent(1, 0, 100))
  const sentBeforeEnd = transport.sent.length

  controller.endRace()

  assert.equal(transport.sent.length, sentBeforeEnd)
  assert.equal(controller.snapshot.finishLap, 0)
  assert.equal(controller.snapshot.localPhase, 'finished')
})

test('Reset clears local data and active session only after a successful Stop acknowledgement', async () => {
  const { controller, transport, activeSessionRepository } = await fixture()
  await startRace(controller, transport)
  transport.emit(athleteInfoEvent(1, 0, 100))

  const failed = controller.resetRace()
  await Promise.resolve()
  assert.equal(transport.sent[transport.sent.length - 1]?.[1], CommandId.StopDetection)
  transport.emit(encodePacket(CommandId.CommandResult, Uint8Array.of(CommandId.StopDetection, 0x05)))
  await assert.rejects(failed, /RFID停止失败/)
  assert.equal(controller.snapshot.localPhase, 'running')
  assert.equal(controller.athletesSnapshot[0]!.lapCount, 0)
  assert.notEqual(activeSessionRepository.load(), null)

  const succeeded = controller.resetRace()
  await Promise.resolve()
  transport.emit(encodePacket(CommandId.CommandResult, Uint8Array.of(CommandId.StopDetection, 0x00)))
  await succeeded
  assert.equal(controller.snapshot.localPhase, 'idle')
  assert.equal(controller.snapshot.firmwareState, FirmwareDetectionState.Stopped)
  assert.equal(controller.athletesSnapshot[0]!.lapCount, -1)
  assert.equal(controller.canManageAthletes, true)
  assert.equal(activeSessionRepository.load(), null)
})

test('uses firmware lap count, single-lap time and total time from 0x12', async () => {
  const { controller, transport } = await fixture()
  await startRace(controller, transport)

  transport.emit(athleteInfoEvent(1, 0, 100))
  let athlete = controller.athletesSnapshot[0]!
  assert.equal(athlete.lapCount, 0)
  assert.equal(athlete.lapCentiseconds, 0)
  assert.equal(athlete.currentRank, 1)

  transport.emit(athleteInfoEvent(1, 1, 5100, 4900))
  athlete = controller.athletesSnapshot[0]!
  assert.equal(athlete.lapCount, 1)
  assert.equal(athlete.lapCentiseconds, 4900)
  assert.equal(controller.snapshot.leaderAthleteId, athlete.id)
})

test('silently ignores missing and archived athlete IDs from 0x12', async () => {
  const { controller, transport, catalog } = await fixture([
    ['张三', '3333F337'],
    ['李四', '01020304'],
  ])
  await catalog.archive(2)
  await startRace(controller, transport)

  transport.emit(athleteInfoEvent(999, 0, 100))
  transport.emit(athleteInfoEvent(2, 0, 100))

  assert.equal(controller.athletesSnapshot[0]!.hasRaceScore, false)
  assert.equal(controller.athletesSnapshot.length, 1)
})

test('ignores a bound athlete outside the group locked at Start', async () => {
  const { controller, transport, groupStore } = await fixture([
    ['张三', '3333F337'],
    ['李四', '01020304'],
  ])
  const group = groupStore.create('A组', [1])
  controller.selectGroup(group.id)
  await startRace(controller, transport)

  transport.emit(athleteInfoEvent(2, 0, 100))

  assert.equal(controller.athletesSnapshot.find(({ id }) => id === 2)?.hasRaceScore, false)
})

test('processes 0x12 identically inside and outside a 0x13 transfer', async () => {
  const { controller, transport } = await fixture()
  await startRace(controller, transport)

  transport.emit(athleteInfoEvent(1, 0, 100))
  transport.emit(encodePacket(CommandId.AthleteTransferState, Uint8Array.of(0x01)))
  transport.emit(athleteInfoEvent(1, 1, 5100, 5000))
  transport.emit(encodePacket(CommandId.AthleteTransferState, Uint8Array.of(0x00)))
  transport.emit(athleteInfoEvent(1, 2, 10100, 5000))

  const athlete = controller.athletesSnapshot[0]!
  assert.equal(athlete.lapCount, 2)
  assert.equal(athlete.lapCentiseconds, 5000)
  assert.equal(athlete.totalCentiseconds, 10100)
})

test('classifies 0x14 EPC values by the participant scope and waits for 0x10 acknowledgements', async () => {
  const { controller, transport, groupStore, activeSessionRepository } = await fixture([
    ['张三', '3333F337'],
    ['李四', '01020304'],
  ])
  const group = groupStore.create('A组', [1])
  controller.selectGroup(group.id)
  await startRace(controller, transport)

  transport.emit(ordinaryEpcEvent([0x33, 0x33, 0xf3, 0x37]))
  await waitForSentCommand(transport, CommandId.DefineEpc)
  let definitions = transport.sent.filter((packet) => packet[1] === CommandId.DefineEpc)
  assert.deepEqual(
    [...definitions[0]!],
    [...encodePacket(CommandId.DefineEpc, Uint8Array.of(0x01, 0x33, 0x33, 0xf3, 0x37, 0x00, 0x01))],
  )
  transport.emit(encodePacket(CommandId.CommandResult, Uint8Array.of(CommandId.DefineEpc, 0x00)))
  await waitForCondition(
    () => activeSessionRepository.load()?.athleteDefinitionCount === 1,
    'Athlete definition was not counted',
  )

  transport.emit(ordinaryEpcEvent([0x01, 0x02, 0x03, 0x04]))
  await waitForCondition(
    () => transport.sent.filter((packet) => packet[1] === CommandId.DefineEpc).length === 2,
    'Out-of-group EPC was not classified',
  )
  definitions = transport.sent.filter((packet) => packet[1] === CommandId.DefineEpc)
  assert.deepEqual(
    [...definitions[1]!],
    [...encodePacket(CommandId.DefineEpc, Uint8Array.of(0x00, 0x01, 0x02, 0x03, 0x04, 0x00, 0x00))],
  )
  transport.emit(encodePacket(CommandId.CommandResult, Uint8Array.of(CommandId.DefineEpc, 0x00)))
  await waitForCondition(
    () => activeSessionRepository.load()?.nonAthleteDefinitionCount === 1,
    'Non-athlete definition was not counted',
  )

  transport.emit(ordinaryEpcEvent([0xaa, 0xbb, 0xcc, 0xdd]))
  await waitForCondition(
    () => transport.sent.filter((packet) => packet[1] === CommandId.DefineEpc).length === 3,
    'Unknown EPC was not classified',
  )
  definitions = transport.sent.filter((packet) => packet[1] === CommandId.DefineEpc)
  assert.deepEqual(
    [...definitions[2]!],
    [...encodePacket(CommandId.DefineEpc, Uint8Array.of(0x00, 0xaa, 0xbb, 0xcc, 0xdd, 0x00, 0x00))],
  )
  transport.emit(encodePacket(CommandId.CommandResult, Uint8Array.of(CommandId.DefineEpc, 0x00)))
  await waitForCondition(
    () => activeSessionRepository.load()?.nonAthleteDefinitionCount === 2,
    'Unknown EPC definition was not counted',
  )
})

test('keeps 0x12 score ingestion independent from a failed 0x10', async () => {
  const { controller, transport, activeSessionRepository } = await fixture()
  await startRace(controller, transport)

  transport.emit(ordinaryEpcEvent([0x33, 0x33, 0xf3, 0x37]))
  await waitForSentCommand(transport, CommandId.DefineEpc)
  transport.emit(encodePacket(CommandId.CommandResult, Uint8Array.of(CommandId.DefineEpc, 0x06)))
  transport.emit(athleteInfoEvent(1, 3, 12000))
  await waitForCondition(() => controller.snapshot.syncError !== null, '0x10 failure was not recorded')

  assert.equal(controller.athletesSnapshot[0]!.lapCount, 3)
  assert.equal(controller.athletesSnapshot[0]!.totalCentiseconds, 12000)
  assert.equal(activeSessionRepository.load()?.athleteDefinitionCount, 0)
})

test('ignores 0x12 and 0x14 while detecting without a persisted local session', async () => {
  const { controller, transport } = await fixture()
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Detecting)))
  const sentBefore = transport.sent.length

  transport.emit(athleteInfoEvent(1, 0, 100))
  transport.emit(ordinaryEpcEvent([0x33, 0x33, 0xf3, 0x37]))

  assert.equal(controller.athletesSnapshot[0]!.hasRaceScore, false)
  assert.equal(transport.sent.length, sentBefore)
  assert.equal(controller.snapshot.syncError, '缺少本地比赛会话')
})

test('freezes athletes at finishLap and finishes history after all participants arrive', async () => {
  const { controller, transport, scoreRepository } = await fixture([
    ['张三', '3333F337'],
    ['李四', '01020304'],
  ])
  await startRace(controller, transport)
  transport.emit(athleteInfoEvent(1, 0, 100))
  transport.emit(athleteInfoEvent(1, 1, 5100))
  transport.emit(athleteInfoEvent(2, 0, 200))

  controller.endRace()
  assert.equal(controller.snapshot.localPhase, 'finishing')
  transport.emit(athleteInfoEvent(1, 2, 10100))
  transport.emit(athleteInfoEvent(2, 1, 5300))

  assert.equal(controller.snapshot.localPhase, 'finished')
  assert.deepEqual(controller.athletesSnapshot.map(({ lapCount }) => lapCount), [1, 1])
  assert.equal(scoreRepository.listRaces()[0]!.finishedAt, 1000)
})

test('blocks Start and catalog management when firmware is detecting without a local session', async () => {
  const { controller, transport } = await fixture()
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Detecting)))

  assert.equal(controller.canManageAthletes, false)
  await assert.rejects(() => controller.startRace(), /设备仍在检测/)
  assert.equal(controller.snapshot.localPhase, 'idle')
})

test('rejects non-zero command results with the documented status message', async () => {
  const { controller, transport, activeSessionRepository } = await fixture()
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))

  const pending = controller.startRace()
  await Promise.resolve()
  transport.emit(encodePacket(CommandId.CommandResult, Uint8Array.of(CommandId.StartDetection, 0x04)))

  await assert.rejects(pending, /RFID启动失败/)
  assert.equal(controller.snapshot.localPhase, 'idle')
  assert.equal(activeSessionRepository.load(), null)
})

test('maps the new timeout and RFID communication command statuses', async () => {
  const { controller, transport } = await fixture()
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))

  const timedOut = controller.startRace()
  await waitForSentCommand(transport, CommandId.StartDetection)
  transport.emit(encodePacket(CommandId.CommandResult, Uint8Array.of(CommandId.StartDetection, 0x0e)))
  await assert.rejects(timedOut, /数据包接收超时/)

  const communicationError = controller.startRace()
  await waitForCondition(
    () => transport.sent.filter((packet) => packet[1] === CommandId.StartDetection).length === 2,
    'Second Start command was not sent',
  )
  transport.emit(encodePacket(CommandId.CommandResult, Uint8Array.of(CommandId.StartDetection, 0x0f)))
  await assert.rejects(communicationError, /RFID通信错误/)
})

test('logs every complete valid received protocol packet after BLE reassembly', async () => {
  const { transport, protocolLog } = await fixture()

  transport.emit(Uint8Array.of(0xaa, 0x04))
  assert.deepEqual(protocolLog.snapshot, [])

  transport.emit(Uint8Array.of(
    0x01, 0x01, 0x06, 0xf9,
    0xaa, 0xf0, 0x02, 0x01, 0x00, 0xf3, 0xf9,
  ))
  transport.emit(Uint8Array.of(0xaa, 0x04, 0x01, 0x00, 0x00, 0xf9))

  assert.deepEqual(protocolLog.snapshot.map(({ timestamp, packetHex }) => ({
    timestamp,
    packetHex,
  })), [
    {
      timestamp: '2026-08-27 15:04:05.067',
      packetHex: 'AA F0 02 01 00 F3 F9',
    },
    {
      timestamp: '2026-08-27 15:04:05.067',
      packetHex: 'AA 04 01 01 06 F9',
    },
  ])
})
