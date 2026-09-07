# Mini Program Server Race Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the mini program to server-backed race history and live race updates while preserving offline races, persistent athlete/group caches, Bluetooth timing responsiveness, and remote-first athlete/group management.

**Architecture:** Keep `BackendClient` as the only generic HTTP envelope/transport layer and place every endpoint in its own module. Persist current/offline race state and an outbox on the main thread; use a real WeChat Worker for scheduling and retry calculations while `WorkerRequestBridge` performs `wx.request`. Keep athlete/group data as club-scoped persistent caches that are atomically replaced only after a complete server pull.

**Tech Stack:** WeChat Mini Program, TypeScript 5.9, `wx.request`, WeChat Worker API, `wx` storage, Node test runner, TypeScript compiler.

**Spec:** `docs/superpowers/specs/2026-09-07-server-backed-race-storage-design.md`

## Global Constraints

- Start only after the backend protocol and implementation handoff from `2026-09-07-backend-race-storage-api.md` are complete.
- Run plan commands from `TimerCountMiniProgram`; its Git root is the outer `SpeedSkatingTimer` repository.
- Inspect `git status` before every task and preserve all existing uncommitted changes. Known changed files include `README.md`, `docs/ESP32-BLE-GATT.md`, `docs/superpowers/plans/2026-08-06-bt04-e-uuid.md`, `miniprogram/config/app-config.ts`, `miniprogram/config/ble-config.ts`, `miniprogram/pages/race/index.ts`, `tests/ble-transport.test.ts`, `tests/race-controller.test.ts`, and `tests/race-state.test.ts`; merge with them instead of overwriting them.
- Keep Bluetooth connection, packet decoding, scoring, and rendering on the main thread and responsive during network work.
- A Worker schedules retries and calculations only; all `wx.request`, UI calls, Bluetooth calls, and storage writes remain on the main thread.
- `BackendClient` stays generic: request construction, timeout, envelope parsing, and normalized status only. It does not know business DTOs, retry policy, UI, or storage.
- Each concrete endpoint has a separate source file and separate tests.
- Athlete/group data is server-authoritative but persisted as a `ClubID`-scoped cache. Offline read/select/race is allowed; offline create/update/archive/restore/delete is not.
- Offline races display `RaceID=-1`, but `-1` is never sent to the backend. Every race keeps immutable `localId` and `ClientRaceKey`.
- Every score keeps immutable `localScoreId`, `ClientScoreKey`, and `EventSequence`; array position is never an identity.
- History requests default to newest first, 20 races per page.
- Do not re-enable or reuse `temporary-backend-sync.ts`; remove its app wiring and keep the module disabled until final deletion is independently approved.
- If the 5-hour usage window has less than 20% remaining during execution, stop opening new work and update the mini-program handoff with completed tasks, pending tasks, changed files, tests, storage changes, and exact next commands.

---

### Task 1: Split The Backend API By Endpoint

**Files:**
- Keep generic: `TimerCountMiniProgram/miniprogram/services/backend-api/request.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/backend-api/types.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/backend-api/athletes/list-athletes.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/backend-api/athletes/create-athlete.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/backend-api/athletes/update-athlete.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/backend-api/athletes/delete-athlete.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/backend-api/groups/list-groups.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/backend-api/groups/list-group-members.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/backend-api/groups/create-group-bundle.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/backend-api/groups/update-group-bundle.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/backend-api/groups/delete-group-bundle.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/backend-api/races/create-race.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/backend-api/races/create-score.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/backend-api/races/save-race-bundle.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/backend-api/races/list-race-bundles.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/backend-api/races/list-active-races.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/backend-api/races/list-latest-scores.ts`
- Modify: `TimerCountMiniProgram/tests/backend-api.test.ts`
- Modify: `TimerCountMiniProgram/tests/run-tests.ts`

**Interfaces:**
- Produces shared DTOs `RaceInfoDto`, `RaceJoinDto`, `ScoreDto`, `RaceBundleDto`, `AthleteDto`, `GroupDto`, `GroupMemberDto`, and `PageResultDto<T>`.
- Every endpoint exports one function taking a `BackendClient` plus explicit request arguments and returning `Promise<ApiResult<T>>`.

- [ ] **Step 1: Write failing endpoint-isolation tests**

Create one assertion per file, including:

```ts
await createRace(client, {
  ClientRaceKey: 'race-local-1', ClubID: 1,
  RaceDate: '2026-09-07 10:00:00', IsFinished: false, Enabled: true,
})
await listRaceBundles(client, { ClubID: 1, page: 2, pageSize: 20, sortBy: 'RaceDate', sortOrder: 'desc' })
await listActiveRaces(client, 1)
await listLatestScores(client, 101)
```

Assert exact paths, methods, query strings, omitted optional IDs, and preservation of zero-valued times/ranks.

- [ ] **Step 2: Run tests and confirm failure**

```powershell
pnpm test
```

Expected: compilation failure for missing endpoint modules.

- [ ] **Step 3: Add shared DTOs with exact optional-ID rules**

```ts
export interface RaceInfoDto {
  RaceID?: number
  ClientRaceKey: string
  ClubID: number
  RaceDate: string
  IsFinished: boolean
  Enabled: boolean
}

export interface ScoreDto {
  ScoreID?: number
  RaceID: number
  AthleteID: number
  ClientScoreKey: string
  EventSequence: number
  LapCount: number
  SingleLapTime: number
  TotalTime: number
  Rank: number
  Enabled: boolean
}
```

Keep DTO validation in endpoint/domain modules, not in `request.ts`.

- [ ] **Step 4: Implement one function per endpoint**

Use this shape consistently:

```ts
export function listActiveRaces(
  client: BackendClient,
  clubId: number,
): Promise<ApiResult<ActiveRacesDto>> {
  return client.request({ method: 'GET', path: '/races/active', query: { ClubID: clubId } })
}
```

Do not add retry, storage, toast, or cross-endpoint orchestration here.

- [ ] **Step 5: Run API tests and typecheck**

```powershell
pnpm test
pnpm typecheck
```

Expected: both commands pass.

- [ ] **Step 6: Commit the API boundary**

```powershell
git add miniprogram/services/backend-api tests/backend-api.test.ts tests/run-tests.ts
git commit -m "refactor: separate backend endpoint modules"
```

### Task 2: Make Athlete And Group Storage A Server-Authoritative Cache

**Files:**
- Modify: `TimerCountMiniProgram/miniprogram/services/athlete-repository.ts`
- Modify: `TimerCountMiniProgram/miniprogram/services/athlete-catalog-service.ts`
- Modify: `TimerCountMiniProgram/miniprogram/stores/group-store.ts`
- Modify: `TimerCountMiniProgram/miniprogram/services/backend-sync/id-mapping.ts`
- Modify: `TimerCountMiniProgram/miniprogram/platform/wechat-athlete-catalog-storage.ts`
- Modify: `TimerCountMiniProgram/miniprogram/platform/wechat-group-storage.ts`
- Create: `TimerCountMiniProgram/miniprogram/domain/catalog-cache.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/catalog-cache-repository.ts`
- Create: `TimerCountMiniProgram/miniprogram/platform/wechat-catalog-cache-storage.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/backend-sync/catalog-cache-sync.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/athlete-management-service.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/group-management-service.ts`
- Modify: `TimerCountMiniProgram/tests/athlete-repository.test.ts`
- Modify: `TimerCountMiniProgram/tests/athlete-catalog-service.test.ts`
- Modify: `TimerCountMiniProgram/tests/group-store.test.ts`
- Create: `TimerCountMiniProgram/tests/catalog-cache-sync.test.ts`
- Create: `TimerCountMiniProgram/tests/server-authoritative-management.test.ts`
- Modify: `TimerCountMiniProgram/tests/run-tests.ts`

**Interfaces:**
- Produces: `CatalogCacheRepository.replaceFromServer(clubId, athletes, groups)` as one atomic persisted cache operation.
- Produces: `CatalogCacheSync.refresh(clubId): Promise<CacheSyncStatus>`.
- Produces remote-first management methods matching the current page operations.
- Produces a narrowed persistent group/member ID allocator; race and score identity no longer uses `SyncIdMapping`.

- [ ] **Step 1: Write failing cache replacement tests**

Assert that caches are isolated by `ClubID`; all pages must validate before either athlete or group storage changes; a page-2 failure preserves the previous complete cache; archived records survive when returned with `includeDisabled=true`; and no network leaves the cache readable:

Use exact test names `page failure preserves the complete previous club cache`, `successful refresh swaps athletes and groups in one publication`, and `club caches never share athletes or groups`. Compare serialized storage before/after and subscriber snapshots.

- [ ] **Step 2: Write failing management tests**

For athlete create/update/archive/restore and group create/update/delete, assert this sequence:

```text
validate candidate -> send request -> validate normalized receipt -> update cache -> publish subscribers
```

Network/business/invalid-response failures must leave storage, in-memory snapshots, selected group, and subscriber counts unchanged.

Use exact test names `failed athlete update leaves cache and subscribers unchanged`, `group bundle receipt commits name and full membership together`, and `offline management rejects before any cache write`. Assert transport call count, storage write count, and final snapshots.

- [ ] **Step 3: Run focused tests and confirm failure**

```powershell
pnpm test
```

- [ ] **Step 4: Implement club-scoped cache envelopes and atomic replacement**

Persist one combined envelope, never separate athlete/group writes during refresh:

```ts
interface ClubCatalogCacheV2 {
  schemaVersion: 2
  clubs: Record<string, { athletes: AthleteCatalog; groups: AthleteGroup[]; refreshedAt: number }>
}
```

Build and validate the complete next value in memory, write the combined envelope once through `WechatCatalogCacheStorage`, then swap both in-memory states and notify. Existing athlete/group storage adapters are migration readers only after schema v2 is committed. Never clear a valid old cache before a refresh succeeds.

- [ ] **Step 5: Implement remote-first management services**

The services construct candidates without calling current local mutators. After a successful validated server receipt, call dedicated cache-apply methods. For group changes, use only the aggregate group endpoints so the name and complete membership set commit together. Narrow `SyncIdMapping` to `group|member`; reserve IDs seen during catalog refresh and allocate request IDs before creating a new group bundle. Once the server responds, cache the server IDs as decimal strings and discard the draft local key. If the server succeeds but the cache write fails, show “服务器已保存，本地刷新失败” and immediately refresh that club's catalog cache.

- [ ] **Step 6: Run tests, typecheck, and commit**

```powershell
pnpm test
pnpm typecheck
git add miniprogram/services miniprogram/stores miniprogram/platform tests
git commit -m "feat: make athlete and group stores authoritative caches"
```

### Task 3: Replace Startup Full Sync With Catalog Refresh And Offline Upload Recovery

**Files:**
- Rewrite: `TimerCountMiniProgram/miniprogram/services/backend-sync/startup-sync.ts`
- Modify: `TimerCountMiniProgram/miniprogram/services/app-services.ts`
- Modify: `TimerCountMiniProgram/miniprogram/app.ts`
- Modify: `TimerCountMiniProgram/tests/backend-startup-sync.test.ts`
- Modify: `TimerCountMiniProgram/tests/backend-sync-validation.test.ts`
- Modify: `TimerCountMiniProgram/tests/run-tests.ts`

**Interfaces:**
- Consumes `CatalogCacheSync` from Task 2.
- Produces: `StartupSync.runOnce(): Promise<SyncStatus>` that refreshes catalogs and wakes persisted race work without downloading online race history.

- [ ] **Step 1: Replace old bidirectional-sync tests with failing startup tests**

Assert startup requests only athlete/group/member pages; never calls legacy `GET /race-bundles`; never uploads local athlete/group cache; wakes offline/pending race work; allows BLE auto-connect to proceed independently; and keeps the previous catalog cache when refresh fails:

Use exact test names `startup refreshes catalogs and wakes pending races only`, `startup catalog failure preserves cache and does not block BLE`, and `startup never downloads online race history`. Assert the exact request path sequence and unresolved backend promise behavior.

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
pnpm test
```

- [ ] **Step 3: Rewrite startup orchestration**

Use this order without awaiting it from `App.onLaunch`:

```text
refresh athlete/group cache -> restore outbox -> upload completed offline races
-> resume pending online race tasks -> publish summary
```

Treat catalog refresh and persisted race recovery as independent branches: a failed catalog refresh preserves the old cache but must not prevent outbox restoration or completed offline-race upload.

Remove imports and execution paths for `SyncDataApi`, race/score `SyncIdMapping`, full race download, local catalog upload, and `temporary-backend-sync`. The narrowed group/member allocator from Task 2 remains available only to remote-first group management.

- [ ] **Step 4: Verify startup and Bluetooth independence**

```powershell
pnpm test
pnpm typecheck
```

Expected: delayed backend promises do not delay `raceController.autoConnect()`.

- [ ] **Step 5: Commit startup behavior**

```powershell
git add miniprogram/app.ts miniprogram/services/app-services.ts miniprogram/services/backend-sync tests
git commit -m "refactor: limit startup sync to catalogs and pending races"
```

### Task 4: Add Persistent Race Identities, Working Copies, And Outbox

**Files:**
- Create: `TimerCountMiniProgram/miniprogram/domain/race-identity.ts`
- Modify: `TimerCountMiniProgram/miniprogram/domain/active-race-session.ts`
- Modify: `TimerCountMiniProgram/miniprogram/services/active-race-session-repository.ts`
- Modify: `TimerCountMiniProgram/miniprogram/services/score-repository.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/race-outbox-repository.ts`
- Create: `TimerCountMiniProgram/miniprogram/platform/wechat-race-outbox-storage.ts`
- Modify: `TimerCountMiniProgram/miniprogram/platform/wechat-score-storage.ts`
- Modify: `TimerCountMiniProgram/tests/active-race-session-repository.test.ts`
- Modify: `TimerCountMiniProgram/tests/score-repository.test.ts`
- Create: `TimerCountMiniProgram/tests/race-outbox-repository.test.ts`
- Modify: `TimerCountMiniProgram/tests/run-tests.ts`

**Interfaces:**
- Produces `RaceSyncState = 'pending' | 'online' | 'offline'`.
- Produces immutable race/score client identities and persistent task dependency metadata.

- [ ] **Step 1: Write failing storage migration and identity tests**

Assert multiple offline races all expose `RaceID=-1` but remain distinct; `localId`/`ClientRaceKey` survive reload; `localScoreId`/`ClientScoreKey`/`EventSequence` survive reload and correction; legacy records migrate without loss; and active-session recovery reopens the same working copy:

Use exact test names `two offline races keep distinct client identities while presenting -1`, `resume binds active session to the original working copy`, and `score correction preserves client key and event sequence`. Assert complete persisted records before and after repository reconstruction.

- [ ] **Step 2: Write failing outbox tests**

Cover create-before-score-before-finish dependencies, same-score task coalescing, distinct-race concurrency keys, retry metadata persistence, success removal, business `400/409` hold state, and corrupt-storage rejection without deleting raw data:

Use exact test names `outbox persists create score finish dependency order`, `same client score key coalesces to one task`, and `invalid stored outbox is retained for diagnosis but not executed`. Assert task IDs, dependency IDs, storage writes, and runnable-task output.

- [ ] **Step 3: Run tests and confirm failure**

```powershell
pnpm test
```

- [ ] **Step 4: Add versioned race storage types**

Use exact identities:

```ts
interface RaceIdentity {
  localId: string
  clientRaceKey: string
  raceId: number | null
  syncState: 'pending' | 'online' | 'offline'
}

interface ScoreIdentity {
  localScoreId: string
  clientScoreKey: string
  eventSequence: number
  scoreId: number | null
}
```

Convert `raceId:null` to `-1` only in presentation code; omit `RaceID` in outbound DTOs.

After schema migration, `ScoreRepository` stores only active working copies and unfinished uploads. Remove a completed online race after final server confirmation; keep completed offline races until complete-bundle upload succeeds. Online history is never repopulated into this repository.

- [ ] **Step 5: Implement persistent outbox state transitions**

Store `taskId`, `raceLocalId`, `kind`, `clientKey`, `dependsOn`, `attempt`, `nextAttemptAt`, `state`, and `lastErrorCode`. Write storage before publishing any in-memory state transition.

- [ ] **Step 6: Run tests, typecheck, and commit**

```powershell
pnpm test
pnpm typecheck
git add miniprogram/domain miniprogram/services miniprogram/platform tests
git commit -m "feat: persist race identities and sync outbox"
```

### Task 5: Add Worker Scheduling And Main-Thread Request Bridge

**Files:**
- Create: `TimerCountMiniProgram/miniprogram/workers/race-sync/index.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/worker-request-bridge.ts`
- Create: `TimerCountMiniProgram/miniprogram/services/race-sync-scheduler.ts`
- Modify: `TimerCountMiniProgram/miniprogram/app.json`
- Modify: `TimerCountMiniProgram/miniprogram/services/app-services.ts`
- Create: `TimerCountMiniProgram/tests/worker-request-bridge.test.ts`
- Create: `TimerCountMiniProgram/tests/race-sync-scheduler.test.ts`
- Modify: `TimerCountMiniProgram/tests/run-tests.ts`

**Interfaces:**
- Worker message out: `{ type:'request', requestId, taskId, endpoint, payload }`.
- Main message back: `{ type:'result', requestId, taskId, result: ApiResult<unknown> }`.
- Produces independent `control`, `race-write`, and `read` lanes.

- [ ] **Step 1: Write failing bridge correlation tests**

Assert out-of-order replies resolve the correct request; duplicate/unknown replies are ignored; timeout returns normalized failure; Worker termination rejects pending bridge calls; and business DTOs never enter `request.ts`:

Use exact test names `bridge correlates out-of-order replies by requestId`, `worker termination settles every pending bridge request`, and `duplicate and unknown replies do not mutate outbox`. Drive a fake Worker with explicit message ordering and assert each returned `ApiResult`.

- [ ] **Step 2: Write failing scheduler tests**

Assert strict serial work for one `raceLocalId`, parallel work for different races, read requests independent of writes, exponential retry capped at the configured maximum, immediate wake on `onShow`, and `400/409` held without an infinite loop:

Use exact test names `one race is serial while two races may progress concurrently`, `read lane is not delayed by race write retry`, and `business conflict is held without another timer`. Use controlled promises and a fake clock to assert call order and timer count.

- [ ] **Step 3: Run tests and confirm failure**

```powershell
pnpm test
```

- [ ] **Step 4: Implement Worker protocol and bridge**

Register the Worker directory in `app.json`:

```json
{ "workers": "workers" }
```

The bridge maps approved endpoint names to the endpoint functions from Task 1. The Worker never receives secrets beyond the request DTO and never invokes `wx`, storage, page, or BLE APIs.

- [ ] **Step 5: Add main-thread fallback scheduler**

Expose the same scheduler interface when `wx.createWorker` fails. Use promise queues and timers without blocking UI callbacks; persist every transition through `RaceOutboxRepository`.

- [ ] **Step 6: Run tests, typecheck, and commit**

```powershell
pnpm test
pnpm typecheck
git add miniprogram/workers miniprogram/services miniprogram/app.json tests
git commit -m "feat: add worker-backed race request scheduling"
```

### Task 6: Integrate Online And Offline Race Lifecycle

**Files:**
- Create: `TimerCountMiniProgram/miniprogram/services/race-sync-service.ts`
- Modify: `TimerCountMiniProgram/miniprogram/services/race-controller.ts`
- Modify: `TimerCountMiniProgram/miniprogram/services/app-services.ts`
- Modify: `TimerCountMiniProgram/tests/race-controller.test.ts`
- Create: `TimerCountMiniProgram/tests/race-sync-service.test.ts`
- Modify: `TimerCountMiniProgram/tests/local-race-scoring.test.ts`
- Modify: `TimerCountMiniProgram/tests/run-tests.ts`

**Interfaces:**
- `RaceSyncService.begin(participantIds, startedAt): RaceIdentity` persists first, then queues race creation.
- `RaceSyncService.recordScore(raceLocalId, score): ScoreIdentity` persists first, then conditionally queues online write.
- `RaceSyncService.finish(raceLocalId): void` persists completion and queues or retains the correct final action.

- [ ] **Step 1: Write failing start lifecycle tests**

Assert firmware start confirmation creates working copy immediately; the network check is invisible and does not delay controls; success binds positive `RaceID`; timeout/network/business failure changes the whole race to offline; and a lost response followed by bundle retry resolves via the same `ClientRaceKey`:

Use exact test names `confirmed firmware start persists pending race before network reply`, `create timeout marks race offline without blocking controls`, and `lost create response reuses client race key during bundle upload`. Capture storage and transport events and assert their order.

The initial create-race task has one bounded request attempt. On timeout, network failure, invalid response, or business failure, persist `syncState='offline'` and retire that create task; do not keep creating the race in the background. A possibly lost success response is reconciled only when the completed offline bundle is later uploaded with the same `ClientRaceKey`.

- [ ] **Step 2: Write failing score lifecycle tests**

Assert local write precedes enqueue; pending scores wait for race creation; online scores send with stable identity and save returned `ScoreID`; offline scores never send individually; retransmitted firmware history does not create a new identity for an already recorded event:

Use exact test names `accepted score persists before its write task becomes runnable`, `pending score waits for generated race id`, and `firmware history replay keeps one client score identity`. Assert storage contents, runnable-task sets, and final server IDs.

- [ ] **Step 3: Write failing finish lifecycle tests**

Assert pending finish waits for creation, online finish waits for prior scores and posts one complete bundle with `IsFinished=true`, offline finish remains locally uploadable, and local working data is deleted only after normalized server confirmation:

Use exact test names `online finish waits for score receipts before final bundle`, `offline finish remains until normalized upload receipt`, and `failed final bundle preserves working copy and outbox`. Assert endpoint call order and cleanup timing.

- [ ] **Step 4: Run focused tests and confirm failure**

```powershell
pnpm test
```

- [ ] **Step 5: Implement lifecycle hooks with minimal controller changes**

Inject `RaceSyncService` into `RaceController`. Call it only at the existing confirmed start, accepted non-historical score, and local-finish transitions. Do not move BLE decoding or local ranking into the network service.

- [ ] **Step 6: Run tests, typecheck, and commit**

```powershell
pnpm test
pnpm typecheck
git add miniprogram/services miniprogram/domain tests
git commit -m "feat: sync race lifecycle with backend"
```

### Task 7: Wire Remote-First Athlete And Group Management UI

**Files:**
- Modify: `TimerCountMiniProgram/miniprogram/pages/athletes/index.ts`
- Modify: `TimerCountMiniProgram/miniprogram/pages/athletes/index.wxml`
- Modify: `TimerCountMiniProgram/miniprogram/pages/athletes/index.wxss`
- Modify: `TimerCountMiniProgram/miniprogram/services/app-services.ts`
- Modify: `TimerCountMiniProgram/tests/athletes-wxml.test.ts`
- Create: `TimerCountMiniProgram/tests/athlete-management-page.test.ts`
- Modify: `TimerCountMiniProgram/tests/run-tests.ts`

**Interfaces:**
- Consumes management services from Task 2.
- Produces explicit busy/offline/error presentation while leaving cache unchanged on failure.

- [ ] **Step 1: Write failing page behavior tests**

Assert all athlete and group save/delete/archive/restore handlers await their service; controls disable while busy or backend unavailable; failed operations keep forms open and cached lists unchanged; successful group save closes the modal only after normalized receipt:

Use exact test names `athlete page waits for server receipt before success toast`, `failed group save keeps editor open and cache unchanged`, and `offline roster management is disabled but cached selection remains available`. Assert page data, toast calls, and management service calls.

- [ ] **Step 2: Run tests and confirm failure**

```powershell
pnpm test
```

- [ ] **Step 3: Replace direct store mutations with management services**

Keep local validation messages, add one non-technical network failure message, and preserve the existing “比赛重置前不能修改” rule. Do not add a global loading overlay.

- [ ] **Step 4: Run tests, typecheck, and commit**

```powershell
pnpm test
pnpm typecheck
git add miniprogram/pages/athletes miniprogram/services/app-services.ts tests
git commit -m "feat: require server confirmation for roster management"
```

### Task 8: Replace Local History With Server Pagination And Offline Merge

**Files:**
- Create: `TimerCountMiniProgram/miniprogram/services/race-history-query.ts`
- Modify: `TimerCountMiniProgram/miniprogram/pages/scores/index.ts`
- Modify: `TimerCountMiniProgram/miniprogram/pages/scores/view-model.ts`
- Modify: `TimerCountMiniProgram/miniprogram/pages/scores/index.wxml`
- Modify: `TimerCountMiniProgram/miniprogram/pages/scores/index.wxss`
- Create: `TimerCountMiniProgram/tests/race-history-query.test.ts`
- Modify: `TimerCountMiniProgram/tests/score-history-view-model.test.ts`
- Modify: `TimerCountMiniProgram/tests/run-tests.ts`

**Interfaces:**
- Produces `RaceHistoryQuery.loadPage({ page, pageSize, sortBy, sortOrder })` and `cancel()`.
- Produces merged display rows keyed by server `RaceID` or offline `ClientRaceKey`.

- [ ] **Step 1: Write failing query-state tests**

Assert defaults `(1,20,RaceDate,desc)`, only the requested page is fetched, stale response cancellation, retry without clearing the last result, offline merge by date, upload-result de-duplication by `ClientRaceKey`, and at most 20 visual rows:

Use exact test names `history defaults to newest twenty from server`, `stale page response cannot overwrite current query`, and `offline and uploaded copies merge by client race key`. Assert query DTOs and ordered display keys.

- [ ] **Step 2: Write failing page tests**

Assert initial load, next/previous controls, loading/error/empty states, expansion preservation for the current page, and server history replacing the old “暂无本地成绩” copy:

Use exact test names `history page requests selected page and preserves expansion` and `history failure retains rows and exposes retry state`. Assert page data before, during, and after controlled request results.

- [ ] **Step 3: Run tests and confirm failure**

```powershell
pnpm test
```

- [ ] **Step 4: Implement query module and page wiring**

Keep filter construction inside `RaceHistoryQuery`; the page passes typed search state only. Reuse the current lap tree formatter for both server bundles and offline working copies.

- [ ] **Step 5: Run tests, typecheck, and commit**

```powershell
pnpm test
pnpm typecheck
git add miniprogram/services/race-history-query.ts miniprogram/pages/scores tests
git commit -m "feat: page server race history"
```

### Task 9: Add The Current Races Page

**Files:**
- Create: `TimerCountMiniProgram/miniprogram/pages/live-races/index.ts`
- Create: `TimerCountMiniProgram/miniprogram/pages/live-races/index.json`
- Create: `TimerCountMiniProgram/miniprogram/pages/live-races/index.wxml`
- Create: `TimerCountMiniProgram/miniprogram/pages/live-races/index.wxss`
- Create: `TimerCountMiniProgram/miniprogram/pages/live-races/view-model.ts`
- Modify: `TimerCountMiniProgram/miniprogram/app.json`
- Modify: `TimerCountMiniProgram/miniprogram/pages/race/index.wxml`
- Modify: `TimerCountMiniProgram/miniprogram/pages/scores/index.wxml`
- Create: `TimerCountMiniProgram/tests/live-races-view-model.test.ts`
- Create: `TimerCountMiniProgram/tests/live-races-page.test.ts`
- Modify: `TimerCountMiniProgram/tests/run-tests.ts`

**Interfaces:**
- Consumes active-race and latest-score endpoints from Task 1.
- Produces a non-Tab page with 5-second race-list polling and 1-second polling for each expanded race.

- [ ] **Step 1: Write failing polling lifecycle tests**

Assert immediate fetch on show; 5-second list refresh; 1-second expanded-score refresh; no overlapping request for the same resource; stop on hide/unload/collapse; retain last successful rows after failure; and restart once on show:

Use exact test names `live page owns and clears list and score timers`, `expanded race never overlaps latest-score requests`, and `poll failure preserves the last successful presentation`. Use a fake clock and deferred promises to assert timer and request counts.

- [ ] **Step 2: Write failing view-model tests**

Given `ServerTime`, `RaceDate`, athlete cache, and latest scores, assert locally advancing total duration, maximum lap, leader selection using existing ranking rules, one row per athlete, and ID placeholder for missing cached athletes:

Use exact test names `live view advances elapsed time from server clock offset`, `live view selects leader and maximum lap from latest athlete scores`, and `missing athlete cache renders AthleteID placeholder`. Assert formatted time, selected athlete ID, maximum lap, and placeholder text.

- [ ] **Step 3: Run tests and confirm failure**

```powershell
pnpm test
```

- [ ] **Step 4: Implement the page using the existing score layout**

Reuse current typography, table columns, time formatting, and ranking behavior. Append the page after the five existing Tab pages in `app.json` so `pages/race/index` remains the startup page; do not add a sixth Tab. Add concise navigation entries from race and score pages.

- [ ] **Step 5: Run tests and typecheck**

```powershell
pnpm test
pnpm typecheck
```

- [ ] **Step 6: Verify visually in WeChat DevTools**

Check compact and wide simulator sizes for wrapping, no overlap, stable expanded rows, visible stale/error state, and correct navigation. Confirm timers stop in the background using the DevTools network panel.

- [ ] **Step 7: Commit the current-race page**

```powershell
git add miniprogram/pages/live-races miniprogram/pages/race miniprogram/pages/scores miniprogram/app.json tests
git commit -m "feat: add live race viewer"
```

### Task 10: End-To-End Recovery, Regression, And Handoff

**Files:**
- Modify only when verification exposes a defect in files already listed above.
- Create: `TimerCountMiniProgram/docs/SERVER_RACE_SYNC_HANDOFF_2026-09-07.md`

**Interfaces:**
- Produces verified mini-program behavior ready for coordinated review and later push to `DetectOnly`.

- [ ] **Step 1: Run all automated checks**

```powershell
pnpm test
pnpm typecheck
```

Expected: both commands exit 0.

- [ ] **Step 2: Run integration scenarios against a disposable backend/database**

Verify: online start and score IDs; timeout then offline finish; lost create response then idempotent upload; app restart with pending outbox; catalog page-2 failure preserving cache; offline race using cached roster; remote-first roster edit failure; two simultaneous active races; latest score per athlete; and completed-race mutation rejection.

- [ ] **Step 3: Run device-facing regression scenarios**

In WeChat DevTools and on a real device, verify BLE auto-connect, reconnect history retrieval, ongoing packet handling during backend delay, firmware score de-duplication, app foreground/background transitions, and Worker fallback when Worker startup is forced to fail.

- [ ] **Step 4: Confirm obsolete startup paths are inactive**

```powershell
rg -n "TemporaryBackendSync|SyncDataApi|fetchAll\(|RaceBundlesApi" miniprogram/app.ts miniprogram/services/app-services.ts miniprogram/services/backend-sync
```

Expected: no active startup full-upload/full-download path; any remaining occurrence is an isolated disabled legacy module or a migration-only test.

- [ ] **Step 5: Write the handoff**

Record completed commits, files changed, test outputs, DevTools/device results, backend protocol commit consumed, storage schema versions, migration behavior, known risks, and any pending manual verification. Do not include athlete personal data or backend credentials.

- [ ] **Step 6: Commit without pushing automatically**

```powershell
git add docs/SERVER_RACE_SYNC_HANDOFF_2026-09-07.md
git commit -m "docs: hand off mini program race sync"
git status --short --branch
```

Wait for the supervisor to perform the requested final update check and explicit push decision.
