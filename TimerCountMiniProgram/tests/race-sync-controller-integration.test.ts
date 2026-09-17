import assert from 'node:assert/strict'
import test from 'node:test'

import type { AthleteCatalog, AthleteCatalogStorage } from '../miniprogram/domain/athlete-profile'
import { FirmwareDetectionState } from '../miniprogram/domain/race-state'
import { CommandId } from '../miniprogram/protocol/commands'
import { encodePacket } from '../miniprogram/protocol/lora-packet-codec'
import { ActiveRaceSessionRepository, type ActiveRaceSessionStorage } from '../miniprogram/services/active-race-session-repository'
import { AthleteCatalogService } from '../miniprogram/services/athlete-catalog-service'
import { AthleteRepository } from '../miniprogram/services/athlete-repository'
import { RaceController, type RaceTransport } from '../miniprogram/services/race-controller'
import { RaceSyncService } from '../miniprogram/services/race-sync-service'
import { RaceOutboxRepository } from '../miniprogram/services/race-outbox-repository'
import { RaceSyncScheduler } from '../miniprogram/services/backend-sync/race-sync-scheduler'
import type { ApiResult, BackendClient } from '../miniprogram/services/backend-api/request'
import { ScoreRepository, type ScoreStorage } from '../miniprogram/services/score-repository'
import { GroupStore, type GroupStorage } from '../miniprogram/stores/group-store'

class Transport implements RaceTransport {
  readonly sent: Uint8Array[] = []
  private listener: ((value: Uint8Array) => void) | null = null
  async connect(): Promise<void> {}
  async send(packet: Uint8Array): Promise<void> { this.sent.push(packet) }
  onData(listener: (value: Uint8Array) => void): () => void { this.listener = listener; return () => { this.listener = null } }
  onDisconnect(): () => void { return () => undefined }
  emit(packet: Uint8Array): void { this.listener?.(packet) }
}
class CatalogStorage implements AthleteCatalogStorage {
  value: unknown = null
  read(): unknown { return this.value }
  write(value: AthleteCatalog): void { this.value = value }
}
class Storage implements ScoreStorage, GroupStorage, ActiveRaceSessionStorage {
  value: unknown = null
  read(): unknown { return this.value }
  write(value: unknown): void { this.value = structuredClone(value) }
  remove(): void { this.value = null }
}

class LifecycleSpy {
  begins = 0
  scores: Array<{ historical: boolean }> = []
  finishes = 0
  begin() {
    this.begins += 1
    // begin 是同步持久化边界；网络任务在调度器中异步处理。
    return { localId: 'race-local-1', clientRaceKey: 'race:race-local-1', raceId: null, syncState: 'pending' as const }
  }
  recordScore(_localId: string, _score: unknown, historical: boolean): null {
    this.scores.push({ historical })
    return null
  }
  finish(): void { this.finishes += 1 }
}

async function fixture() {
  const transport = new Transport()
  const catalog = new AthleteCatalogService(new AthleteRepository(new CatalogStorage()))
  await catalog.create('张三', '01020304')
  const storage = new Storage()
  const sessions = new ActiveRaceSessionRepository(storage)
  const lifecycle = new LifecycleSpy()
  const controller = new RaceController(
    transport,
    catalog,
    new ScoreRepository(new Storage()),
    new GroupStore(new Storage()),
    sessions,
    undefined,
    lifecycle as unknown as RaceSyncService,
  )
  return { transport, sessions, lifecycle, controller }
}

async function start(controller: RaceController, transport: Transport): Promise<void> {
  transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Stopped)))
  const pending = controller.startRace()
  await Promise.resolve()
  transport.emit(encodePacket(CommandId.CommandResult, Uint8Array.of(CommandId.StartDetection, 0x00)))
  await pending
}

function athleteInfo(lap: number, total: number, single = 0): Uint8Array {
  return encodePacket(CommandId.AthleteInfo, Uint8Array.of(
    0, 1, lap,
    (single >>> 16) & 0xff, (single >>> 8) & 0xff, single & 0xff,
    (total >>> 16) & 0xff, (total >>> 8) & 0xff, total & 0xff,
  ))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (condition()) return
    await new Promise<void>((done) => setImmediate(done))
  }
  assert.fail(message)
}

test('Start ACK persists lifecycle identity and enters running without waiting for network', async () => {
  const { controller, transport, sessions, lifecycle } = await fixture()
  await start(controller, transport)

  assert.equal(lifecycle.begins, 1)
  assert.equal(controller.snapshot.localPhase, 'running')
  assert.deepEqual(sessions.load()?.raceIdentity, {
    localId: 'race-local-1', clientRaceKey: 'race:race-local-1', raceId: null, syncState: 'pending',
  })
})

test('Start ACK enters running while the real lifecycle scheduler request is still pending', async () => {
  const transport = new Transport()
  const catalog = new AthleteCatalogService(new AthleteRepository(new CatalogStorage()))
  await catalog.create('张三', '01020304')
  const scoreRepository = new ScoreRepository(new Storage(), () => 1000)
  const outbox = new RaceOutboxRepository(new Storage(), () => 1000)
  const sessions = new ActiveRaceSessionRepository(new Storage())
  const pending = deferred<ApiResult<unknown>>()
  let requested = false
  let service!: RaceSyncService
  const scheduler = new RaceSyncScheduler({
    outbox,
    now: () => 1000,
    delay: () => null,
    clearDelay: () => undefined,
    execute: (task) => service.execute(task),
  })
  service = new RaceSyncService({
    scoreRepository,
    outbox,
    scheduler,
    client: {} as BackendClient,
    clubId: 1,
    request: () => { requested = true; return pending.promise },
  })
  const controller = new RaceController(transport, catalog, scoreRepository, new GroupStore(new Storage()), sessions, undefined, service)

  await start(controller, transport)
  assert.equal(controller.snapshot.localPhase, 'running')
  const localId = sessions.load()!.raceIdentity!.localId
  assert.equal(scoreRepository.getWorkingCopy(localId)?.syncState, 'pending')
  await waitFor(() => requested, 'scheduler did not start create request')
  pending.resolve({ ok: false, kind: 'network', message: 'bridge timeout' })
  await waitFor(() => scoreRepository.getWorkingCopy(localId)?.syncState === 'offline', 'failed request did not update local state')
  scheduler.terminate()
})

test('only live scores and one completed finish are sent to the lifecycle service', async () => {
  const { controller, transport, lifecycle } = await fixture()
  await start(controller, transport)
  transport.emit(athleteInfo(0, 100))
  transport.emit(encodePacket(CommandId.AthleteTransferState, Uint8Array.of(0x01)))
  transport.emit(athleteInfo(1, 5100, 5000))
  transport.emit(encodePacket(CommandId.AthleteTransferState, Uint8Array.of(0x00)))

  controller.endRace()

  assert.deepEqual(lifecycle.scores.map((call) => call.historical), [false])
  assert.equal(lifecycle.finishes, 1)
})

test('Reset ACK completes the backend race lifecycle', async () => {
  const { controller, transport, lifecycle } = await fixture()
  await start(controller, transport)

  const reset = controller.resetRace()
  await Promise.resolve()
  transport.emit(encodePacket(CommandId.CommandResult, Uint8Array.of(CommandId.StopDetection, 0x00)))
  await reset

  assert.equal(lifecycle.finishes, 1)
})
