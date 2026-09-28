# RFID 历史导出与曲线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在停止检测时导出可还原曲线的 CSV，并提供独立的历史曲线浏览页。

**Architecture:** 导出模块将原始检测和聚合标记合并为稳定 CSV；历史模块读取同一格式并提供筛选、缩放与视口计算。Tkinter 界面将实时检测和历史曲线置于顶层标签页，曲线渲染逻辑复用现有投影函数。

**Tech Stack:** Python 3、Tkinter、csv、unittest。

**Spec:** `docs/superpowers/specs/2026-09-28-rfid-history-export-design.md`

## Global Constraints

* CSV 输出到 `D:\WorkProject\计时系统文件及备份\RFID信号监视`，使用 UTF-8 with BOM。
* CSV 必须包含所有原始检测及开始、停止、截取标签。
* 历史页不影响 RFID 实时连接。
* 历史曲线默认 15 秒/格，4 格可视；缩放范围 0.1-3600 秒/格。

## Review Focus

* 同点多标签必须以 `；` 合并，Task 1 测试。
* 没有检测时停止不能创建空 CSV，Task 1 测试。
* 非本软件 CSV 须给出可理解的错误，Task 2 测试。
* EPC 筛选为空时应显示无曲线而非崩溃，Task 2 测试。
* 滚动与缩放不得越过数据或缩放边界，Task 2 测试。

---

### Task 1: CSV 导出模型

**Files:**
- Create: `D:\WorkProject\计时系统文件及备份\RFID信号监视\rfid_monitor\history_io.py`
- Create: `D:\WorkProject\计时系统文件及备份\RFID信号监视\tests\test_history_io.py`

**Interfaces:**
- Produces: `export_history(root: Path, samples, starts, stops, markers) -> Path | None` and `HistoryPoint`.

- [ ] Write failing tests for BOM headers, original detections, merged labels and no-data result.
- [ ] Run `python -B -m unittest tests.test_history_io -v` and confirm failure.
- [ ] Implement CSV export with timestamp filename and five specified columns.
- [ ] Re-run the test and confirm pass.

### Task 2: 历史数据与视口

**Files:**
- Modify: `...\rfid_monitor\history_io.py`
- Create: `...\rfid_monitor\history_view.py`
- Create: `...\tests\test_history_view.py`

**Interfaces:**
- Produces: `load_history(path: Path) -> list[HistoryPoint]`, `HistoryViewport` with EPC filter, horizontal offset and bounded unit zoom.

- [ ] Write failing parser/filter/scroll/zoom-boundary tests.
- [ ] Run `python -B -m unittest tests.test_history_view -v` and confirm failure.
- [ ] Implement validated CSV load and pure view calculations.
- [ ] Re-run tests and confirm pass.

### Task 3: 实时导出与历史页面

**Files:**
- Modify: `...\rfid_monitor\app.py`
- Modify: `...\tests\test_chart.py`

**Interfaces:**
- Consumes: Task 1 export and Task 2 history view interfaces.
- Produces: top-level “实时检测” and “历史曲线” pages.

- [ ] Write failing tests for history curve selection and wheel unit adjustment.
- [ ] Run focused tests and confirm failure.
- [ ] Add stop-time export, history file chooser, EPC selector, X-axis control, scroll bar and mouse-wheel zoom.
- [ ] Run `python -B -m unittest discover -s tests -v` and application import check.
