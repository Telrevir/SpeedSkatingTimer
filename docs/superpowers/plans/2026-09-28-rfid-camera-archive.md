# RFID 摄像头归档与照片回放 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将每次 RFID 检测关联最近摄像头帧，导出包含 CSV 和去重 JPEG 的 `.ttp` 包，并在历史曲线中悬停查看照片。

**Architecture:** 新增后台 `CameraWorker` 持续获取最新帧；运行记录只保存去重帧的 JPEG 字节和引用 ID。历史 I/O 将 `.ttp` 作为 ZIP 容器读写，历史视图以点的照片 ID 完成悬停命中，Tk 页面负责相机控件、图像显示与临时目录清理。

**Tech Stack:** Python 3、Tkinter、OpenCV、Pillow、zipfile、csv、json、unittest。

**Spec:** `docs/superpowers/specs/2026-09-28-rfid-camera-archive-design.md`

## Global Constraints

* 每条 RFID 原始记录都必须保留，照片 ID 可以引用相同帧。
* `.ttp` 为 ZIP 包，包含 UTF-8 BOM `history.csv`、`manifest.json` 和 `images/` JPEG。
* 默认照片 640×480、JPEG 质量 55；编码与取流不得阻塞串口或 Tk 主线程。
* 无可用摄像头/画面时，RFID 与导出继续工作，照片 ID 留空。
* 历史页兼容旧 CSV，并在照片缺失时显示无照片状态。

## Review Focus

* 高频 RFID 同帧命中：每条 CSV 行存在且只写一个 JPEG；Task 2 测试。
* `.ttp` 损坏、缺少 `history.csv`、格式版本错误：应给出可理解错误；Task 3 测试。
* 无照片点悬停：不得显示上一点照片；Task 4 测试。
* 摄像头打开失败或断开：实时 RFID 仍可继续；Task 1 测试。
* 筛选、缩放、滚动后的悬停：返回的照片必须属于当前可见点；Task 4 测试。

---

### Task 1: 摄像头后台工作器

**Files:**
- Create: `D:\WorkProject\计时系统文件及备份\RFID信号监视\rfid_monitor\camera_worker.py`
- Modify: `D:\WorkProject\计时系统文件及备份\RFID信号监视\requirements.txt`
- Create: `D:\WorkProject\计时系统文件及备份\RFID信号监视\tests\test_camera_worker.py`

**Interfaces:**
- Produces: `CameraFrame(frame_id: int, captured_at: float, jpeg: bytes)` and `CameraWorker.list_cameras()`, `start(index, quality=55, size=(640, 480))`, `latest_frame()`, `stop()`.

- [ ] Write failing tests using a fake capture object: latest frame increments its ID, encodes once as JPEG, and open/read errors produce a readable status rather than raising to RFID code.
- [ ] Run `python -B -m unittest tests.test_camera_worker -v` and confirm failure.
- [ ] Implement `CameraWorker` with a daemon capture thread, thread-safe latest-frame snapshot and status event queue; add `opencv-python` and `Pillow` dependencies.
- [ ] Re-run the camera-worker tests and confirm pass.
- [ ] Commit: `feat: add nonblocking camera worker`.

### Task 2: 运行照片池与 `.ttp` 导出

**Files:**
- Modify: `D:\WorkProject\计时系统文件及备份\RFID信号监视\rfid_monitor\history_io.py`
- Modify: `D:\WorkProject\计时系统文件及备份\RFID信号监视\tests\test_history_io.py`

**Interfaces:**
- Consumes: `CameraFrame` from Task 1.
- Produces: `HistoryPoint(..., photo_id: str = "")`, `RunHistory.record(..., photo_id="")`, `PhotoPool.add(frame: CameraFrame) -> str`, `export_ttp(root: Path, points, photos, camera_settings) -> Path | None`.

- [ ] Write failing tests for BOM CSV with `照片ID`, duplicate-frame reuse, ZIP member layout, JSON version/camera settings and empty-run `None` behavior.
- [ ] Run `python -B -m unittest tests.test_history_io -v` and confirm failure.
- [ ] Implement point photo IDs, a per-run de-duplicating `PhotoPool`, and atomic `.ttp` ZIP export with `history.csv`, `manifest.json`, and `images/frame_*.jpg`.
- [ ] Re-run history-I/O tests and confirm pass.
- [ ] Commit: `feat: export RFID history as camera archive`.

### Task 3: 历史包读取与照片命中模型

**Files:**
- Modify: `D:\WorkProject\计时系统文件及备份\RFID信号监视\rfid_monitor\history_io.py`
- Modify: `D:\WorkProject\计时系统文件及备份\RFID信号监视\rfid_monitor\history_view.py`
- Modify: `D:\WorkProject\计时系统文件及备份\RFID信号监视\tests\test_history_io.py`
- Modify: `D:\WorkProject\计时系统文件及备份\RFID信号监视\tests\test_history_view.py`

**Interfaces:**
- Produces: `LoadedHistory(points, images, cleanup)`, `load_history(path) -> LoadedHistory`, `HistoryViewport.nearest_point(seconds, rssi, tolerance) -> HistoryPoint | None`.

- [ ] Write failing tests for `.ttp` extraction/readback, legacy CSV readback, invalid ZIP/version/missing CSV errors, and nearest visible point selection.
- [ ] Run the focused history I/O/view tests and confirm failure.
- [ ] Implement temporary-directory extraction with `cleanup()`, validated manifest/member paths, legacy CSV adaptation, and pure nearest-point hit testing limited to current filter/viewport.
- [ ] Re-run focused tests and confirm pass.
- [ ] Commit: `feat: load camera archives for history replay`.

### Task 4: 实时关联、历史照片面板与曲线点

**Files:**
- Modify: `D:\WorkProject\计时系统文件及备份\RFID信号监视\rfid_monitor\app.py`
- Modify: `D:\WorkProject\计时系统文件及备份\RFID信号监视\tests\test_chart.py`

**Interfaces:**
- Consumes: `CameraWorker`, `PhotoPool`, `export_ttp`, `LoadedHistory`, and `HistoryViewport.nearest_point`.
- Produces: camera UI controls; `.ttp` stop export; 1:5:2 history settings/curve/photo layout; hover photo display.

- [ ] Write failing pure tests for the point-marker display choice (labelled versus colour-only) and hover selection returning no image for an empty photo ID.
- [ ] Run focused chart tests and confirm failure.
- [ ] Add camera selection, enable switch, JPEG quality control and nonblocking worker event handling. On each accepted RFID event, add the latest frame to `PhotoPool` and store its ID.
- [ ] Replace stop-time CSV export with `.ttp` export, preserving the no-data result and reporting its filename.
- [ ] Update history selection to open `.ttp` or legacy CSV; render all data points, bind canvas motion to nearest-point selection, and update/reset the right photo panel with `PIL.ImageTk.PhotoImage`.
- [ ] Call cleanup when another history file is loaded and when the application closes; stop the camera worker on close.
- [ ] Run `python -B -m unittest discover -s tests -v` and an application import check; confirm pass.
- [ ] Commit: `feat: show RFID-linked camera photos in history`.
