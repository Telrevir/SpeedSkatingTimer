# Athlete Sync Protocol Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old EPC-driven local lap calculation with the finalized `0x10`–`0x14` athlete synchronization protocol, recover active race scope across mini-program restarts, and refresh firmware state whenever a connected mini program enters the foreground.

**Architecture:** Keep byte layouts in a focused protocol codec, authoritative score rules in `LocalRaceScoring`, and active-session persistence in a versioned repository. `RaceController` coordinates three independent flows: foreground state synchronization, serialized `0x10/0xF0` EPC definitions, and ordinary `0x12` score ingestion; no flow waits for or filters another flow's `0x12` messages.

**Tech Stack:** WeChat Mini Program TypeScript, Node built-in test runner, strict TypeScript, existing LoRa packet codec and local synchronous WeChat storage adapters.

## Global Constraints

- Switch directly to the new protocol; do not preserve the old `0x13` EPC-plus-time behavior.
- Leave `0x01`, `0x02`, `0x03`, `0x04`, packet framing, checksums, and unaffected protocol behavior unchanged.
- Send `0x11` only after a matching `0x04` reports `0x01` Detecting.
- Treat every valid `0x12` identically regardless of `0x10` success/failure or `0x13` transfer state.
- Use firmware-provided lap count and total centiseconds; the mini program must not increment laps locally.
- Limit each race to 50 athletes and 50 successfully defined non-athlete EPC values.
- Persist participant IDs, active group ID, and the two successful-definition counters; do not persist EPC sets or live scores in the active-session record.
- Add no production API whose only purpose is testing.
- Preserve the user's uncommitted `LORAProtocol-byte.md` changes; every commit in this plan must stage explicit implementation files only.

## File Map

- Create `miniprogram/protocol/athlete-sync-codec.ts`: exact `0x10`, `0x12`, `0x13`, and `0x14` Payload conversion.
- Create `miniprogram/domain/active-race-session.ts`: persisted active-session schema and validation types.
- Create `miniprogram/services/active-race-session-repository.ts`: load, save, count update, and clear operations.
- Create `miniprogram/platform/wechat-active-race-session-storage.ts`: WeChat storage adapter.
- Create `miniprogram/services/epc-definition-queue.ts`: serialized `0x10` work and capacity bookkeeping.
- Modify `miniprogram/domain/local-race-scoring.ts`: accept authoritative firmware scores.
- Modify `miniprogram/services/race-controller.ts`: foreground synchronization and new packet routing.
- Modify `miniprogram/stores/race-store.ts`: expose transfer and synchronization state.
- Modify `miniprogram/services/app-services.ts` and `miniprogram/app.ts`: compose persistence and foreground lifecycle.
- Update focused tests and `tests/run-tests.ts`; do not add UI-only test controls.

---

### Task 1: Implement the finalized athlete protocol codec

**Files:**
- Create: `miniprogram/protocol/athlete-sync-codec.ts`
- Modify: `miniprogram/protocol/commands.ts`
- Modify: `miniprogram/protocol/binary.ts`
- Create: `tests/athlete-sync-codec.test.ts`
- Modify: `tests/binary.test.ts`
- Modify: `tests/run-tests.ts`

**Interfaces:**
- Consumes: `bytesToHex`, `readUint16BE`, `readUint24BE` from `miniprogram/protocol/binary.ts`.
- Produces: `encodeAthleteDefinition(definition): Uint8Array`, `decodeFirmwareAthleteScore(payload): FirmwareAthleteScore | null`, `decodeAthleteTransferState(payload): AthleteTransferState | null`, and `decodeOrdinaryEpc(payload): string | null`.

- [ ] **Step 1: Write failing protocol-vector tests**

Add tests that specify the exact wire contract:

```ts
test('encodes athlete and non-athlete 0x10 payloads', () => {
  assert.deepEqual(
    [...encodeAthleteDefinition({ isAthlete: true, epc: '3333F337', athleteId: 1 })],
    [0x01, 0x33, 0x33, 0xf3, 0x37, 0x00, 0x01],
  )
  assert.deepEqual(
    [...encodeAthleteDefinition({ isAthlete: false, epc: 'AABBCCDD', athleteId: null })],
    [0x00, 0xaa, 0xbb, 0xcc, 0xdd, 0x00, 0x00],
  )
})

test('decodes 0x12, 0x13 and 0x14 payloads', () => {
  assert.deepEqual(
    decodeFirmwareAthleteScore(Uint8Array.of(0x00, 0x01, 0x02, 0x01, 0x02, 0x03)),
    { athleteId: 1, lapCount: 2, totalCentiseconds: 0x010203 },
  )
  assert.equal(decodeAthleteTransferState(Uint8Array.of(0x01)), 'receiving')
  assert.equal(decodeAthleteTransferState(Uint8Array.of(0x00)), 'idle')
  assert.equal(decodeOrdinaryEpc(Uint8Array.of(0x33, 0x33, 0xf3, 0x37)), '3333F337')
})
```

Also assert rejection of invalid EPC text, IDs outside `1..65535` for athletes, wrong Payload lengths, athlete ID zero in `0x12`, and unknown `0x13` values.

- [ ] **Step 2: Run the test suite and verify the new tests fail because the codec and command IDs do not exist**

Run: `pnpm test`

Expected: TypeScript compilation fails on missing athlete codec exports or missing new `CommandId` members.

- [ ] **Step 3: Implement command IDs and exact byte conversion**

Replace the old EPC command with:

```ts
export enum CommandId {
  StartDetection = 0x01,
  StopDetection = 0x02,
  GetRaceState = 0x03,
  RaceState = 0x04,
  DefineEpc = 0x10,
  GetAllAthletes = 0x11,
  AthleteInfo = 0x12,
  // Intermediate compile alias; Task 6 removes this member with the old handler and tests.
  EpcDetected = 0x13,
  AthleteTransferState = 0x13,
  OrdinaryEpcDetected = 0x14,
  CommandResult = 0xf0,
}
```

Add reusable `hexToBytes` and `writeUint16BE` helpers with range checks, then implement the codec with strict lengths and the protocol's big-endian layout. Non-athlete definitions must always write ID bytes `00 00`.

- [ ] **Step 4: Run all tests and type checking**

Run: `pnpm test` and `pnpm run typecheck`

Expected: all existing tests plus the codec vectors pass. The intermediate `EpcDetected` enum alias keeps the untouched controller compiling until Task 6 removes the alias, old handler, and old tests together.

- [ ] **Step 5: Commit the codec with explicit paths**

```powershell
git add miniprogram/protocol/athlete-sync-codec.ts miniprogram/protocol/commands.ts miniprogram/protocol/binary.ts tests/athlete-sync-codec.test.ts tests/binary.test.ts tests/run-tests.ts
git commit -m "feat: add athlete sync protocol codec"
```

---

### Task 2: Persist the active race scope and definition counters

**Files:**
- Create: `miniprogram/domain/active-race-session.ts`
- Create: `miniprogram/services/active-race-session-repository.ts`
- Create: `miniprogram/platform/wechat-active-race-session-storage.ts`
- Create: `tests/active-race-session-repository.test.ts`
- Modify: `tests/run-tests.ts`

**Interfaces:**
- Produces `ActiveRaceSession`, `ActiveRaceSessionStorage`, and `ActiveRaceSessionRepository` with `load()`, `save(session)`, `incrementDefinition(isAthlete)`, and `clear()`.
- Later tasks consume the repository from `RaceController` and `EpcDefinitionQueue`.

- [ ] **Step 1: Write failing repository tests**

Specify the exact persisted value and clone behavior:

```ts
const session: ActiveRaceSession = {
  participantIds: [1, 2],
  activeGroupId: 'group-a',
  athleteDefinitionCount: 0,
  nonAthleteDefinitionCount: 0,
}

repository.save(session)
assert.deepEqual(repository.load(), session)
assert.equal(repository.incrementDefinition(true).athleteDefinitionCount, 1)
assert.equal(repository.incrementDefinition(false).nonAthleteDefinitionCount, 1)
repository.clear()
assert.equal(repository.load(), null)
```

Add validation tests for duplicate/invalid participant IDs, counts outside `0..50`, malformed group IDs, and mutation of returned snapshots.

- [ ] **Step 2: Run tests and verify failure on missing repository types**

Run: `pnpm test`

Expected: TypeScript reports missing active-session modules.

- [ ] **Step 3: Implement versioned storage and deterministic validation**

Persist an envelope under `roller-timer-active-race-session-v1`:

```ts
interface StoredActiveRaceSession extends ActiveRaceSession {
  schemaVersion: 1
}
```

`load()` returns `null` for absent or invalid data. `save()` clones and validates values. `incrementDefinition()` requires an existing session, refuses a count already at 50, saves the incremented snapshot, and returns a clone. `clear()` removes the storage key through the adapter's `remove()` method.

- [ ] **Step 4: Run repository tests, full tests, and type checking**

Run: `pnpm test` and `pnpm run typecheck`

Expected: all tests pass.

- [ ] **Step 5: Commit only the active-session files**

```powershell
git add miniprogram/domain/active-race-session.ts miniprogram/services/active-race-session-repository.ts miniprogram/platform/wechat-active-race-session-storage.ts tests/active-race-session-repository.test.ts tests/run-tests.ts
git commit -m "feat: persist active race session scope"
```

---

### Task 3: Replace local lap increments with authoritative firmware scores

**Files:**
- Modify: `miniprogram/domain/local-race-scoring.ts`
- Modify: `tests/local-race-scoring.test.ts`

**Interfaces:**
- Produces `resume(participantIds: number[]): void` and `applyFirmwareScore(athleteId, lapCount, totalCentiseconds): LocalAthleteScore | null`.
- Removes controller dependence on `recordDetection(epcTotal)`; Task 6 routes decoded `0x12` into `applyFirmwareScore`.

- [ ] **Step 1: Rewrite scoring tests around firmware-provided lap counts**

Use tests such as:

```ts
test('uses firmware lap count without local increment', () => {
  const scoring = new LocalRaceScoring()
  scoring.start([1])
  const first = scoring.applyFirmwareScore(1, 0, 0)
  const second = scoring.applyFirmwareScore(1, 3, 12_000)
  assert.equal(first?.lapCount, 0)
  assert.equal(second?.lapCount, 3)
  assert.equal(second?.lapCentiseconds, null)
})

test('calculates one lap only for adjacent firmware laps', () => {
  const scoring = new LocalRaceScoring()
  scoring.start([1])
  scoring.applyFirmwareScore(1, 0, 100)
  assert.equal(scoring.applyFirmwareScore(1, 1, 5_100)?.lapCentiseconds, 5_000)
})
```

Retain ranking, leader, End, freezing, participant filtering, and reset tests, but drive each update with explicit firmware lap and total values. Add tests that ignore unchanged, regressing, out-of-range, and non-participant values.

- [ ] **Step 2: Run the scoring tests and verify failure because `applyFirmwareScore` is missing**

Run: `pnpm test`

Expected: TypeScript reports the missing method.

- [ ] **Step 3: Implement authoritative score application**

The score entry must use the supplied lap and total:

```ts
const lapCentiseconds = previous && lapCount === previous.lapCount + 1
  ? totalCentiseconds - previous.totalCentiseconds
  : null
```

Reject athlete IDs outside the participant set; lap values outside `0..255`; totals outside `0..0xFFFFFF`; exact duplicates; lap regressions; and time regressions. `resume()` initializes a running participant set only when the current phase is idle, preserving live scores on ordinary foreground resumes.

- [ ] **Step 4: Run full tests and type checking**

Run: `pnpm test` and `pnpm run typecheck`

Expected: scoring tests pass; controller tests remain to be migrated in Task 6 if they still reference `recordDetection` behavior.

- [ ] **Step 5: Commit the scoring change**

```powershell
git add miniprogram/domain/local-race-scoring.ts tests/local-race-scoring.test.ts
git commit -m "feat: apply firmware athlete scores"
```

---

### Task 4: Add foreground state synchronization and cold-session recovery

**Files:**
- Modify: `miniprogram/stores/race-store.ts`
- Modify: `miniprogram/services/race-controller.ts`
- Modify: `tests/race-controller.test.ts`

**Interfaces:**
- Consumes `ActiveRaceSessionRepository` and `LocalRaceScoring.resume()`.
- Produces `RaceController.syncForegroundState(): Promise<void>` and snapshot fields `athleteTransferState` and `syncError`.

- [ ] **Step 1: Add failing controller tests for the `0x03 → 0x04 → optional 0x11` sequence**

Cover all three branches:

```ts
const syncing = controller.syncForegroundState()
await Promise.resolve()
assert.equal(transport.sent.at(-1)?.[1], CommandId.GetRaceState)

transport.emit(encodePacket(CommandId.RaceState, Uint8Array.of(FirmwareDetectionState.Detecting)))
await Promise.resolve()
transport.emit(encodePacket(CommandId.AthleteTransferState, Uint8Array.of(0x01)))
transport.emit(encodePacket(CommandId.AthleteTransferState, Uint8Array.of(0x00)))
await syncing
assert.deepEqual(
  transport.sent.slice(-2).map((packet) => packet[1]),
  [CommandId.GetRaceState, CommandId.GetAllAthletes],
)
```

Add stopped-state expectation `[GetRaceState]`, disconnected expectation `[]`, two concurrent calls returning one wire sequence, and a detecting-state recovery test where a persisted session causes `localPhase === 'running'` with the saved participants and restores the saved active group. Add a missing-session Detecting test that still completes `0x11/0x13` synchronization but leaves the local phase idle.

- [ ] **Step 2: Run tests and verify the foreground synchronization tests fail**

Run: `pnpm test`

Expected: `syncForegroundState` and new snapshot fields are missing.

- [ ] **Step 3: Implement a single pending race-state response and shared foreground Promise**

Create a private pending state response before sending `0x03`, resolve it only from a valid `0x04`, and reject it after 10 seconds. When Detecting, create a second pending list-transfer response before sending `0x11`; mark its start on `0x13 [01]`, resolve only on the following `0x13 [00]`, and reject it after 10 seconds. Neither pending response observes `0x12`. `syncForegroundState()` must:

```ts
if (this.snapshot.connectionState !== ConnectionState.Connected) return
const state = await this.requestFirmwareState()
if (state !== FirmwareDetectionState.Detecting) return
const session = this.activeSessionRepository?.load()
if (session) {
  this.lockedParticipantIds = new Set(session.participantIds)
  this.groupStore?.select(session.activeGroupId)
  this.scoring.resume(session.participantIds)
  this.syncViews()
}
await this.sendCommand(CommandId.GetAllAthletes)
await this.waitForAthleteTransferCompletion()
```

Store any failure message in `RaceStore.syncError`, clear it on successful synchronization, and ensure `connect()` invokes this method after setting Connected instead of sending a bare `0x03`.

- [ ] **Step 4: Run controller tests, all tests, and type checking**

Run: `pnpm test` and `pnpm run typecheck`

Expected: foreground synchronization branches pass, Detecting synchronization remains pending until `0x13 [00]`, and no test-only method is added.

- [ ] **Step 5: Commit foreground synchronization**

```powershell
git add miniprogram/stores/race-store.ts miniprogram/services/race-controller.ts tests/race-controller.test.ts
git commit -m "feat: synchronize firmware state on foreground"
```

---

### Task 5: Serialize `0x10` definitions and enforce firmware capacity

**Files:**
- Create: `miniprogram/services/epc-definition-queue.ts`
- Create: `tests/epc-definition-queue.test.ts`
- Modify: `tests/run-tests.ts`
- Modify: `miniprogram/services/race-controller.ts`
- Modify: `tests/race-controller.test.ts`

**Interfaces:**
- Consumes `ActiveRaceSessionRepository.incrementDefinition()` and an injected production callback `(definition: AthleteClassification) => Promise<void>`.
- Produces `enqueue(definition): Promise<void>` and `clear(): void`; it has no score-related dependency.

- [ ] **Step 1: Write failing queue tests for serialization, counters, duplicates, failures, and limits**

Use a deferred Promise to prove that the second definition is not invoked before the first completes:

```ts
const first = deferred<void>()
const calls: AthleteClassification[] = []
const queue = new EpcDefinitionQueue(repository, async (definition) => {
  calls.push(definition)
  if (calls.length === 1) await first.promise
})

const one = queue.enqueue({ isAthlete: true, epc: '3333F337', athleteId: 1 })
const two = queue.enqueue({ isAthlete: false, epc: 'AABBCCDD', athleteId: null })
await Promise.resolve()
assert.equal(calls.length, 1)
first.resolve()
await Promise.all([one, two])
assert.equal(calls.length, 2)
```

Assert that only successful callbacks increment their category, a rejected callback does not retry or increment, a duplicate pending EPC is ignored, and count 50 rejects before calling the callback.

- [ ] **Step 2: Run tests and verify failure because the queue is missing**

Run: `pnpm test`

Expected: TypeScript cannot resolve `EpcDefinitionQueue`.

- [ ] **Step 3: Implement the queue without any score dependency**

Maintain a Promise tail and a `pendingEpcs` set. Before calling the definition callback, load the active session and check the relevant count. After the callback resolves, call `incrementDefinition(isAthlete)`. In `finally`, remove the EPC from `pendingEpcs`. `clear()` increments a generation number so queued but not started work exits without sending after Reset.

- [ ] **Step 4: Integrate the queue with controller acknowledgements and Start/Reset lifecycle**

Generalize the current `sendControlCommand` into an acknowledged-command helper used by `0x01`, `0x02`, and one serialized `0x10`. The `0x10` callback must encode via `encodeAthleteDefinition` and resolve solely on `0xF0 [0x10, 0x00]`.

On successful Start:

```ts
activeSessionRepository.save({
  participantIds,
  activeGroupId: activeGroup?.id ?? null,
  athleteDefinitionCount: 0,
  nonAthleteDefinitionCount: 0,
})
```

Reject Start when `participantIds.length > 50`. On successful Reset, call `definitionQueue.clear()` and `activeSessionRepository.clear()` in addition to existing score reset behavior.

- [ ] **Step 5: Verify queue and controller lifecycle behavior**

Run: `pnpm test` and `pnpm run typecheck`

Expected: all queue tests pass; controller tests prove session creation on successful Start, no session creation on failed Start, and session deletion only after successful Reset.

- [ ] **Step 6: Commit the independent definition pipeline**

```powershell
git add miniprogram/services/epc-definition-queue.ts tests/epc-definition-queue.test.ts tests/run-tests.ts miniprogram/services/race-controller.ts tests/race-controller.test.ts
git commit -m "feat: serialize EPC definitions"
```

---

### Task 6: Route `0x12`, `0x13`, and `0x14` through independent handlers

**Files:**
- Modify: `miniprogram/services/athlete-catalog-service.ts`
- Modify: `miniprogram/services/race-controller.ts`
- Modify: `tests/athlete-catalog-service.test.ts`
- Modify: `tests/race-controller.test.ts`

**Interfaces:**
- Consumes all Task 1 codec functions, Task 3 `applyFirmwareScore`, and Task 5 definition queue.
- Produces public behavior through existing race and athlete subscriptions only.

- [ ] **Step 1: Add failing integration tests for all new incoming commands**

Add packet helpers using the real codec and assert:

- `0x12` updates by athlete ID with the firmware lap count and total;
- identical `0x12` received inside and outside `receiving` has identical score behavior;
- `0x13 [01]` and `[00]` change `athleteTransferState` and settle only the list-transfer wait; they never change how `0x12` is processed;
- `0x14` for an in-scope athlete enqueues `0x10` athlete with that ID;
- unknown and out-of-group EPC values enqueue `0x10` non-athlete with ID bytes `00 00`;
- archived and missing athlete IDs in `0x12` are ignored;
- `0x10` failure does not block a later `0x12` update.
- Detecting without a persisted active session ignores `0x12`, does not answer `0x14`, and records `缺少本地比赛会话`.

One representative assertion:

```ts
transport.emit(encodePacket(
  CommandId.AthleteInfo,
  Uint8Array.of(0x00, 0x01, 0x03, 0x00, 0x2e, 0xe0),
))
assert.equal(controller.athletesSnapshot[0]?.lapCount, 3)
assert.equal(controller.athletesSnapshot[0]?.totalCentiseconds, 12_000)
```

- [ ] **Step 2: Run tests and verify they fail against the old `EpcDetected` handler**

Run: `pnpm test`

Expected: new packets produce no score or definition output.

- [ ] **Step 3: Add active-ID lookup and split packet routing into focused private handlers**

Add `AthleteCatalogService.lookupActiveById(id): AthleteProfile | null`. In `RaceController.handlePacket`, dispatch exact command IDs and lengths through:

```ts
handleAthleteInfo(payload)
handleAthleteTransferState(payload)
handleOrdinaryEpc(payload)
handleCommandResult(originalCommandId, statusCode)
```

`handleAthleteInfo` decodes, finds an active profile by ID, applies the firmware score, updates views/history, and never reads definition queue state. `handleOrdinaryEpc` decodes, checks the persisted/locked participant scope, builds `AthleteClassification`, and enqueues it; it never changes scores. If firmware is Detecting but no active session exists, both handlers record `缺少本地比赛会话`; `0x12` does not update a score and `0x14` does not enqueue `0x10`.

- [ ] **Step 4: Add new status-code messages and remove old EPC parsing**

Map:

```ts
case 0x0e: return '数据包接收超时'
case 0x0f: return 'RFID通信错误'
```

Remove the intermediate `CommandId.EpcDetected` alias, imports, tests, and code that treat `0x13` as four EPC bytes plus uint24 total time. Remove `recordDetection` usage from the controller.

- [ ] **Step 5: Run full automated verification**

Run: `pnpm test` and `pnpm run typecheck`

Expected: all old unaffected behaviors and all new command routing tests pass.

- [ ] **Step 6: Commit packet routing**

```powershell
git add miniprogram/services/athlete-catalog-service.ts miniprogram/services/race-controller.ts tests/athlete-catalog-service.test.ts tests/race-controller.test.ts
git commit -m "feat: route firmware athlete updates"
```

---

### Task 7: Wire lifecycle composition, update handoff documentation, and verify the branch

**Files:**
- Modify: `miniprogram/services/app-services.ts`
- Modify: `miniprogram/app.ts`
- Modify: `docs/HANDOFF.md`
- Modify: `docs/MIGRATION-ANALYSIS.md`
- Modify: `README.md`

**Interfaces:**
- Consumes `WechatActiveRaceSessionStorage`, `ActiveRaceSessionRepository`, and `RaceController.syncForegroundState()`.
- Produces app-level foreground refresh without introducing a page or test-only control.

- [ ] **Step 1: Add the production service composition**

Construct one repository and pass it to the controller:

```ts
const activeRaceSessionRepository = new ActiveRaceSessionRepository(
  new WechatActiveRaceSessionStorage(),
)

export const raceController = new RaceController(
  bleTransport,
  athleteCatalog,
  scoreRepository,
  groupStore,
  activeRaceSessionRepository,
)
```

- [ ] **Step 2: Wire foreground lifecycle**

Replace the empty app registration with:

```ts
import { raceController } from './services/app-services'

App({
  onShow() {
    void raceController.syncForegroundState().catch(() => undefined)
  },
})
```

The controller already records `syncError`; the lifecycle callback must not duplicate toast/UI logic or reconnect when business state is Disconnected.

- [ ] **Step 3: Update operational documentation**

Document exact behavior:

- `0x13` is transfer state, not an EPC score;
- `0x12` is firmware-authoritative and independent from `0x10`;
- foreground sync queries `0x03`, waits for `0x04`, and sends `0x11` only when Detecting;
- active session persistence contains participant IDs, group ID, and two counters only;
- iOS background execution is not guaranteed, while `0x11` restores current firmware scores on foreground recovery.

Do not edit or stage `LORAProtocol-byte.md`; it remains the user's source document change.

- [ ] **Step 4: Run complete verification from a clean test build**

Run:

```powershell
if (Test-Path .\build-test) { Remove-Item -Recurse -Force -LiteralPath .\build-test }
pnpm test
pnpm run typecheck
git diff --check -- miniprogram tests docs/HANDOFF.md docs/MIGRATION-ANALYSIS.md README.md
```

Expected: every test passes, type checking exits zero, and diff checking reports no implementation whitespace errors. `git status --short` may still show only the user's `M LORAProtocol-byte.md` plus the files staged for this task before commit.

- [ ] **Step 5: Perform focused real-device acceptance in WeChat Developer Tools**

Verify on the updated firmware:

1. Connect while stopped: observe `0x03/0x04` and no `0x11`.
2. Start: observe successful `0x01/0xF0` and a saved active session.
3. Present a group athlete EPC: observe `0x14`, athlete `0x10`, success `0xF0`, then independent `0x12` score update.
4. Present an unknown or out-of-group EPC: observe non-athlete `0x10` with ID `0000` and no score mutation.
5. Background and resume while connected/detecting: observe `0x03/0x04`, then `0x11`, `0x13 [01]`, zero or more ordinary `0x12`, and `0x13 [00]`.
6. End: verify the current firmware lap leader fixes `finishLap` and later `0x12` freezes each participant at the finish boundary.
7. Reset: observe successful `0x02/0xF0`, cleared firmware data, and deleted local active session.

- [ ] **Step 6: Commit lifecycle and documentation with explicit paths**

```powershell
git add miniprogram/services/app-services.ts miniprogram/app.ts docs/HANDOFF.md docs/MIGRATION-ANALYSIS.md README.md
git commit -m "feat: restore athlete state on foreground"
```

- [ ] **Step 7: Record final branch state**

Run:

```powershell
git status --short
git log --oneline -8
```

Expected: implementation files are clean; `LORAProtocol-byte.md` remains modified and uncommitted unless the user separately requests that their protocol-document change be committed.
