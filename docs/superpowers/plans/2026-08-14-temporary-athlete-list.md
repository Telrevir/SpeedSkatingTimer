# Temporary Athlete List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-memory 50-athlete list, 50-EPC blacklist, independent 50-EPC ordinary dedup list, athlete timing/laps, and commands `0x10` through `0x14` to DetectOnly firmware.

**Architecture:** Extend `DetectionController` as the single owner of race time and all three fixed arrays. Keep `LoraManager` responsible only for validating/encoding protocol packets, and keep `SpeedSkatingTimer.ino` responsible for translating controller results into `0x12`, `0x14`, and `0xF0` responses.

**Tech Stack:** STM32 Arduino Core, C++17-compatible headers, fixed arrays, `arduino-cli`, ARM GCC compile-only self-tests.

## Global Constraints

- No local storage, TF-card access, database, dynamic allocation, athlete names, ranking, leader, or reset command.
- Athlete list, blacklist, and ordinary EPC dedup list each have exactly 50 slots and an `enabled` flag.
- `0x02` clears all temporary data.
- Ordinary EPCs and athletes each use an independent 8-second silent duplicate rule.
- The first athlete starts at lap 0 and total time 0; all athlete times share the first-athlete offset.
- Successful athlete definition responds with `0xF0` success before `0x12`.
- All multi-byte values are big-endian; athlete total time is uint24 centiseconds.
- Key code comments and all terminal error messages are Chinese.

---

### Task 1: Detection controller behavior

**Files:**
- Modify: `DetectionController.h`
- Modify: `tests/DetectionControllerSelfTest/DetectionControllerSelfTest.cpp`

**Interfaces:**
- Produces: `AthleteInfo { uint16_t id; uint8_t lapCount; uint32_t totalCentiseconds; }`.
- Produces: `DefineResult defineEpc(bool isAthlete, uint32_t epc, uint16_t id, uint32_t nowMs, AthleteInfo& info)`.
- Produces: `EpcEvent evaluateEpc(uint32_t epc, uint32_t nowMs)` with ignored, ordinary, athlete, state-error, and table-full results.
- Produces: `size_t athleteSlotCount() const` and `bool athleteAt(size_t slot, AthleteInfo& info) const` for `0x11` traversal.

- [ ] **Step 1: Replace the controller self-test with failing behavior tests**

```cpp
DetectionController controller;
AthleteInfo info{};
assert(controller.start(1000) == DetectResult::Accepted);
assert(controller.evaluateEpc(0x11111111, 1500).type == EpcEventType::Ordinary);
assert(controller.evaluateEpc(0x11111111, 9499).type == EpcEventType::Ignored);

assert(controller.defineEpc(true, 0x11111111, 1, 3500, info) ==
       DefineResult::AthleteDefined);
assert(info.id == 1 && info.lapCount == 0 && info.totalCentiseconds == 0);
EpcEvent firstLap = controller.evaluateEpc(0x11111111, 3500);
assert(firstLap.type == EpcEventType::Athlete);
assert(firstLap.athlete.lapCount == 1);
assert(firstLap.athlete.totalCentiseconds == 0);

assert(controller.defineEpc(true, 0x22222222, 2, 4500, info) ==
       DefineResult::AthleteDefined);
assert(info.totalCentiseconds == 100);
assert(controller.evaluateEpc(0x11111111, 11499).type == EpcEventType::Ignored);
assert(controller.evaluateEpc(0x11111111, 11500).type == EpcEventType::Athlete);

assert(controller.defineEpc(false, 0x33333333, 0, 5000, info) ==
       DefineResult::Blacklisted);
assert(controller.evaluateEpc(0x33333333, 6000).type == EpcEventType::Ignored);
```

- [ ] **Step 2: Compile the test and verify that the new interfaces are missing**

Run the ARM compiler against `tests/DetectionControllerSelfTest/DetectionControllerSelfTest.cpp`.

Expected: compilation fails because `AthleteInfo`, `DefineResult`, and `EpcEvent` are not defined.

- [ ] **Step 3: Implement three fixed 50-slot arrays and timing behavior**

```cpp
static constexpr size_t LIST_CAPACITY = 50;

struct AthleteEntry {
  bool enabled;
  uint16_t id;
  uint32_t epc;
  uint8_t lapCount;
  uint32_t totalCentiseconds;
  uint32_t lastDetectedMs;
  bool hasDetectionTime;
};

struct BlacklistEntry { bool enabled; uint32_t epc; };
struct RecentEpcEntry { bool enabled; uint32_t epc; uint32_t lastDetectedMs; };
```

Implement lookup priority as blacklist, athlete, ordinary. Defining an athlete or blacklist entry disables the matching ordinary entry. `start()` and `stop()` clear all `enabled` flags, time state, and athlete offset state.

- [ ] **Step 4: Compile the controller self-test**

Expected: ARM compilation succeeds and host execution succeeds when a host C++ compiler is available.

- [ ] **Step 5: Commit the controller task**

```text
git add DetectionController.h tests/DetectionControllerSelfTest/DetectionControllerSelfTest.cpp
git commit -m "feat: add temporary athlete controller"
```

### Task 2: Protocol constants and payload encoding

**Files:**
- Modify: `DetectProtocol.h`
- Modify: `tests/LoraProtocolSelfTest/LoraProtocolSelfTest.cpp`

**Interfaces:**
- Produces command constants `CMD_DEFINE_EPC`, `CMD_GET_ATHLETES`, `CMD_ATHLETE`, `CMD_ATHLETE_TRANSFER`, and `CMD_EPC` for IDs `0x10` through `0x14`.
- Produces `readUInt16BE`, `readUInt32BE`, `writeUInt16BE`, and existing `writeUInt24BE` helpers.
- Updates `isAppCommand()` to accept `0x01`, `0x02`, `0x03`, `0x10`, and `0x11` only.

- [ ] **Step 1: Add failing assertions for all new command IDs and byte order**

```cpp
static_assert(DetectProtocol::CMD_DEFINE_EPC == 0x10, "define ID changed");
static_assert(DetectProtocol::CMD_GET_ATHLETES == 0x11, "list ID changed");
static_assert(DetectProtocol::CMD_ATHLETE == 0x12, "athlete ID changed");
static_assert(DetectProtocol::CMD_ATHLETE_TRANSFER == 0x13, "transfer ID changed");
static_assert(DetectProtocol::CMD_EPC == 0x14, "EPC ID changed");
uint8_t value[] = {0x12, 0x34, 0x56, 0x78};
assert(DetectProtocol::readUInt16BE(value) == 0x1234);
assert(DetectProtocol::readUInt32BE(value) == 0x12345678UL);
```

- [ ] **Step 2: Compile and verify failure**

Expected: compilation fails on missing constants/helpers.

- [ ] **Step 3: Implement constants, helpers, and command whitelist**

`CMD_EPC` changes from `0x13` to `0x14`; `0x13` becomes athlete transfer state. Keep packet framing and checksum unchanged.

- [ ] **Step 4: Compile protocol self-test**

Expected: ARM compilation succeeds.

- [ ] **Step 5: Commit the protocol helper task**

```text
git add DetectProtocol.h tests/LoraProtocolSelfTest/LoraProtocolSelfTest.cpp
git commit -m "feat: define temporary athlete protocol"
```

### Task 3: LoRa receive/send support

**Files:**
- Modify: `LoraManager.h`

**Interfaces:**
- Changes handler to `void (*)(uint8_t commandId, const uint8_t* payload, uint8_t payloadLength)`.
- Produces `sendAthlete(const AthleteInfo&)`, `sendAthleteTransfer(bool started)`, and `sendDetectedEpc(uint32_t epc)`.
- Enforces Payload length 7 for `0x10` and length 0 for `0x01`, `0x02`, `0x03`, and `0x11`.

- [ ] **Step 1: Change the handler interface and command-specific length validation**

```cpp
typedef void (*DetectCommandHandler)(uint8_t commandId,
                                     const uint8_t* payload,
                                     uint8_t payloadLength);

uint8_t expectedLength(uint8_t commandId) {
  return commandId == DetectProtocol::CMD_DEFINE_EPC ? 7 : 0;
}
```

Call the handler synchronously with the validated payload.

- [ ] **Step 2: Implement exact outgoing payloads**

```text
0x12: ID[2] + lap[1] + total[3]
0x13: started[1]
0x14: EPC[4]
```

Remove the old seven-byte EPC-plus-time sender.

- [ ] **Step 3: Compile the full sketch to catch serial/API integration errors**

Run:

```text
arduino-cli compile --fqbn STMicroelectronics:stm32:GenF4:pnum=BLACK_F407VE --warnings all .
```

Expected: failure only where `SpeedSkatingTimer.ino` still uses the old callback/sender interfaces.

### Task 4: Main program integration

**Files:**
- Modify: `SpeedSkatingTimer.ino`

**Interfaces:**
- Consumes all Task 1 controller results and Task 3 LoRa send functions.
- Produces the visible command response ordering documented in `LORAProtocol-byte.md`.

- [ ] **Step 1: Parse `0x10` and send responses in the required order**

```cpp
bool isAthlete = payload[0] == 0x01;
uint32_t epc = DetectProtocol::readUInt32BE(payload + 1);
uint16_t id = DetectProtocol::readUInt16BE(payload + 5);
AthleteInfo info{};
DefineResult result = detectionController.defineEpc(isAthlete, epc, id,
                                                     millis(), info);
```

For `AthleteDefined`, send successful `0xF0` and only then `0x12`. For `Blacklisted`, send only successful `0xF0`. Reject flags other than `0x00` and `0x01` with the existing format status.

- [ ] **Step 2: Implement `0x11` traversal**

Send transfer start, every enabled athlete slot as `0x12`, then transfer end. Do not send a success `0xF0`.

- [ ] **Step 3: Route RFID events**

```cpp
EpcEvent event = detectionController.evaluateEpc(epc, millis());
if (event.type == EpcEventType::Ignored) return;
if (event.type == EpcEventType::Athlete) loraManager.sendAthlete(event.athlete);
if (event.type == EpcEventType::Ordinary) loraManager.sendDetectedEpc(epc);
```

The ignored path remains completely silent.

- [ ] **Step 4: Ensure `0x02` clears controller and RFID queue state**

Keep the existing state guard and success response, with `detectionController.stop()` clearing all three lists and offset state.

- [ ] **Step 5: Compile the complete sketch**

Expected: zero compile errors and warnings.

- [ ] **Step 6: Commit LoRa and main integration together**

```text
git add LoraManager.h SpeedSkatingTimer.ino
git commit -m "feat: integrate temporary athlete protocol"
```

### Task 5: Documentation, verification, and review

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `CurrentTask.md`
- Verify: `LORAProtocol-byte.md`
- Verify: `docs/superpowers/specs/2026-08-14-temporary-athlete-list-design.md`

**Interfaces:** None; this task validates the integrated firmware and records its final architecture.

- [ ] **Step 1: Update architecture and current-task documentation**

Document the three 50-slot arrays, command IDs `0x10` through `0x14`, shared athlete time offset, and the absence of persistent storage.

- [ ] **Step 2: Compile both self-test translation units**

Expected: both ARM compile commands succeed. Run host executables too if a host compiler is available.

- [ ] **Step 3: Run a clean full firmware compile**

```text
arduino-cli compile --fqbn STMicroelectronics:stm32:GenF4:pnum=BLACK_F407VE --warnings all --build-path <fresh-temp-path> .
```

Expected: exit code 0, no warnings, and memory usage safely below board limits.

- [ ] **Step 4: Run static consistency checks**

Verify exactly ten command IDs, three capacities of 50, no old `0x13` EPC sender, no storage/athlete legacy includes, no `String` or dynamic allocation in the new controller, and `git diff --check` success.

- [ ] **Step 5: Request code review and fix all important findings**

Review protocol byte order, response ordering, 8-second boundaries, first-athlete offset, stop clearing, array bounds, and silence paths.

- [ ] **Step 6: Commit final documentation/fixes**

```text
git add ARCHITECTURE.md CurrentTask.md <review-fix-files>
git commit -m "docs: finalize temporary athlete firmware"
```
