import assert from 'node:assert/strict'
import test from 'node:test'

import type { AthleteCatalog, AthleteCatalogStorage } from '../miniprogram/domain/athlete-profile'
import { ConnectionState, FirmwareDetectionState } from '../miniprogram/domain/race-state'
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

class MemoryRaceTransport implements RaceTransport {
  readonly sent: Uint8Array[] = []
  failNextCommandId: CommandId | null = null
  private dataListener: ((value: Uint8Array) => void) | null = null

  async connect(): Promise<void> {}
  async send(packet: Uint8Array): Promise<void> {
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
  emit(value: Uint8Array): void { this.dataListener?.(value) }
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
  const controller = new RaceController(
    transport,
    catalog,
    scoreRepository,
    groupStore,
    activeSessionRepository,
  )
  return {
    transport,
    catalog,
    scoreRepository,
    groupStore,
    activeSessionRepository,
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
): Uint8Array {
  return encodePacket(CommandId.AthleteInfo, Uint8Array.of(
    (athleteId >> 8) & 0xff,
    athleteId & 0xff,
    lapCount,
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

test('uses firmware lap count and calculates adjacent lap time from 0x12', async () => {
  const { controller, transport } = await fixture()
  await startRace(controller, transport)

  transport.emit(athleteInfoEvent(1, 0, 100))
  let athlete = controller.athletesSnapshot[0]!
  assert.equal(athlete.lapCount, 0)
  assert.equal(athlete.lapCentiseconds, -1)
  assert.equal(athlete.currentRank, 1)

  transport.emit(athleteInfoEvent(1, 1, 5100))
  athlete = controller.athletesSnapshot[0]!
  assert.equal(athlete.lapCount, 1)
  assert.equal(athlete.lapCentiseconds, 5000)
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
  transport.emit(athleteInfoEvent(1, 1, 5100))
  transport.emit(encodePacket(CommandId.AthleteTransferState, Uint8Array.of(0x00)))
  transport.emit(athleteInfoEvent(1, 2, 10100))

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
