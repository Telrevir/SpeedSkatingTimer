# Database-Generated Business IDs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every business create operation obtain its primary key from MySQL and bind the returned ID in the mini program.

**Architecture:** MySQL owns primary-key allocation, MyBatis binds generated keys into response models, and create APIs reject client-supplied primary keys. The mini program keeps only client idempotency keys before a request and commits server IDs from validated receipts.

**Tech Stack:** MySQL 8, Spring Boot 2, MyBatis XML mappers, Java 8, WeChat Mini Program TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-10-database-generated-ids-design.md`

## Global Constraints

- Do not read or stage backend credential files.
- Do not execute SQL against a shared or production database.
- Do not modify global Git safe-directory configuration.
- Do not revert or stage unrelated dirty mini-program files.
- Do not push the backend.
- Preserve `ClientRaceKey` and `ClientScoreKey` retry semantics.
- Treat `AthleteID` as an ordinary positive database-generated integer independent from EPC and firmware limits.
- This deployment-priority pass uses compile/type checks only; automated tests are recorded for later execution.

---

### Task 1: Database Schema And Migration SQL

**Files:**
- Modify: `后端服务器/wxcloudrun-springboot/src/main/resources/db.sql`
- Create: `后端服务器/wxcloudrun-springboot/src/main/resources/db/migration/V20260910_01__database_generated_ids_preflight.sql`
- Create: `后端服务器/wxcloudrun-springboot/src/main/resources/db/migration/V20260910_01__database_generated_ids.sql`
- Modify: `后端服务器/docs/database-design.md`

**Interfaces:**
- Produces database-generated IDs for `ClubID`, `CoachID`, `AthleteID`, `AthleteGroupID`, `AthleteGroupFormID`, and `ParentID`.
- Consumes the existing race migration that already generates `RaceID`, athlete-race join `id`, and `ScoreID`.

- [ ] Update all nine business primary keys in `db.sql` to `NOT NULL AUTO_INCREMENT` while preserving existing integer widths and foreign-key column compatibility.
- [ ] Add a read-only preflight that reports missing tables, invalid/non-positive IDs, primary-key mismatches, and orphaned references without DDL or DML.
- [ ] Add an idempotent migration that saves/restores `FOREIGN_KEY_CHECKS`, applies `AUTO_INCREMENT` to the six remaining primary keys, preserves existing IDs, and emits `SHOW CREATE TABLE` results.
- [ ] Document the exact deployment order and explicitly require `V20260907_01__race_identity_live_queries.sql` before this migration to resolve the observed missing `ClientRaceKey`.
- [ ] Perform static SQL review only; do not execute the scripts.

### Task 2: Backend Generated-Key Create Contract

**Files:**
- Modify: `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/ClubMapper.xml`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/CoachMapper.xml`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/AthleteMapper.xml`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/AthleteGroupMapper.xml`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/AthleteGroupFormMapper.xml`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/ParentMapper.xml`
- Modify: the corresponding six `service/impl/*ServiceImpl.java` files
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/impl/RaceInfoServiceImpl.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/impl/AthleteRaceJoinServiceImpl.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/impl/ScoreServiceImpl.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/impl/AthleteGroupBundleServiceImpl.java`
- Modify: `后端服务器/docs/api-protocol.md`

**Interfaces:**
- Create request models retain nullable boxed ID fields for JSON compatibility, but service create methods require them to be null.
- Mapper inserts bind generated keys into the same model property and services reload/return the generated row.

- [ ] Change six manual-ID inserts to omit the ID column and add `useGeneratedKeys`, `keyProperty`, and `keyColumn`.
- [ ] Reject non-null primary keys before every standalone business create insert with `IllegalArgumentException` so controllers return business code `400`.
- [ ] Validate every generated key as a positive integer; do not apply EPC- or firmware-derived limits to `AthleteID`.
- [ ] Change group-bundle create so the group is inserted first without an ID, then each member is inserted without an ID and receives the generated group/member IDs.
- [ ] Change group-bundle update so newly added member rows omit IDs and receive generated keys while existing rows retain their database IDs.
- [ ] Keep race-bundle idempotent replay behavior unchanged; only ensure genuinely new rows omit IDs.
- [ ] Update protocol examples so every POST create body omits IDs and every success body includes IDs.
- [ ] Run Maven compile/package without tests and record the command and result; do not push.

### Task 3: Mini Program Receipt-Bound IDs

**Files:**
- Modify: `TimerCountMiniProgram/miniprogram/services/backend-api/types.ts`
- Modify: `TimerCountMiniProgram/miniprogram/services/backend-api/athletes/create-athlete.ts`
- Modify: `TimerCountMiniProgram/miniprogram/services/backend-api/groups/create-group-bundle.ts`
- Modify: `TimerCountMiniProgram/miniprogram/services/athlete-management-service.ts`
- Modify: `TimerCountMiniProgram/miniprogram/services/group-management-service.ts`
- Modify: `TimerCountMiniProgram/miniprogram/services/backend-sync/catalog-cache-sync.ts` only if generated receipt mapping requires it
- Modify: `TimerCountMiniProgram/docs/SERVER_RACE_SYNC_PROGRESS.md`

**Interfaces:**
- `createAthlete` consumes `Omit<AthleteDto, 'AthleteID'>` and returns `ApiResult<AthleteDto>`.
- Group create consumes a DTO where group and member IDs are omitted, and returns a normalized `GroupBundleDto` with all generated IDs.

- [ ] Split create payload types from normalized response types so TypeScript prevents sending generated IDs.
- [ ] Build athlete create payload from validated name/EPC/ClubID only; validate returned `AthleteID` is a unique positive integer before updating cache.
- [ ] Build group create payload without group/member IDs; validate the full returned bundle before adopting generated IDs and saving mappings.
- [ ] On group update, omit IDs only for new member relations and preserve IDs for known relations.
- [ ] Confirm race/score serializers still omit generated IDs for new rows and preserve client idempotency keys.
- [ ] Run `npm run typecheck` only and record deferred tests and deployment risks.

### Task 4: Coordinated Handoff

**Files:**
- Modify: `后端服务器/docs/IMPLEMENTATION_HANDOFF_2026-09-07.md`
- Modify: `TimerCountMiniProgram/docs/SERVER_RACE_SYNC_HANDOFF_2026-09-10.md`

**Interfaces:**
- Produces one ordered deployment checklist and exact SQL file list for operators.

- [ ] Record the root cause of `Unknown column 'ClientRaceKey'` as a missing deployed migration, separate from generated-ID changes.
- [ ] Record backup, preflight, migration, schema inspection, backend rollout, and mini-program rollout in exact order.
- [ ] Record deferred automated tests and disposable-database rehearsal without claiming they passed.
- [ ] Check changed-file boundaries; do not stage unrelated dirty files or backend credentials.
- [ ] Do not push either project without a new explicit instruction.
