# Athlete Definition Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保证新运动员定义后仍保持0圈，定义时刻起不足8秒的同EPC重复检测静默，满8秒后才增加到1圈。

**Architecture:** 保留`DetectionController`现有运动员独立去重模型，仅在创建运动员记录时将`lastDetectedMs`设为`nowMs`、`hasDetectionTime`设为`true`。协议格式和主程序调度均不变。

**Tech Stack:** STM32 Arduino C++、C++ `assert`自测、Arduino CLI。

## Global Constraints

- 定义返回的初始圈数必须为0。
- 定义时刻是运动员8秒去重的起点。
- 不修改LoRa命令ID、Payload或响应顺序。
- 不修改普通EPC、黑名单或停止清理逻辑。

---

### Task 1: 修正运动员定义后的8秒边界

**Files:**
- Modify: `tests/DetectionControllerSelfTest/DetectionControllerSelfTest.cpp`
- Modify: `DetectionController.h`
- Modify: `LORAProtocol-byte.md`
- Modify: `docs/superpowers/specs/2026-08-14-temporary-athlete-list-design.md`

**Interfaces:**
- Consumes: `DefineResult DetectionController::defineEpc(bool, uint32_t, uint16_t, uint32_t, AthleteInfo&)`
- Produces: `EpcEvent DetectionController::evaluateEpc(uint32_t, uint32_t)`在定义后8秒内返回`Ignored`，第8000毫秒返回`Athlete`且圈数为1。

- [x] **Step 1: 写回归测试**

将定义后的旧“立即加圈”断言替换为：

```cpp
assert(controller.evaluateEpc(epc, definedAtMs).type == EpcEventType::Ignored);
assert(controller.evaluateEpc(epc, definedAtMs + 7999).type == EpcEventType::Ignored);
EpcEvent firstLap = controller.evaluateEpc(epc, definedAtMs + 8000);
assert(firstLap.type == EpcEventType::Athlete);
assert(firstLap.athlete.lapCount == 1);
```

- [x] **Step 2: 运行测试并确认按预期失败**

Run: 使用Visual Studio C++编译并执行`tests/DetectionControllerSelfTest/DetectionControllerSelfTest.cpp`。

Expected: 第一个定义后立即检测的断言失败，实际类型为`Athlete`而不是`Ignored`。

- [x] **Step 3: 写最小实现**

创建运动员记录时使用：

```cpp
athletes_[i] = {true, id, epc, 0, total, nowMs, true};
```

- [x] **Step 4: 同步文档**

说明定义时刻启动运动员8秒保护，删除“定义后第一次检测可以立即生效”的旧说明。

- [x] **Step 5: 验证**

Run:

```text
DetectionControllerSelfTest
LoraProtocolSelfTest
Arduino CLI compile for STMicroelectronics:stm32:GenF4:pnum=BLACK_F407VE
git diff --check
```

Expected: 两个自测返回0，完整固件编译返回0，`git diff --check`无输出。

- [x] **Step 6: 签入修复**

```text
git add DetectionController.h tests/DetectionControllerSelfTest/DetectionControllerSelfTest.cpp LORAProtocol-byte.md docs/superpowers/specs/2026-08-14-temporary-athlete-list-design.md docs/superpowers/plans/2026-08-15-athlete-definition-dedup.md
git commit -m "fix: protect newly defined athletes from duplicate reads"
```
