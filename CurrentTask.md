# Current Task

本文件只记录当前任务状态、待完成事项和已取消事项。系统架构、模块职责、硬件连接、数据流和协议背景见 `ARCHITECTURE.md`、`LORAProtocol.txt`、`RFIDPollingNotes.md`。



## 已完成

* 已移除 `SpeedSkatingTimer.ino` 中 Web/WiFi/JSON/LittleFS 相关运行逻辑。
* 已将 LoRa 初始化、发送函数和运动员/领跑/扫描 EPC 数据发送逻辑集成到主流程。
* 已根据 STM32 硬件接线修正 RFID 串口引脚为 `PC7/PC6`，LoRa 串口为 `PA3/PA2`，AUX 为 `PA1`。
* 已添加 LoRa 命令接收协议代码，支持 `COMMAND_START`、`COMMAND_SCAN`、`COMMAND_STOP`、`COMMAND_ADD`、`COMMAND_REMOVE`、`COMMAND_BIND`、`COMMAND_LIST`。
* 已新增并维护 `LORAProtocol.txt` 作为 LoRa 通信协议文档。
* 已将 LoRa 的读/写方法和命令生成代码整理到 `LoraManager.h`，并在主文件中更新调用。
* 已在接收到 `COMMAND_ADD`、`COMMAND_REMOVE`、`COMMAND_BIND`、`COMMAND_LIST` 后通过 LoRa 发送对应回复。
* 已将存储方案替换为 TF 卡 SDIO 文件存储方案，并保留 `StorageManager` 对外接口。
* 已确认 `STM32SD` 环境不支持 `SD.rename()`，并将保存流程改为备份旧主文件、直接写主文件与失败恢复方案。
* 已新增 `StorageManager` 姓名字段十六进制存储方案，保存时将姓名 UTF-8 字节转为十六进制，读取时还原。
* 已新增运动员自动 ID 分配功能：串口 `ADD,name,epc` 和 LoRa `COMMAND_ADD;<运动员姓名>;<EPC>` 均不再输入 ID。
* 已根据实机测试反馈将 RFID 主流程恢复为单次轮询模式：`START`/`SCAN` 使用 `startInventory()`，主循环调用 `receiveTag()`。
* 已新增 `ARCHITECTURE.md`，整理当前项目架构、模块职责、数据流和边界。
* 已优化 `StorageManager::loadAthletes()`：读取 `athletes.csv` 时先加载到临时 `AthleteManager`，确认存在有效运动员后才清空并替换正式内存数据。
* 已加强 `StorageManager` 文件格式校验：`athletes.csv` 每行严格校验为 `<ID>;<NAME_HEX>;<EPC>` 三段，拒绝额外分号、空字段、非法 ID、非法姓名 HEX 和非法 EPC。
* 已在保存运动员数据前检查 `id`、`name`、`epc`，字段为空、包含分号/换行或格式非法时取消写入，避免破坏 CSV 分号分隔格式。
* 已完成 RFID 通知帧读取逻辑优化验证：`receiveTag()` 和 `receiveTagMultiInventory()` 已共用基于帧头 `0xBB` 与参数长度字段计算完整帧长度的解析函数。
* 已完成 LoRa 字节规范协议首轮验证：新增字节包收发、checksum 校验、基础命令解析、成绩/领滑/运动员信息/列表状态/通用回复字节发送。
* 已完成串口调试命令 `LORA,<hex bytes>` 验证：可将逗号后的十六进制字节转发给 LoRa 字节包解析函数，用于模拟 LoRa 接收字节包。
* 已完成运动员排名字段和排名刷新逻辑验证：`0x02` 运动员成绩包已追加 `byte9` 排名字段。
* 已完成比赛状态机与领滑结束收尾流程验证：新增未开始、等待运动员、进行中、领滑结束状态，新增 `0x07/0x08` 比赛状态查询/返回，`START`、`STOP`、`RESET` 已接入状态切换和状态通知。



## 待完成

* 添加 LoRa 字节命令 `0x12` 扫描添加运动员功能：接收到运动员姓名后保存为待添加姓名，进入扫描模式，扫描到第一个未绑定 EPC 后停止扫描，自动生成 ID 并添加运动员，保存到 TF 卡后返回通用状态码。
* 添加运动员失败原因细分并返回到蓝牙：添加运动员失败时不再统一返回 `DUPLICATE_OR_FULL`，应区分运动员数量已满、ID 已存在、EPC 已存在，并通过 LoRa 返回给 ESP32，由 ESP32 蓝牙链路转发给上位机/App。
* 添加比赛成绩 CSV 保存功能：比赛开始后检查 TF 卡中是否存在 `Score` 文件夹，不存在则创建；为本次比赛创建 16 位数字命名的成绩文件，若已有文件则按最后一个有效文件名数字加 1，否则使用 `0000000000000000.csv`；每次运动员成绩刷新时，将该运动员姓名、EPC、圈数、本圈时长、总时长写入本次比赛成绩 CSV 文件。



## 待验证

* 暂无。



## 已取消

* 取消确认当前 STM32 开发板 variant 是否已经正确配置 SDIO 引脚 `PC8-PC12/PD2`；暂不将该项作为代码任务继续跟进。
* 取消 `LoraManager` 发送缓存区与 `\x1E` 批量合并发送方案。进一步测试发现 LoRa 发送耗时与包长度强相关：约 13 字节数据包耗时约 `40-70ms`，约 59 字节数据包耗时约 `70-100ms`；当前结果符合项目需求，后续优先通过压缩协议长度优化。
* 取消“LoRa 文本发送数据包去掉字段名、仅用分号分隔”的后续改造项；后续直接推进字节规范协议，不再继续压缩旧文本协议格式。
* 取消“运动员可绑定多个不同标签 / 独立 EPC 绑定表”改造项：计划已变更，相关代码与文档改动已撤回，当前仍保持单运动员单 EPC 存储与识别。
* 取消“调整领滑信息单圈计时”改造项：当前 `0x06` 领滑返回协议已包含领滑运动员总用时，App 可缓存上一条领滑信息并用新旧总用时差值计算领滑间隔，STM32 侧暂不新增变量、不扩展协议字段。



## 文档分工

* `ARCHITECTURE.md`：当前系统架构、模块职责、硬件连接和数据流。
* `LORAProtocol.txt`：LoRa 通信协议。
* `RFIDPollingNotes.md`：RFID 单次轮询与多次轮询模式说明。
* `CurrentTask.md`：当前任务状态和待办。
