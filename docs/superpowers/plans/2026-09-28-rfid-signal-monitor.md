# RFID 信号监视工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建独立的 E720 RFID 信号监视桌面工具，实时显示原始标签与 RSSI 曲线。

**Architecture:** 新目录中的 Python/Tkinter 应用将协议解析、串口后台工作器、原始信号存储和用户界面分离。串口读线程把全部标签通知送入队列；主动模式另有 100ms 定时发送线程，被动模式则启动读写器的多次盘点。

**Tech Stack:** Python 3、Tkinter、pyserial、unittest。

**Spec:** `docs/superpowers/specs/2026-09-28-rfid-signal-monitor-design.md`

## Global Constraints

* 目标目录固定为 `D:\WorkProject\计时系统文件及备份\RFID信号监视`，不改动计时测试软件。
* 显示完整 EPC 和有符号 RSSI；不截取 EPC。
* 不实现名单、计时、8 秒去重或 RSSI 峰值结算。
* 主动模式固定每 100ms 发送 `BB 00 22 00 00 22 7E`。
* 折线图仅显示最近 60 秒数据，表格保留最新检测状态与累计次数。

## Review Focus

* 串口写入失败：停止轮询并把错误安全地传给界面；在 Task 3 增加工作器状态事件测试。
* 无标签响应：主动发送调度继续执行，界面不冻结；在 Task 3 增加空事件队列测试。
* 同一 EPC 高频重复：每条通知均累计并进入曲线；在 Task 2 增加连续相同 EPC 的测试。
* 多 EPC 同时出现：状态与样本不可互相覆盖；在 Task 2 增加两个 EPC 的隔离测试。
* 曲线超过 60 秒：仅移除过期样本，不移除表格最新标签；在 Task 2 增加边界时间测试。

---

## File Structure

* `D:\WorkProject\计时系统文件及备份\RFID信号监视\rfid_monitor\protocol.py`：E720 命令与完整 EPC 帧解析。
* `D:\WorkProject\计时系统文件及备份\RFID信号监视\rfid_monitor\signal_store.py`：原始通知的标签状态和 60 秒样本。
* `D:\WorkProject\计时系统文件及备份\RFID信号监视\rfid_monitor\serial_worker.py`：读线程、轮询控制与串口端口标注。
* `D:\WorkProject\计时系统文件及备份\RFID信号监视\rfid_monitor\app.py`：左右分栏 Tkinter 界面和 Canvas 图表。
* `D:\WorkProject\计时系统文件及备份\RFID信号监视\tests\`：各模块的 unittest 测试。
* `D:\WorkProject\计时系统文件及备份\RFID信号监视\run.py`、`requirements.txt`、`README.md`：启动与使用说明。

### Task 1: 协议模块

**Files:**
- Create: `...\rfid_monitor\protocol.py`
- Create: `...\tests\test_protocol.py`

**Interfaces:**
- Produces: `TagNotification(epc: str, rssi_dbm: int)`、`build_single_inventory_command() -> bytes`、`build_multi_inventory_command() -> bytes`、`build_stop_multi_inventory_command() -> bytes`、`E720FrameParser.feed(data: bytes) -> list[TagNotification]`。

- [ ] **Step 1: Write failing protocol tests**

```python
def test_builds_single_inventory_command():
    assert build_single_inventory_command() == bytes.fromhex("BB 00 22 00 00 22 7E")

def test_parses_full_epc_and_signed_rssi():
    assert parser.feed(frame)[0] == TagNotification("30751FEB705C5904E3D50D70", -55)
```

- [ ] **Step 2: Run the protocol tests and confirm failure**

Run: `python -B -m unittest tests.test_protocol -v`

- [ ] **Step 3: Implement protocol interfaces**

Parse E720 command `0x22` and `0x27` notification frames, preserving every EPC byte after the PC field and treating RSSI as signed 8-bit.

- [ ] **Step 4: Re-run the protocol tests and confirm pass**

- [ ] **Step 5: Commit the protocol task**

### Task 2: 原始信号存储

**Files:**
- Create: `...\rfid_monitor\signal_store.py`
- Create: `...\tests\test_signal_store.py`

**Interfaces:**
- Consumes: `TagNotification`。
- Produces: `SignalStore(window_seconds: float = 60.0)` with `record(notification: TagNotification, detected_at: float) -> None`, `rows() -> list[TagState]`, `series() -> dict[str, tuple[SignalSample, ...]]`。

- [ ] **Step 1: Write failing signal-store tests**

```python
def test_counts_every_repeated_notification_without_filtering():
    store.record(tag, 1.0); store.record(tag, 1.1)
    assert store.rows()[0].detection_count == 2

def test_drops_only_samples_older_than_sixty_seconds():
    store.record(tag, 0.0); store.record(tag, 60.1)
    assert store.series()[tag.epc] == (SignalSample(60.1, tag.rssi_dbm),)

def test_keeps_independent_rows_and_series_for_two_epcs():
    store.record(tag_a, 1.0); store.record(tag_b, 1.1)
    assert set(store.series()) == {tag_a.epc, tag_b.epc}
```

- [ ] **Step 2: Run the signal-store tests and confirm failure**

- [ ] **Step 3: Implement `SignalStore`**

Store the latest state and total count per EPC, appending every notification. Prune each series by `detected_at - window_seconds`; never prune the corresponding row.

- [ ] **Step 4: Re-run signal-store tests and confirm pass**

- [ ] **Step 5: Commit the signal-store task**

### Task 3: 串口工作器与两种轮询模式

**Files:**
- Create: `...\rfid_monitor\serial_worker.py`
- Create: `...\tests\test_serial_worker.py`

**Interfaces:**
- Consumes: protocol command constructors and parser.
- Produces: `SerialWorker` with `connect(port: str, baudrate: int)`, `start_active_inventory()`, `start_passive_inventory()`, `stop_inventory()`, `disconnect()`; `events` queue emits `("tag", (TagNotification, float))`, status and error events.

- [ ] **Step 1: Write failing worker tests**

```python
def test_active_mode_sends_single_inventory_at_one_hundred_ms_intervals():
    assert sent_commands == [SINGLE_COMMAND] * 3

def test_port_label_marks_cp210x_as_rfid_reader():
    assert "RFID芯片" in SerialPortInfo("COM6", "CP210x USB to UART Bridge").display_label

def test_write_failure_emits_an_error_event_and_stops_active_sending():
    worker.start_active_inventory()
    assert take_event(worker.events) == ("error", "串口写入失败：...")
```

- [ ] **Step 2: Run worker tests and confirm failure**

- [ ] **Step 3: Implement worker interfaces**

Use a `threading.Event`-controlled active sending loop with `wait(0.1)`, a separate continuous read loop, and a write lock. Passive start writes the documented multi-inventory command once; all stop/disconnect paths end active scheduling first.

- [ ] **Step 4: Re-run worker tests and confirm pass**

- [ ] **Step 5: Commit the worker task**

### Task 4: Tkinter 界面与折线渲染

**Files:**
- Create: `...\rfid_monitor\app.py`
- Create: `...\tests\test_chart.py`
- Create: `...\run.py`, `...\requirements.txt`, `...\README.md`

**Interfaces:**
- Consumes: `SerialWorker` events and `SignalStore` rows/series.
- Produces: `SignalMonitorApplication(tk.Tk)` and executable `run.py`.

- [ ] **Step 1: Write failing chart-projection tests**

```python
def test_projects_signal_samples_to_time_and_rssi_axes():
    assert project_series(samples, width=400, height=200) == expected_points
```

- [ ] **Step 2: Run chart tests and confirm failure**

- [ ] **Step 3: Implement interface and rendering**

Build a horizontal `PanedWindow`. Render controls and latest-tag table on the left; render 60-second time axis, dynamic RSSI range, legend and colored line series on the right. Drain queued events through `after`, update store/table/chart without a blocking call.

- [ ] **Step 4: Re-run chart tests and confirm pass**

- [ ] **Step 5: Run the complete test suite and application import check**

Run: `python -B -m unittest discover -s tests -v` and `python -B -c "import rfid_monitor.app"`.

- [ ] **Step 6: Commit the completed application**
