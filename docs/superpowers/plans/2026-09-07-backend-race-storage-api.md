# Backend Race Storage API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Spring Boot backend authoritative for athlete/group caches and online race history, with idempotent race/score writes, transactional complete bundles, paginated history, and live-race queries.

**Architecture:** Keep the existing controller/service/MyBatis structure. Add stable client keys and generated database IDs at the persistence boundary, keep each query or aggregate operation in a focused service method, and preserve the legacy full-sync GET endpoint while adding new endpoints beside it. Use `ApiResponse.code` for `400`, `404`, `409`, and `500`, matching the existing application convention; controller HTTP responses remain compatible with current clients.

**Tech Stack:** Java 8, Spring Boot 2.5.5, Spring MVC, MyBatis XML, MySQL/InnoDB, JUnit 5, Mockito, Maven Wrapper.

**Spec:** `docs/superpowers/specs/2026-09-07-server-backed-race-storage-design.md`

## Global Constraints

- Execute this backend plan before `docs/superpowers/plans/2026-09-07-miniprogram-server-race-sync.md`.
- Treat `后端服务器/wxcloudrun-springboot` as the backend Git root; `后端服务器/docs` is a sibling workspace-document directory and is not part of that nested repository.
- Run Task 1 documentation checks from the outer workspace root; after its explicit `Set-Location`, run Maven and backend Git commands from `后端服务器/wxcloudrun-springboot`.
- Before the first backend Git operation, request approval to run `git config --global --add safe.directory 'D:/WorkProject/计时系统文件及备份/SpeedSkatingTimer/后端服务器/wxcloudrun-springboot'`; the repository currently fails Git ownership validation without this explicit entry.
- Do not read, stage, commit, or print `后端服务器/docs/微信后台托管账号密码.txt`.
- Do not push the backend repository unless the user gives fresh explicit permission; the standing instruction is “后端暂时不推送”.
- Database structure changes are authorized only for the fields, generated IDs, constraints, and indexes listed in the approved spec.
- Update `db.sql`, add one idempotent migration, update both database/API documents, and provide a read-only preflight SQL file.
- `RaceID`, `ScoreID`, and `AthleteRaceJoin.id` are database-generated for new rows; existing positive IDs remain valid.
- New races require `ClientRaceKey`, unique within `ClubID`; new scores require `ClientScoreKey` and `EventSequence`, unique within `RaceID`.
- `IsFinished` may move only from `false` to `true`; after finish, only byte-for-byte equivalent idempotent replay is accepted.
- The legacy `GET /api/v1/race-bundles` endpoint remains available during this change.
- Preserve all unrelated existing backend files and changes.
- If the 5-hour usage window has less than 20% remaining during execution, stop opening new work and update the backend handoff with completed tasks, pending tasks, changed files, tests, SQL changes, and exact next commands.

---

### Task 1: Freeze The Protocol And Database Migration

**Files:**
- Modify: `后端服务器/docs/api-protocol.md`
- Modify: `后端服务器/docs/database-design.md`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/resources/db.sql`
- Create: `后端服务器/wxcloudrun-springboot/src/main/resources/db/migration/V20260907_01__race_identity_live_queries.sql`
- Create: `后端服务器/wxcloudrun-springboot/src/main/resources/db/migration/V20260907_01__race_identity_live_queries_preflight.sql`

**Interfaces:**
- Produces the exact JSON and SQL contract consumed by every later backend task and by the mini-program plan.
- Defines `ClientRaceKey VARCHAR(64)`, `IsFinished BOOLEAN`, `ClientScoreKey VARCHAR(64)`, and `EventSequence INT`.

- [ ] **Step 1: Document the request and response schemas before implementation**

Add exact examples for these endpoints:

```text
POST   /api/v1/races
POST   /api/v1/scores
POST   /api/v1/race-bundles
GET    /api/v1/race-bundles/page
GET    /api/v1/races/active
GET    /api/v1/races/{RaceID}/latest-scores
POST   /api/v1/athlete-group-bundles
PUT    /api/v1/athlete-group-bundles/{AthleteGroupID}
DELETE /api/v1/athlete-group-bundles/{AthleteGroupID}
```

State explicitly that optional request IDs are omitted, not sent as `-1` or `null`; successful responses contain normalized generated IDs; `sortBy` accepts only `RaceDate|RaceID`; `sortOrder` accepts only `asc|desc`; latest scores select maximum `EventSequence` per athlete.

- [ ] **Step 2: Write the read-only preflight SQL**

The preflight must return rows instead of mutating data and must include these checks:

```sql
SELECT `ClubID`, `RaceID`, COUNT(*) AS duplicate_count
FROM `RaceInfoTable`
GROUP BY `ClubID`, `RaceID`
HAVING COUNT(*) > 1;

SELECT `RaceID`, `AthleteID`, COUNT(*) AS duplicate_count
FROM `AthleteRaceJoinTable`
WHERE `Enabled` = TRUE
GROUP BY `RaceID`, `AthleteID`
HAVING COUNT(*) > 1;

SELECT `RaceID`, `ScoreID`, COUNT(*) AS duplicate_count
FROM `ScoreTable`
GROUP BY `RaceID`, `ScoreID`
HAVING COUNT(*) > 1;

SELECT COUNT(*) AS orphan_scores
FROM `ScoreTable` s
LEFT JOIN `RaceInfoTable` r ON r.`RaceID` = s.`RaceID`
WHERE r.`RaceID` IS NULL;
```

Also query `information_schema.COLUMNS` and `information_schema.STATISTICS` so an operator can see whether every target column/index already exists.

- [ ] **Step 3: Write the idempotent migration**

Use `information_schema` checks plus prepared `ALTER TABLE` statements so re-running the file is harmless. Apply this data order:

```sql
-- 1. Add nullable client-key columns and IsFinished with a temporary default.
-- 2. Backfill every existing RaceInfoTable.IsFinished to TRUE.
-- 3. Backfill RaceInfoTable.ClientRaceKey = CONCAT('legacy:', RaceID).
-- 4. Backfill ScoreTable.ClientScoreKey = CONCAT('legacy:', ScoreID).
-- 5. Build a temporary (RaceID, ScoreID, EventSequence) table ordered by ScoreID,
--    then update ScoreTable.EventSequence from it.
-- 6. Make client keys and EventSequence NOT NULL.
-- 7. Convert RaceID, ScoreID, and AthleteRaceJoin.id to AUTO_INCREMENT.
-- 8. Add the approved unique keys and query indexes.
```

Abort with `SIGNAL SQLSTATE '45000'` when pre-existing duplicate active joins or invalid null/orphan data would make the constraints unsafe. Do not delete or merge rows automatically.

- [ ] **Step 4: Update the clean-install schema and database design**

The final clean-install columns and keys must match:

```sql
`RaceID` BIGINT NOT NULL AUTO_INCREMENT,
`ClientRaceKey` VARCHAR(64) NOT NULL,
`IsFinished` BOOLEAN NOT NULL DEFAULT FALSE,
UNIQUE KEY `uk_race_club_client_key` (`ClubID`, `ClientRaceKey`),
KEY `idx_race_live_history` (`ClubID`, `IsFinished`, `Enabled`, `RaceDate`, `RaceID`)

`ScoreID` BIGINT NOT NULL AUTO_INCREMENT,
`ClientScoreKey` VARCHAR(64) NOT NULL,
`EventSequence` INT NOT NULL,
UNIQUE KEY `uk_score_race_client_key` (`RaceID`, `ClientScoreKey`),
UNIQUE KEY `uk_score_race_sequence` (`RaceID`, `EventSequence`),
KEY `idx_score_latest` (`RaceID`, `AthleteID`, `Enabled`, `EventSequence`, `ScoreID`)

`id` BIGINT NOT NULL AUTO_INCREMENT,
UNIQUE KEY `uk_race_athlete` (`RaceID`, `AthleteID`)
```

- [ ] **Step 5: Verify documentation and SQL names agree**

Run:

```powershell
rg -n "ClientRaceKey|IsFinished|ClientScoreKey|EventSequence|race-bundles/page|latest-scores|athlete-group-bundles" 后端服务器/docs 后端服务器/wxcloudrun-springboot/src/main/resources
```

Expected: every field and endpoint is present in both protocol and schema documentation, and no approved field has two spellings.

- [ ] **Step 6: Commit the repository-owned schema and migration contract**

```powershell
Set-Location 后端服务器/wxcloudrun-springboot
git add src/main/resources/db.sql src/main/resources/db/migration/V20260907_01__race_identity_live_queries.sql src/main/resources/db/migration/V20260907_01__race_identity_live_queries_preflight.sql
git commit -m "docs: define race storage protocol and migration"
```

Keep `后端服务器/docs/api-protocol.md` and `后端服务器/docs/database-design.md` as local workspace artifacts for supervisor review; do not attempt to add them to the nested repository or the outer repository as an embedded backend repository.

### Task 2: Add Persistent Identity And Idempotent Single-Resource Writes

**Files:**
- Create: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/config/ConflictException.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/model/RaceInfo.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/model/Score.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/RaceInfoMapper.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/ScoreMapper.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/RaceInfoMapper.xml`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/ScoreMapper.xml`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/impl/RaceInfoServiceImpl.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/impl/ScoreServiceImpl.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/RaceInfoService.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/ScoreService.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/controller/RaceInfoController.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/controller/ScoreController.java`
- Create: `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/service/RaceIdentityServiceTest.java`
- Create: `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/controller/RaceWriteControllerTest.java`

**Interfaces:**
- Produces: `RaceInfoMapper.getByClubAndClientKey(Integer, String)` and `ScoreMapper.getByRaceAndClientKey(Long, String)`.
- Produces: generated-key `insert(RaceInfo)` and `insert(Score)` methods that populate object IDs.
- Produces: `ConflictException`, mapped by controllers to `ApiResponse.error(409, message)`.

- [ ] **Step 1: Write failing service tests for race idempotency**

```java
@Test
void repeatedClientRaceKeyReturnsExistingRaceWithoutInsert() {
  RaceInfo incoming = race(null, "client-race-1", 1, false);
  RaceInfo existing = race(101L, "client-race-1", 1, false);
  when(mapper.getByClubAndClientKey(1, "client-race-1")).thenReturn(existing);
  assertThat(service.create(incoming)).isEqualTo(existing);
  verify(mapper, never()).insert(any());
}

@Test
void sameRaceKeyWithDifferentImmutableDataThrowsConflict() {
  when(mapper.getByClubAndClientKey(1, "client-race-1"))
      .thenReturn(race(101L, "client-race-1", 1, false));
  assertThatThrownBy(() -> service.create(raceAt("client-race-1", 1, "2026-09-08 10:00:00")))
      .isInstanceOf(ConflictException.class);
}
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```powershell
.\mvnw.cmd -Dtest=RaceIdentityServiceTest test
```

Expected: compilation/test failure because the new fields and mapper methods do not exist.

- [ ] **Step 3: Implement race and score fields plus generated-key mapper inserts**

Add model properties with exact JSON names:

```java
@JsonProperty("ClientRaceKey") private String ClientRaceKey;
@JsonProperty("IsFinished") private Boolean IsFinished;
@JsonProperty("ClientScoreKey") private String ClientScoreKey;
@JsonProperty("EventSequence") private Integer EventSequence;
```

Use MyBatis generated keys:

```xml
<insert id="insert" useGeneratedKeys="true" keyProperty="RaceID" keyColumn="RaceID">
<insert id="insert" useGeneratedKeys="true" keyProperty="ScoreID" keyColumn="ScoreID">
```

Remove `maxRaceID()` allocation from race creation. Validate nonblank keys, positive `EventSequence`, positive foreign IDs, and default `Enabled=true`, `IsFinished=false`.

Do not permit `PUT /races/{RaceID}` to finish a race; `IsFinished=true` must be committed only by the complete-bundle transaction. Permit only identical replay for a finished race. Apply the same finished-parent guard to score update/delete operations.

- [ ] **Step 4: Implement score idempotency and ownership conflicts**

`ScoreServiceImpl.create` must follow this order:

```text
1. Validate RaceID, AthleteID, ClientScoreKey, EventSequence and times.
2. If ScoreID is supplied, load it and verify all identity fields.
3. Look up RaceID + ClientScoreKey.
4. Look up RaceID + EventSequence.
5. Return an identical existing row; throw ConflictException for divergent matches.
6. Verify the parent race exists and IsFinished=false.
7. Insert and return the generated ScoreID.
```

- [ ] **Step 5: Add controller tests for normalized IDs and 409 envelopes**

Assert HTTP 200 for compatibility and body codes:

```java
mockMvc.perform(post("/api/v1/races").contentType(APPLICATION_JSON).content(body))
    .andExpect(status().isOk())
    .andExpect(jsonPath("$.code").value(0))
    .andExpect(jsonPath("$.data.RaceID").value(101));

mockMvc.perform(post("/api/v1/scores").contentType(APPLICATION_JSON).content(conflictBody))
    .andExpect(status().isOk())
    .andExpect(jsonPath("$.code").value(409));
```

- [ ] **Step 6: Run focused and full backend tests**

```powershell
.\mvnw.cmd -Dtest=RaceIdentityServiceTest,RaceWriteControllerTest test
.\mvnw.cmd test
```

Expected: all tests pass.

- [ ] **Step 7: Commit identity support**

```powershell
git add src/main/java src/main/resources/mapper src/test/java
git commit -m "feat: add idempotent race and score identities"
```

### Task 3: Add Transactional Athlete Group Bundles

**Files:**
- Create: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dto/AthleteGroupBundleRequest.java`
- Create: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/AthleteGroupBundleService.java`
- Create: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/impl/AthleteGroupBundleServiceImpl.java`
- Create: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/controller/AthleteGroupBundleController.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/AthleteGroupFormMapper.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/AthleteGroupFormMapper.xml`
- Create: `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/service/AthleteGroupBundleServiceImplTest.java`
- Create: `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/controller/AthleteGroupBundleControllerTest.java`

**Interfaces:**
- Produces: `save(AthleteGroupBundleRequest)`, `update(Integer, AthleteGroupBundleRequest)`, and `delete(Integer)` transaction methods.
- Request/response shape:

```json
{
  "AthleteGroup": {
    "AthleteGroupID": 11,
    "ClubID": 1,
    "AthleteGroupName": "一队",
    "Enabled": true
  },
  "AthleteGroupForms": [
    {
      "AthleteGroupFormID": 21,
      "AthleteGroupID": 11,
      "AthleteID": 7,
      "Enabled": true
    }
  ]
}
```

- [ ] **Step 1: Write failing transaction tests**

Cover create, exact-list update, delete, wrong group ID, cross-club athlete membership, duplicate athlete membership, and rollback when the third member insert fails. Verify update soft-deletes omitted active memberships and re-enables matching existing memberships. Use named tests:

Use exact test names `updateTreatsMembersAsCompleteList`, `crossClubMemberRejectsBeforeAnyWrite`, and `memberWriteFailureRollsBackWholeBundle`. The first verifies `softDelete(omittedID)`, the second uses `verifyNoInteractions` on write mappers, and the third asserts the mapper exception escapes the transactional service.

- [ ] **Step 2: Run the focused tests and confirm failure**

```powershell
.\mvnw.cmd -Dtest=AthleteGroupBundleServiceImplTest,AthleteGroupBundleControllerTest test
```

Expected: compilation failure because bundle classes are absent.

- [ ] **Step 3: Implement the aggregate service with one transaction**

```java
@Transactional(rollbackFor = Exception.class)
public AthleteGroupBundleRequest update(Integer pathGroupID, AthleteGroupBundleRequest request)
```

Validate path/body identity, club ownership, unique athlete IDs, and all referenced athletes before any write. Treat the incoming member list as complete: upsert listed rows and soft-delete currently active rows not listed.

- [ ] **Step 4: Implement three controller methods and error mapping**

Use exact routes from Task 1. Return the normalized group and complete normalized membership list after commit. Convert ownership/identity conflicts to envelope code `409`; missing records to `404`.

- [ ] **Step 5: Run focused and full backend tests**

```powershell
.\mvnw.cmd -Dtest=AthleteGroupBundleServiceImplTest,AthleteGroupBundleControllerTest test
.\mvnw.cmd test
```

Expected: all tests pass.

- [ ] **Step 6: Commit group aggregate support**

```powershell
git add src/main/java src/main/resources/mapper src/test/java
git commit -m "feat: add transactional athlete group bundles"
```

### Task 4: Make Complete Race Bundle Save Idempotent And Finish-Safe

**Files:**
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dto/RaceBundleRequest.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/RaceBundleService.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/impl/RaceBundleServiceImpl.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/AthleteRaceJoinMapper.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/AthleteRaceJoinMapper.xml`
- Modify: `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/service/RaceBundleServiceImplTest.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/controller/RaceBundleControllerTest.java`

**Interfaces:**
- Consumes idempotent race/score persistence from Task 2.
- Produces a normalized `RaceBundleRequest saveRaceBundle(RaceBundleRequest request)` response containing every generated child ID.

- [ ] **Step 1: Replace legacy upsert assumptions with failing bundle tests**

Add cases for missing IDs, existing `ClientRaceKey`, identical replay, divergent score replay, duplicate participant, child from another race, transaction failure, and attempted mutation after finish. Explicitly assert that `IsFinished=true` is the final mapper mutation:

```java
@Test
void finishFlagIsWrittenAfterChildren() {
  InOrder writes = inOrder(joinMapper, scoreMapper, raceInfoMapper);
  writes.verify(joinMapper).insert(any());
  writes.verify(scoreMapper).insert(any());
  writes.verify(raceInfoMapper).markFinished(raceID);
}
```

Use additional exact test names `createsMissingRaceJoinAndScoreIdsAndReturnsThem`, `identicalFinishedBundleReplayPerformsNoWrites`, and `divergentFinishedBundleReplayThrowsConflict` with assertions matching their names.

- [ ] **Step 2: Run the focused tests and confirm failure**

```powershell
.\mvnw.cmd -Dtest=RaceBundleServiceImplTest,RaceBundleControllerTest test
```

Expected: failures from required child IDs and legacy `maxRaceID()` behavior.

- [ ] **Step 3: Implement resolve-compare-save logic**

Within one `@Transactional` method:

```text
resolve race by RaceID when supplied, otherwise by ClubID + ClientRaceKey
create race with IsFinished=false when absent
reject immutable identity conflicts
resolve each join by RaceID + AthleteID and return its generated id
resolve each score by ScoreID/client key/event sequence and compare every field
write changed non-identity fields only while race is unfinished
mark IsFinished=true only after every join and score succeeds
reload and return the normalized bundle
```

An already finished race accepts only an identical replay and performs no writes.

- [ ] **Step 4: Run focused and full backend tests**

```powershell
.\mvnw.cmd -Dtest=RaceBundleServiceImplTest,RaceBundleControllerTest test
.\mvnw.cmd test
```

Expected: all tests pass and no `maxRaceID` reference remains.

- [ ] **Step 5: Commit bundle semantics**

```powershell
git add src/main/java src/main/resources/mapper src/test/java
git commit -m "feat: make race bundles idempotent and transactional"
```

### Task 5: Add Stable Paginated Race Bundle Queries

**Files:**
- Create: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dto/RaceBundlePageResult.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/controller/RaceBundleController.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/RaceBundleService.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/impl/RaceBundleServiceImpl.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/RaceInfoMapper.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/RaceInfoMapper.xml`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/AthleteRaceJoinMapper.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/ScoreMapper.java`
- Modify: corresponding mapper XML files
- Create: `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/service/RaceBundleQueryServiceTest.java`

**Interfaces:**
- Produces: `getRaceBundlePage(Integer clubID, Integer page, Integer pageSize, String sortBy, String sortOrder)`.
- Extends: `PageResult<RaceInfo> list(Integer ClubID, String startDate, String endDate, Integer page, Integer pageSize, Boolean includeDisabled, String sortBy, String sortOrder)` so the existing `/api/v1/races` query also has explicit sorting.
- Produces batch mapper methods `listByRaceIDs(List<Long>)` for joins and scores.

- [ ] **Step 1: Write failing pagination tests**

Cover defaults `(1,20,RaceDate,desc)`, maximum page size 200, invalid sort field/order, ascending/descending order, equal-date `RaceID` tie-breaking, empty pages, and exactly two child batch queries for a nonempty page. Repeat the sort/default/invalid-parameter assertions against the existing `GET /api/v1/races` service path:

Use exact test names `defaultsToNewestTwentyWithStableRaceIdTieBreak`, `rejectsUnknownSortFieldAndOrder`, `assemblesPageWithTwoBatchChildQueries`, and `existingRaceListUsesTheSameSortWhitelist`. Verify the mapper arguments and ordered returned IDs, not only the result count.

- [ ] **Step 2: Run the focused tests and confirm failure**

```powershell
.\mvnw.cmd -Dtest=RaceBundleQueryServiceTest test
```

- [ ] **Step 3: Implement whitelist sorting and batch assembly**

Map accepted values in Java to an enum or fixed booleans; the XML must contain only controlled `<choose>` branches such as:

```xml
<when test="sortBy == 'RaceID' and sortOrder == 'asc'">ORDER BY `RaceID` ASC</when>
<when test="sortBy == 'RaceID'">ORDER BY `RaceID` DESC</when>
<when test="sortOrder == 'asc'">ORDER BY `RaceDate` ASC, `RaceID` ASC</when>
<otherwise>ORDER BY `RaceDate` DESC, `RaceID` DESC</otherwise>
```

Do not use `${sortBy}` or `${sortOrder}`. Fetch the page of races first, then fetch all joins and scores with `<foreach>` `IN` queries and group in memory.

- [ ] **Step 4: Add controller assertions for the response metadata**

Assert `list`, `page`, `pageSize`, `total`, `sortBy`, and `sortOrder` under `$.data` for `GET /api/v1/race-bundles/page`. Assert that `GET /api/v1/races` accepts the same `sortBy` and `sortOrder` whitelist and returns the selected stable order.

- [ ] **Step 5: Run tests and commit**

```powershell
.\mvnw.cmd test
git add src/main/java src/main/resources/mapper src/test/java
git commit -m "feat: add paginated race bundle queries"
```

### Task 6: Add Active Race And Latest-Per-Athlete Queries

**Files:**
- Create: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dto/ActiveRacesResponse.java`
- Create: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dto/LatestScoresResponse.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/controller/RaceInfoController.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/RaceInfoService.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/impl/RaceInfoServiceImpl.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/RaceInfoMapper.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/RaceInfoMapper.xml`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/ScoreMapper.java`
- Modify: `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/ScoreMapper.xml`
- Create: `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/service/LiveRaceQueryServiceTest.java`
- Create: `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/controller/LiveRaceControllerTest.java`

**Interfaces:**
- Produces: `ActiveRacesResponse listActive(Integer clubID)` with `list`, `total`, `ServerTime`.
- Produces: `LatestScoresResponse getLatestScores(Long raceID)` with `RaceID`, `Scores`.

- [ ] **Step 1: Write failing live-query tests**

Assert multiple active races ordered `RaceDate DESC, RaceID DESC`; exclude disabled and finished races; reject missing ClubID; return `404` for an absent race; return an empty latest-score list when no athlete has a score; and select the maximum enabled `EventSequence` independently for each athlete:

Use exact test names `returnsAllActiveRacesForClubInNewestOrder`, `latestScoresSelectMaxEventSequencePerAthlete`, `latestScoresIgnoreDisabledEvents`, and `missingRaceReturnsCode404`. Assert returned IDs and sequence values explicitly.

- [ ] **Step 2: Run the focused tests and confirm failure**

```powershell
.\mvnw.cmd -Dtest=LiveRaceQueryServiceTest,LiveRaceControllerTest test
```

- [ ] **Step 3: Implement active-race query**

Use a fixed mapper query:

```sql
SELECT `RaceID`, `ClientRaceKey`, `RaceDate`, `ClubID`, `IsFinished`, `Enabled`
FROM `RaceInfoTable`
WHERE `ClubID` = #{ClubID} AND `Enabled` = TRUE AND `IsFinished` = FALSE
ORDER BY `RaceDate` DESC, `RaceID` DESC;
```

Serialize `ServerTime` using the same `yyyy-MM-dd HH:mm:ss` format as `RaceDate`.

- [ ] **Step 4: Implement latest score per athlete**

Use a correlated maximum or grouped subquery keyed by `(RaceID, AthleteID, EventSequence)` and deterministic `ScoreID` tie handling. Do not use `LapCount` to choose the latest event.

- [ ] **Step 5: Run tests and commit**

```powershell
.\mvnw.cmd test
git add src/main/java src/main/resources/mapper src/test/java
git commit -m "feat: add live race queries"
```

### Task 7: Final Backend Verification And Handoff

**Files:**
- Modify only when verification exposes a defect in files already listed above.
- Create: `后端服务器/docs/IMPLEMENTATION_HANDOFF_2026-09-07.md` (workspace artifact outside the nested backend Git repository)

**Interfaces:**
- Produces a stable protocol handoff for the mini-program task.

- [ ] **Step 1: Run the complete automated suite**

```powershell
.\mvnw.cmd clean test
```

Expected: Maven exits 0 with no failed tests.

- [ ] **Step 2: Verify forbidden dynamic SQL and removed manual ID allocation**

```powershell
rg -n '\$\{sort|\$\{.*Order|maxRaceID|ClientRaceID' src/main src/test
```

Expected: no dynamic sort interpolation, no manual race-ID allocation, and no obsolete `ClientRaceID` use.

- [ ] **Step 3: Review the database scripts without executing them**

Record exact locations, required backup, preflight command, migration command, post-migration `SHOW CREATE TABLE` checks, and rollback limitations. Do not execute against the shared or production database without a new explicit user instruction.

- [ ] **Step 4: Write the handoff**

The handoff must include commits, endpoint table, final DTO examples, migration/preflight paths, test output summary, files changed, known risks, and the statement “backend not pushed”. It must not contain secrets or response bodies with personal athlete data.

- [ ] **Step 5: Record final repository status without pushing**

```powershell
Set-Location 后端服务器/wxcloudrun-springboot
git status --short --branch
```

Expected: clean nested backend worktree for planned source files and local commits not pushed. The sibling handoff and protocol documents remain available in `后端服务器/docs` for supervisor review and must not be forced into either Git repository.
