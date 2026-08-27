# Local Athlete Catalog and Race Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mini program the only persistent owner of athlete profiles and calculate laps, lap times, ranking, leader, finish behavior, and race reset locally from firmware `0x13` EPC events.

**Architecture:** Add a versioned `AthleteRepository` and serialized `AthleteCatalogService` above a platform storage adapter. Keep persistent athlete profiles separate from per-race scoring state, route the reduced six-command protocol through `RaceController`, and use a pure local race-scoring engine so the finish threshold and lap-zero rules are deterministic and independently testable.

**Tech Stack:** Native WeChat Mini Program, TypeScript 5.9, `wx` local storage, Node.js built-in `node:test`, pnpm.

## Global Constraints

- The firmware owns no athlete IDs, names, EPC bindings, groups, laps, or rankings.
- Firmware commands are exactly `0x01`, `0x02`, `0x03`, `0x04`, `0x13`, and `0xF0` as defined in `LORAProtocol-byte.md`.
- EPC is exactly four bytes, represented locally as eight uppercase hexadecimal characters.
- An athlete has exactly one EPC in this version.
- Athlete IDs are `1-65535`, allocated monotonically, and archived IDs are not reused.
- Athlete names are non-empty after trimming and at most 32 UTF-8 bytes; duplicate names are allowed.
- Active EPC values are unique; archived EPC values do not reserve a binding.
- The active EPC index is persisted in the same catalog snapshot as profiles and `nextId`.
- Unknown, archived, and non-participant EPC events are silently ignored.
- The first valid detection records lap `0` and no lap time.
- Clicking End sends no firmware command and freezes every athlete at the leader's captured `finishLap`.
- Clicking Reset sends `0x02`; local race data is cleared only after `0xF0 [0x02, 0x00]`.
- Scan-add, multiple EPCs, old-firmware list import, corruption recovery UI, import/export, cloud access, and test-only UI are out of scope.
- Do not add runtime dependencies.

---

## File Structure

### New files

- `miniprogram/domain/athlete-profile.ts` — persistent catalog types and validation helpers.
- `miniprogram/domain/local-race-scoring.ts` — pure lap-zero, lap-time, ranking, leader, finishing, and freeze state machine.
- `miniprogram/services/athlete-repository.ts` — versioned catalog snapshot persistence.
- `miniprogram/services/athlete-catalog-service.ts` — serialized athlete CRUD, ID allocation, EPC lookup, archive, and restore rules.
- `miniprogram/platform/wechat-athlete-catalog-storage.ts` — `wx` storage adapter.
- `tests/athlete-repository.test.ts` — catalog load/save and persisted EPC index tests.
- `tests/athlete-catalog-service.test.ts` — validation, allocation, archive, restore, and serialized mutation tests.
- `tests/local-race-scoring.test.ts` — local scoring and finish-threshold tests.

### Existing files to modify

- `.gitignore` — ignore WeChat developer-tool private configuration.
- `tests/run-tests.ts` — register new test files.
- `miniprogram/domain/athlete.ts` — define the page-facing combined profile/race view.
- `miniprogram/domain/race-state.ts` — replace old four-state firmware model with firmware detection state and local race phase controls.
- `miniprogram/protocol/commands.ts` — expose only the reduced six-command protocol.
- `miniprogram/stores/athlete-store.ts` — merge active catalog profiles with local scoring snapshots for UI subscriptions.
- `miniprogram/stores/race-store.ts` — hold connection state, firmware state, local phase, finish lap, and leader presentation.
- `miniprogram/stores/group-store.ts` — remove one archived athlete from every group.
- `miniprogram/services/race-controller.ts` — use catalog lookup and local scoring; remove firmware athlete management and score recovery.
- `miniprogram/services/app-services.ts` — wire repository, catalog service, scoring engine, and controller.
- `miniprogram/pages/athletes/index.ts` — local CRUD, archive view, restore/edit, and management locking.
- `miniprogram/pages/athletes/index.wxml` — remove scan-add; add edit/archive/restore UI and local-storage warning.
- `miniprogram/pages/athletes/index.wxss` — style the archive and edit controls.
- `miniprogram/pages/race/index.ts` — new Start/End/Reset actions and local phase rendering.
- `miniprogram/pages/race/index.wxml` — relabel ranking as locally calculated and bind new controls.
- `tests/group-store.test.ts` — archive member cleanup coverage.
- `tests/race-state.test.ts` — new button-state coverage.
- `tests/race-controller.test.ts` — reduced protocol and EPC integration coverage.
- `README.md`, `docs/HANDOFF.md`, `docs/MIGRATION-ANALYSIS.md` — document the new data ownership and prototype limitations.

---

### Task 1: Establish a Trackable Source Baseline

**Files:**
- Modify: `.gitignore`
- Add to Git: current project source, configuration, protocol, tests, and documentation
- Exclude: `node_modules/`, `build-test/`, `project.private.config.json`

**Interfaces:**
- Consumes: existing untracked mini-program source in the repository root.
- Produces: a reproducible baseline commit on `APP_FullFunction` before feature edits.

- [ ] **Step 1: Protect developer-local files**

Add this exact line to `.gitignore`:

```gitignore
project.private.config.json
```

- [ ] **Step 2: Verify the current baseline before staging**

Run:

```powershell
pnpm test
pnpm run typecheck
git status --short
```

Expected: tests and typecheck pass; `node_modules/`, `build-test/`, and `project.private.config.json` do not appear as staged candidates.

- [ ] **Step 3: Stage only project source**

Run:

```powershell
git add .gitignore LORAProtocol-byte.md README.md docs miniprogram package.json pnpm-lock.yaml project.config.json tests tsconfig.json tsconfig.test.json
git diff --cached --check
```

Expected: no whitespace errors and no local developer configuration in the staged diff.

- [ ] **Step 4: Commit the baseline**

```powershell
git commit -m "chore: import mini program source baseline"
```

---

### Task 2: Add the Versioned Athlete Repository

**Files:**
- Create: `miniprogram/domain/athlete-profile.ts`
- Create: `miniprogram/services/athlete-repository.ts`
- Create: `tests/athlete-repository.test.ts`
- Modify: `tests/run-tests.ts`

**Interfaces:**
- Consumes: `utf8Bytes(value: string): Uint8Array` from `miniprogram/protocol/binary.ts`.
- Produces: `AthleteProfile`, `AthleteCatalog`, `AthleteCatalogStorage`, `AthleteCatalogSyncAdapter`, `emptyAthleteCatalog()`, and `AthleteRepository.load/save`.

- [ ] **Step 1: Write failing repository tests**

Create tests that assert an empty storage loads this exact catalog and that a saved EPC index survives reconstruction:

```ts
assert.deepEqual(repository.load(), {
  schemaVersion: 1,
  revision: 0,
  nextId: 1,
  idReusePolicy: 'never',
  athletes: [],
  activeEpcIndex: {},
})

repository.save({
  schemaVersion: 1,
  revision: 1,
  nextId: 2,
  idReusePolicy: 'never',
  athletes: [{
    id: 1,
    name: '张三',
    epc: '3333F337',
    status: 'active',
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  }],
  activeEpcIndex: { '3333F337': 1 },
})
assert.equal(new AthleteRepository(storage).load().activeEpcIndex['3333F337'], 1)
```

Register `./athlete-repository.test` in `tests/run-tests.ts`.

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm test`

Expected: TypeScript compilation fails because `athlete-profile.ts` and `athlete-repository.ts` do not exist.

- [ ] **Step 3: Define catalog types and repository**

Implement these public types:

```ts
export type AthleteStatus = 'active' | 'archived'
export type AthleteIdReusePolicy = 'never'

export interface AthleteProfile {
  id: number
  name: string
  epc: string
  status: AthleteStatus
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface AthleteCatalog {
  schemaVersion: 1
  revision: number
  nextId: number
  idReusePolicy: AthleteIdReusePolicy
  athletes: AthleteProfile[]
  activeEpcIndex: Record<string, number>
}

export interface AthleteCatalogStorage {
  read(): unknown
  write(value: AthleteCatalog): void
}

export interface AthleteCatalogSyncAdapter {
  pull(): Promise<AthleteCatalog | null>
  push(catalog: AthleteCatalog): Promise<void>
}
```

The sync adapter is an interface only in this version. Do not instantiate it or make network requests. Implement:

```ts
export class AthleteRepository {
  constructor(private readonly storage: AthleteCatalogStorage) {}
  load(): AthleteCatalog
  save(catalog: AthleteCatalog): void
}
```

`load()` returns `emptyAthleteCatalog()` when storage is absent and loads a current-version snapshot otherwise. Clone all profiles and the index on load/save boundaries. Do not add corruption recovery, repair, migration, export, or reset-to-empty behavior in this prototype.

- [ ] **Step 4: Run tests and typecheck**

Run:

```powershell
pnpm test
pnpm run typecheck
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add miniprogram/domain/athlete-profile.ts miniprogram/services/athlete-repository.ts tests/athlete-repository.test.ts tests/run-tests.ts
git commit -m "feat: persist versioned athlete catalog"
```

---

### Task 3: Implement Serialized Local Athlete Management

**Files:**
- Create: `miniprogram/services/athlete-catalog-service.ts`
- Create: `tests/athlete-catalog-service.test.ts`
- Modify: `miniprogram/stores/group-store.ts`
- Modify: `tests/group-store.test.ts`
- Modify: `tests/run-tests.ts`

**Interfaces:**
- Consumes: `AthleteRepository`, `AthleteCatalog`, `AthleteProfile`, `utf8Bytes`, and `GroupStore.removeMember(athleteId)`.
- Produces: `AthleteIdAllocator`, `MonotonicAthleteIdAllocator`, catalog CRUD methods, active/archive snapshots, subscriptions, `lookupActiveByEpc`, and a serialized write queue.

- [ ] **Step 1: Write failing catalog-service tests**

Cover these concrete cases:

```ts
const first = await service.create(' 张三 ', '3333f337')
assert.deepEqual([first.id, first.name, first.epc], [1, '张三', '3333F337'])
const second = await service.create('张三', '01020304')
assert.equal(second.id, 2)

await assert.rejects(() => service.create('', '01020304'), /姓名不能为空/)
await assert.rejects(() => service.create('123456789012345678901234567890123', '01020304'), /32 个 UTF-8 字节/)
await assert.rejects(() => service.create('李四', 'XYZ'), /8 位十六进制/)
await assert.rejects(() => service.create('李四', '3333F337'), /EPC 已绑定/)

await service.archive(1)
assert.equal(service.activeSnapshot.length, 1)
assert.equal(service.archivedSnapshot[0]!.id, 1)
assert.equal(service.lookupActiveByEpc('3333f337'), null)

const replacement = await service.create('王五', '3333F337')
await assert.rejects(() => service.restore(1), /EPC 已绑定/)
await service.update(1, '张三', 'AABBCCDD')
await service.restore(1)
assert.equal(service.lookupActiveByEpc('aabbccdd')?.id, 1)
assert.equal(replacement.id, 3)
```

Add a rapid `Promise.all` test proving serialized creates receive different consecutive IDs. Add a group test proving `removeMember(2)` removes athlete 2 from every group without removing other members.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm test`

Expected: compilation fails because `AthleteCatalogService` and `GroupStore.removeMember` do not exist.

- [ ] **Step 3: Implement the catalog service**

Define the ID strategy boundary and the only first-stage implementation:

```ts
export interface AthleteIdAllocator {
  allocate(catalog: AthleteCatalog): number
}

export class MonotonicAthleteIdAllocator implements AthleteIdAllocator {
  allocate(catalog: AthleteCatalog): number {
    if (catalog.nextId > 65535) throw new Error('运动员 ID 已耗尽')
    return catalog.nextId
  }
}
```

Expose this API:

```ts
export class AthleteCatalogService {
  constructor(
    repository: AthleteRepository,
    options?: {
      now?: () => number
      onArchived?: (athleteId: number) => void
      idAllocator?: AthleteIdAllocator
    },
  )

  get activeSnapshot(): AthleteProfile[]
  get archivedSnapshot(): AthleteProfile[]
  get catalogSnapshot(): AthleteCatalog
  lookupActiveByEpc(epc: string): AthleteProfile | null
  create(name: string, epc: string): Promise<AthleteProfile>
  update(id: number, name: string, epc: string): Promise<AthleteProfile>
  archive(id: number): Promise<void>
  restore(id: number): Promise<AthleteProfile>
  subscribe(listener: (active: AthleteProfile[], archived: AthleteProfile[]) => void): () => void
}
```

Use one promise tail for all mutations:

```ts
private writeQueue: Promise<void> = Promise.resolve()

private enqueue<T>(operation: () => T): Promise<T> {
  const result = this.writeQueue.then(operation)
  this.writeQueue = result.then(() => undefined, () => undefined)
  return result
}
```

For each mutation, clone the catalog, apply and validate the change, rebuild `activeEpcIndex`, increment `revision`, call `repository.save(next)`, then publish the saved snapshot. Add `GroupStore.removeMember(athleteId: number)` and pass it as `onArchived` during application wiring.

- [ ] **Step 4: Run tests and typecheck**

Run:

```powershell
pnpm test
pnpm run typecheck
```

Expected: all tests pass, including concurrent ID allocation and group cleanup.

- [ ] **Step 5: Commit**

```powershell
git add miniprogram/services/athlete-catalog-service.ts miniprogram/stores/group-store.ts tests/athlete-catalog-service.test.ts tests/group-store.test.ts tests/run-tests.ts
git commit -m "feat: manage local athlete profiles"
```

---

### Task 4: Wire WeChat Storage and Replace the Athlete Management Page

**Files:**
- Create: `miniprogram/platform/wechat-athlete-catalog-storage.ts`
- Modify: `miniprogram/services/app-services.ts`
- Modify: `miniprogram/services/race-controller.ts`
- Modify: `miniprogram/pages/athletes/index.ts`
- Modify: `miniprogram/pages/athletes/index.wxml`
- Modify: `miniprogram/pages/athletes/index.wxss`

**Interfaces:**
- Consumes: `AthleteCatalogService` from Task 3 and the current legacy race state.
- Produces: persistent local CRUD UI, archive list, edit/restore actions, and no scan-add command.

- [ ] **Step 1: Add the platform adapter**

Implement exactly one storage key:

```ts
const STORAGE_KEY = 'timer_count_athlete_catalog_v1'

export class WechatAthleteCatalogStorage implements AthleteCatalogStorage {
  read(): unknown { return wx.getStorageSync(STORAGE_KEY) }
  write(value: AthleteCatalog): void { wx.setStorageSync(STORAGE_KEY, value) }
}
```

Instantiate `AthleteRepository` and `AthleteCatalogService` in `app-services.ts`, with `onArchived: (id) => groupStore.removeMember(id)`.

- [ ] **Step 2: Replace device-backed athlete actions**

Update the page to call:

```ts
await athleteCatalog.create(formName, formEpc)
await athleteCatalog.update(editingId, formName, formEpc)
await athleteCatalog.archive(id)
await athleteCatalog.restore(id)
```

Subscribe to both active and archived snapshots. Remove `raceController.addAthlete`, `scanAddAthlete`, and `deleteAthlete` calls from the page.

Add a temporary read-only `RaceController.canManageAthletes` getter for this checkpoint. It returns `false` for legacy `WaitingAthlete`, `Running`, and `LeaderFinished`, and `true` otherwise. Task 6 replaces its implementation with the final local-phase rule.

- [ ] **Step 3: Implement the confirmed UI**

Make these visible changes:

- keep manual name and EPC input;
- remove the “扫描添加” button;
- rename “删除” to “归档”;
- add “编辑” beside each active athlete;
- add a “查看归档” toggle;
- show archived rows with “编辑”和“恢复” actions;
- display ID, name, and EPC for both lists;
- display this exact warning:

```text
运动员名单保存在本机。清理微信存储、删除小程序数据或更换手机可能导致名单丢失。
```

Disable create/edit/archive/restore while `canManageAthletes` is false or a catalog mutation is busy. Group management continues using active profiles only.

- [ ] **Step 4: Verify page compilation**

Run:

```powershell
pnpm test
pnpm run typecheck
```

Expected: all tests and typecheck pass; `rg -n "scanAddAthlete|addByScan|扫描添加" miniprogram/pages/athletes` returns no matches.

- [ ] **Step 5: Commit**

```powershell
git add miniprogram/platform/wechat-athlete-catalog-storage.ts miniprogram/services/app-services.ts miniprogram/services/race-controller.ts miniprogram/pages/athletes
git commit -m "feat: manage athlete catalog on device"
```

---

### Task 5: Implement the Pure Local Race-Scoring Engine

**Files:**
- Create: `miniprogram/domain/local-race-scoring.ts`
- Create: `tests/local-race-scoring.test.ts`
- Modify: `tests/run-tests.ts`

**Interfaces:**
- Consumes: participant athlete IDs and decoded `{ athleteId, totalCentiseconds }` events.
- Produces: `LocalRaceScoring`, `LocalRacePhase`, `LocalAthleteScore`, leader, finish lap, and immutable snapshots.

- [ ] **Step 1: Write failing lap-zero and ranking tests**

Use this API in tests:

```ts
const scoring = new LocalRaceScoring()
scoring.start([1, 2, 3])

scoring.recordDetection(1, 100)
assert.deepEqual(scoring.getScore(1), {
  athleteId: 1,
  lapCount: 0,
  lapCentiseconds: null,
  totalCentiseconds: 100,
  currentRank: 1,
  previousRank: 0,
  finished: false,
})

scoring.recordDetection(1, 5100)
assert.equal(scoring.getScore(1)?.lapCount, 1)
assert.equal(scoring.getScore(1)?.lapCentiseconds, 5000)
```

Add tests proving:

- an equal or smaller total is ignored;
- unknown participant IDs are ignored;
- no-detection participants are unranked;
- ranking is lap descending, total ascending, then ID ascending;
- rank values remain continuous after every event;
- the leader is rank 1.

- [ ] **Step 2: Write failing finish tests**

Cover this sequence:

```ts
scoring.start([1, 2])
scoring.recordDetection(1, 100)  // athlete 1 lap 0
scoring.recordDetection(1, 5100) // athlete 1 lap 1
scoring.recordDetection(2, 200)  // athlete 2 lap 0
assert.equal(scoring.beginFinishing(), 1)
assert.equal(scoring.phase, 'finishing')
assert.equal(scoring.getScore(1)?.finished, true)

scoring.recordDetection(1, 10100) // ignored; never reaches lap 2
scoring.recordDetection(2, 5300)  // reaches lap 1 and freezes
assert.equal(scoring.getScore(1)?.lapCount, 1)
assert.equal(scoring.getScore(2)?.lapCount, 1)
assert.equal(scoring.phase, 'finished')
```

Also assert `beginFinishing()` throws `尚无有效运动员通过，无法结束` before a leader exists and `reset()` clears participants, leader, finish lap, and scores.

- [ ] **Step 3: Run tests and verify RED**

Run: `pnpm test`

Expected: compilation fails because `LocalRaceScoring` does not exist.

- [ ] **Step 4: Implement the engine**

Expose:

```ts
export type LocalRacePhase = 'idle' | 'running' | 'finishing' | 'finished'

export interface LocalAthleteScore {
  athleteId: number
  lapCount: number
  lapCentiseconds: number | null
  totalCentiseconds: number
  currentRank: number
  previousRank: number
  finished: boolean
}

export class LocalRaceScoring {
  get phase(): LocalRacePhase
  get finishLap(): number | null
  get leaderAthleteId(): number | null
  get snapshot(): LocalAthleteScore[]
  start(participantIds: number[]): void
  recordDetection(athleteId: number, totalCentiseconds: number): LocalAthleteScore | null
  beginFinishing(): number
  getScore(athleteId: number): LocalAthleteScore | null
  reset(): void
}
```

When ranking changes, copy each existing `currentRank` to `previousRank` before recalculating. Do not create scores for athletes until their first valid detection. During finishing, mark athletes already at `finishLap` as finished immediately; after an accepted event reaches `finishLap`, freeze that athlete and transition to `finished` only when every locked participant has a finished score.

- [ ] **Step 5: Run tests and typecheck**

Run:

```powershell
pnpm test
pnpm run typecheck
```

Expected: all scoring tests pass.

- [ ] **Step 6: Commit**

```powershell
git add miniprogram/domain/local-race-scoring.ts tests/local-race-scoring.test.ts tests/run-tests.ts
git commit -m "feat: calculate race results from EPC events"
```

---

### Task 6: Replace the Legacy Protocol and Integrate Local Scoring

**Files:**
- Modify: `miniprogram/protocol/commands.ts`
- Modify: `miniprogram/domain/race-state.ts`
- Modify: `miniprogram/domain/athlete.ts`
- Modify: `miniprogram/stores/athlete-store.ts`
- Modify: `miniprogram/stores/race-store.ts`
- Modify: `miniprogram/services/race-controller.ts`
- Modify: `miniprogram/services/app-services.ts`
- Modify: `tests/race-state.test.ts`
- Modify: `tests/race-controller.test.ts`

**Interfaces:**
- Consumes: packet codec, reduced protocol document, `AthleteCatalogService`, `LocalRaceScoring`, `GroupStore`, and `ScoreRepository`.
- Produces: reduced `CommandId`, firmware detection state, local control state, application-facing controller API, and merged athlete views used by all pages.

- [ ] **Step 1: Replace command IDs**

Define only:

```ts
export enum CommandId {
  StartDetection = 0x01,
  StopDetection = 0x02,
  GetRaceState = 0x03,
  RaceState = 0x04,
  EpcDetected = 0x13,
  CommandResult = 0xf0,
}
```

- [ ] **Step 2: Write the new race-control state tests**

Define:

```ts
export enum FirmwareDetectionState {
  Unknown = -1,
  Stopped = 0x00,
  Detecting = 0x01,
}
```

Update `RaceControlsState` so the primary label is `'开始' | '结束'`. Assert:

- disconnected: both buttons disabled;
- connected + idle + firmware stopped: Start enabled, Reset disabled;
- connected + running + firmware detecting: End and Reset enabled;
- connected + finishing/finished + firmware detecting: primary disabled, Reset enabled;
- firmware detecting with local phase idle after process restart: Start disabled, Reset enabled.

- [ ] **Step 3: Rewrite controller tests to the new contract and verify RED**

Replace legacy expectations with these exact packet relationships:

```ts
await controller.connect()
assert.deepEqual(transport.sent.map((packet) => packet[1]), [CommandId.GetRaceState])

const started = controller.startRace()
assert.equal(transport.sent.at(-1)?.[1], CommandId.StartDetection)
transport.emit(encodePacket(CommandId.CommandResult, Uint8Array.of(CommandId.StartDetection, 0x00)))
await started

controller.endRace()
assert.equal(transport.sent.at(-1)?.[1], CommandId.StartDetection) // End sends nothing new

const reset = controller.resetRace()
assert.equal(transport.sent.at(-1)?.[1], CommandId.StopDetection)
transport.emit(encodePacket(CommandId.CommandResult, Uint8Array.of(CommandId.StopDetection, 0x00)))
await reset
```

Add expectations for `0x04` state parsing and non-zero `0xF0` rejection. Run `pnpm test`; expected controller tests fail against the legacy implementation.

- [ ] **Step 4: Define the controller API**

Implement or retain these public members:

```ts
connect(): Promise<void>
requestLiveState(): Promise<void>
startRace(): Promise<void>
endRace(): void
resetRace(): Promise<void>
selectGroup(id: string | null): void
get canManageAthletes(): boolean
get athletesSnapshot(): Athlete[]
subscribe(listener: (snapshot: RaceSnapshot) => void): () => void
subscribeAthletes(listener: (athletes: Athlete[]) => void): () => void
```

Remove `addAthlete`, `scanAddAthlete`, `deleteAthlete`, firmware list transfer, historical firmware score recovery, leader query, and all associated pending-command state.

Replace `RaceSnapshot` with this exact page-facing state:

```ts
export interface RaceSnapshot {
  connectionState: ConnectionState
  firmwareState: FirmwareDetectionState
  localPhase: LocalRacePhase
  finishLap: number | null
  leaderAthleteId: number | null
  leaderLapCount: number | null
  leaderLapCentiseconds: number | null
}
```

- [ ] **Step 5: Implement command acknowledgement handling**

Maintain one pending control command containing the original command ID, resolve/reject callbacks, and a 10-second timeout. Rules:

- `startRace()` validates a non-empty locked participant snapshot, sends empty-payload `0x01`, and changes local state only after matching success `0xF0`;
- `endRace()` calls `LocalRaceScoring.beginFinishing()` and sends nothing;
- `resetRace()` sends empty-payload `0x02` and clears local state only after matching success `0xF0`;
- `requestLiveState()` sends empty-payload `0x03`;
- `0x04` maps byte `0x00/0x01` to stopped/detecting;
- a non-zero `0xF0` rejects with the protocol status message and preserves local race data.

Map `0xF0` status codes to these messages:

```text
0x01 Payload长度错误
0x02 未知命令
0x03 RFID未初始化
0x04 RFID启动失败
0x05 RFID停止失败
0x06 EPC格式错误
0x07 RFID接收队列溢出
0x08 EPC去重表已满
0x09 LoRa发送失败
0x0A 当前状态不允许执行
0x0B 数据包校验和错误
0x0C 数据包尾错误
0x0D Payload长度超过上限
```

Unknown values use `设备返回错误状态 0xNN` with two uppercase hexadecimal digits.

On successful Start call `scoreRepository.beginRace()`. When scoring first transitions to `finished`, call `scoreRepository.finishRace()` once. A successful Reset also calls `finishRace()` before clearing the session so an intentionally shortened prototype race keeps its already recorded history.

- [ ] **Step 6: Route `0x13` through the persistent EPC index**

For a seven-byte payload:

```ts
const epc = bytesToHex(payload.slice(0, 4))
const totalCentiseconds = readUint24BE(payload, 4)
const profile = athleteCatalog.lookupActiveByEpc(epc)
if (!profile || !lockedParticipantIds.has(profile.id)) return
const score = scoring.recordDetection(profile.id, totalCentiseconds)
if (!score) return
```

After an accepted score, rebuild the page-facing athlete snapshot, update race leader/phase/finish lap, and append a `ScoreRepository` entry using the profile's current name and EPC as an immutable history snapshot.

- [ ] **Step 7: Merge catalog profiles with race scores**

Keep `Athlete` as the UI-facing shape, but source identity fields from `AthleteProfile` and race fields from `LocalAthleteScore`. Use these empty-race defaults:

```ts
lapCount: -1
lapCentiseconds: -1
totalCentiseconds: -1
previousRank: 0
currentRank: 0
hasRaceScore: false
finished: false
```

Map `null` lap time from the scoring engine to `-1` at the existing page boundary. Notify athlete subscribers after catalog changes, accepted EPC events, End freezing, and Reset.

- [ ] **Step 8: Add integration edge-case tests**

Add tests proving:

- unknown EPC produces no score;
- archived EPC produces no score;
- an active athlete outside the locked group produces no score;
- first EPC event creates lap 0 with no lap time;
- second EPC event calculates the time difference;
- End emits no packet and freezes at the captured leader lap;
- Reset failure preserves scores and local phase;
- Reset success clears scores and unlocks catalog/group management;
- app initialization with firmware detecting and local phase idle blocks Start and allows Reset.

- [ ] **Step 9: Run the full suite and typecheck**

Run:

```powershell
pnpm test
pnpm run typecheck
```

Expected: all tests pass.

- [ ] **Step 10: Commit the protocol and integration change**

```powershell
git add miniprogram/protocol/commands.ts miniprogram/domain/race-state.ts miniprogram/domain/athlete.ts miniprogram/stores/athlete-store.ts miniprogram/stores/race-store.ts miniprogram/services/race-controller.ts miniprogram/services/app-services.ts tests/race-state.test.ts tests/race-controller.test.ts
git commit -m "feat: drive local races from EPC detections"
```

---

### Task 7: Update Race Controls and Presentation

**Files:**
- Modify: `miniprogram/pages/race/index.ts`
- Modify: `miniprogram/pages/race/index.wxml`
- Modify: `miniprogram/pages/race/index.wxss`
- Modify: `miniprogram/pages/ranking/index.ts`
- Modify: `miniprogram/pages/athletes/index.ts`

**Interfaces:**
- Consumes: `RaceController.startRace/endRace/resetRace`, `RaceSnapshot.localPhase`, `finishLap`, and merged athlete snapshots.
- Produces: confirmed Start/End/Reset UX and local ranking presentation.

- [ ] **Step 1: Change the primary button action**

Use local phase, not firmware state, to choose behavior:

```ts
if (raceController.snapshot.localPhase === 'idle') {
  await raceController.startRace()
} else if (raceController.snapshot.localPhase === 'running') {
  raceController.endRace()
}
```

The reset button always calls `await raceController.resetRace()` when enabled.

- [ ] **Step 2: Render the four local phases**

Use these exact labels:

```text
idle       -> 比赛未开始
running    -> 比赛进行中
finishing  -> 等待其他运动员完成
finished   -> 比赛已结束
```

When firmware is detecting while local phase is idle, show `设备仍在检测，请重置后重新开始`. Show `结束圈数：N` during finishing and finished phases.

- [ ] **Step 3: Update local ranking copy and lap-zero display**

- change `设备实时排名` to `小程序实时排名`;
- show lap `0` as `0 圈`;
- show the first detection's lap time as `—`;
- continue using relative total-time presentation where applicable;
- show a visual completion marker for athletes whose score is frozen.

- [ ] **Step 4: Enforce management locks across pages**

Disable group selection and athlete/group mutations whenever local phase is `running`, `finishing`, or `finished`. Do not unlock when End is clicked; unlock only after successful Reset.

- [ ] **Step 5: Compile and inspect**

Run:

```powershell
pnpm test
pnpm run typecheck
rg -n "设备实时排名|stopRace|RaceState\.WaitingAthlete|RaceState\.LeaderFinished" miniprogram
```

Expected: tests/typecheck pass and the legacy UI/state symbols return no matches.

- [ ] **Step 6: Commit**

```powershell
git add miniprogram/pages/race miniprogram/pages/ranking/index.ts miniprogram/pages/athletes/index.ts
git commit -m "feat: add local race finish controls"
```

---

### Task 8: Update Documentation and Perform Prototype Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/HANDOFF.md`
- Modify: `docs/MIGRATION-ANALYSIS.md`
- Reference: `LORAProtocol-byte.md`

**Interfaces:**
- Consumes: completed implementation and confirmed protocol.
- Produces: accurate developer handoff and reproducible verification evidence.

- [ ] **Step 1: Update ownership and limitations**

Document these exact facts:

- athlete profiles and EPC index live only in WeChat local storage;
- clearing local data or changing phones can lose the catalog;
- scan-add is unavailable;
- first valid detection is lap 0;
- End is local-only and captures the leader lap;
- Reset sends `0x02` and clears local race state after success;
- missed EPC events during disconnect cannot be recovered;
- a restarted app seeing firmware `detecting` requires Reset.

- [ ] **Step 2: Run final automated verification**

Run:

```powershell
pnpm test
pnpm run typecheck
git diff --check
git status --short
```

Expected: tests and typecheck pass; no whitespace errors; only intentional documentation changes remain.

- [ ] **Step 3: Run the WeChat prototype checklist**

In WeChat Developer Tools and on a real phone, verify:

1. create two athletes, restart the mini program, and confirm IDs, names, EPC values, and the EPC index survive;
2. archive one athlete, reuse its EPC for a new athlete, and confirm restoring the archived athlete is blocked until its EPC changes;
3. start a race and confirm `0x01` is sent with an empty payload;
4. inject or receive a bound `0x13` and confirm the first detection displays lap 0 and no lap time;
5. receive a second detection and confirm lap 1 plus the total-time difference;
6. click End and confirm no BLE packet is sent;
7. let a trailing athlete reach `finishLap` and confirm no athlete advances to `finishLap + 1`;
8. click Reset and confirm `0x02` is sent and local data clears only after success;
9. send an unbound EPC and confirm the UI and saved scores remain unchanged.

- [ ] **Step 4: Commit documentation**

```powershell
git add README.md docs/HANDOFF.md docs/MIGRATION-ANALYSIS.md
git commit -m "docs: describe local athlete race workflow"
```

- [ ] **Step 5: Review branch history**

Run:

```powershell
git log --oneline --decorate -12
git status --short --branch
```

Expected: focused commits for baseline, catalog persistence, athlete management, scoring, protocol integration, UI, and documentation; working tree clean except explicitly retained local files.
