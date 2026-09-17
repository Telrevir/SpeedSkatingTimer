# Database-Generated Business IDs Design

## Goal

All business-resource create operations use database-generated primary keys. Create requests omit primary keys, and successful responses return the generated positive IDs. The sample `Counter` endpoint is outside this change.

## Scope

The rule covers `ClubTable`, `CoachTable`, `AthleteTable`, `AthleteGroupTable`, `AthleteGroupFormTable`, `ParentTable`, `RaceInfoTable`, `AthleteRaceJoinTable`, and `ScoreTable`.

`ClientRaceKey` and `ClientScoreKey` remain client-generated idempotency keys. They are not primary keys and must continue to survive retries and offline race recovery.

## Backend Contract

- Every create request must omit its primary-key field. A non-null supplied primary key is rejected with business code `400`.
- Every insert omits the primary-key column and uses MyBatis generated-key binding.
- Every successful create response contains the generated positive primary key.
- Aggregate creates generate parent IDs before child inserts. New group members and new race children omit IDs; replay/update may carry IDs for rows that already exist.
- `AthleteID` is an ordinary positive database-generated integer. It is independent from EPC and has no firmware-specific upper bound in this contract.

## Mini Program Contract

- Athlete create sends no `AthleteID`; the returned positive ID becomes the local cached athlete identity. `AthleteEPC` remains a separate field.
- Group create sends no `AthleteGroupID` or `AthleteGroupFormID`; the returned IDs become the local group identity and server mapping.
- Group update sends the existing group ID only as the path identity. Existing member IDs may be replayed; newly added members omit IDs.
- Race and score create continue to omit `RaceID`, join `id`, and `ScoreID`, while retaining client idempotency keys.
- Failed or malformed generated-ID receipts do not mutate the local cache.

## Database Deployment

The existing race identity migration must run first. The production error `Unknown column 'ClientRaceKey' in 'field list'` proves that migration has not been applied to the deployed database.

A new preflight script checks table existence, primary-key shape, foreign-key references, invalid IDs, and the athlete 16-bit limit without writing data. A separate migration changes the six remaining manually assigned primary keys to `AUTO_INCREMENT`, preserving existing IDs and foreign-key values.

Deployment order: backup, race preflight, race migration, generated-ID preflight, generated-ID migration, schema inspection, backend deployment, mini-program deployment.

## Verification Policy

This is a deployment-priority pass. Do not run shared database migrations automatically. Run compilation/type checks only; focused and full automated tests, disposable-database migration rehearsal, and end-to-end deployment checks remain explicit handoff work.
