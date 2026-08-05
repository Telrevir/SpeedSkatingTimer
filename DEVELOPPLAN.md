# 开发计划

本文档记录当前待开发功能的具体实现计划。任务状态仍以 `CurrentTask.md` 为准。



## 比赛成绩 CSV 保存功能

### 一、需求目标

比赛开始后，系统需要在 TF 卡中为本场比赛创建一个独立的 CSV 成绩文件。比赛过程中，每次运动员成绩刷新时，将该运动员的姓名、EPC、圈数、本圈时长、总时长写入本场成绩文件。

成绩文件统一保存在：

```text
Score
```

文件名使用固定 16 位数字加 `.csv` 后缀：

```text
0000000000000000.csv
0000000000000001.csv
0000000000000002.csv
```



### 二、文件名规则

比赛开始时执行以下逻辑：

1. 检查 TF 卡是否已经初始化。
2. 检查 `Score` 文件夹是否存在。
3. 如果 `Score` 不存在，则创建 `Score` 文件夹。
4. 扫描 `Score` 文件夹中的文件。
5. 只识别符合以下格式的文件：

```text
16位数字.csv
```

例如：

```text
0000000000000000.csv
0000000000000001.csv
9999999999999999.csv
```

6. 如果没有任何有效成绩文件，则创建：

```text
Score/0000000000000000.csv
```

7. 如果存在有效成绩文件，则取文件名数字最大的文件作为“最后一个文件”，将其数字加 1，并左侧补零到 16 位。

示例：

```text
已有 0000000000000000.csv -> 新建 0000000000000001.csv
已有 0000000000000009.csv -> 新建 0000000000000010.csv
已有 0000000000012345.csv -> 新建 0000000000012346.csv
```

说明：不直接依赖 TF 卡目录枚举顺序。实装时用“文件名数字最大值”定义最后一个有效成绩文件，避免不同文件系统返回顺序不稳定。

边界处理：

```text
9999999999999999.csv
```

如果已经达到最大值，则创建新文件失败，串口输出错误，但比赛计时主流程不应被阻断。



### 三、CSV 内容格式

文件创建成功后，先写入表头：

```text
name,epc,lap,lastLapTime,totalTime
```

每次成绩刷新追加一行：

```text
运动员姓名,EPC,圈数,本圈时长,总时长
```

示例：

```text
name,epc,lap,lastLapTime,totalTime
张三,3333F337,1,42150,42150
张三,3333F337,2,40580,82730
李四,12345678,1,43300,43300
```

时间字段第一版使用毫秒整数保存：

```text
lastLapTime  本圈时长，单位 ms
totalTime    总时长，单位 ms
```

这样可以避免小数、中文单位或时间格式化造成解析歧义。后续如果 App 需要展示格式，可以在 App 侧转换为 `mm:ss.SS`。



### 四、CSV 字段转义

运动员姓名可能包含逗号、双引号或换行，因此写入 CSV 前需要转义。

计划在 `StorageManager.h` 中新增：

```cpp
String escapeCsvField(const String& value);
```

规则：

1. 如果字段不包含逗号、双引号、`\r`、`\n`，原样写入。
2. 如果字段包含特殊字符，使用双引号包裹整个字段。
3. 字段内部的双引号写成两个双引号。

示例：

```text
张三 -> 张三
张,三 -> "张,三"
张"三 -> "张""三"
```

EPC、圈数和时间字段理论上不需要转义，但统一按字段写入流程处理更稳。



### 五、StorageManager 修改计划

修改文件：

```text
StorageManager.h
```

新增私有常量：

```cpp
static constexpr const char* SCORE_DIR = "Score";
static constexpr const char* SCORE_FILE_EXT = ".csv";
```

新增私有状态：

```cpp
String currentScoreFilePath;
bool scoreFileReady;
unsigned long scoreRecordCount;
```

新增私有辅助函数：

```cpp
bool ensureScoreDirectory();
bool isValidScoreFileName(const String& filename);
bool isGreaterScoreFileName(const String& left, const String& right);
bool incrementScoreFileName(const String& filename, String& nextFilename);
String buildScoreFilePath(const String& filename);
bool writeScoreHeader(const char* filename);
String escapeCsvField(const String& value);
```

新增公开接口：

```cpp
bool beginRaceScoreFile();
bool appendRaceScore(const Athlete* athlete, unsigned long lastLapTime);
void closeRaceScoreFile();
bool isRaceScoreFileReady();
unsigned long getScoreRecordCount();
```

接口行为：

```text
beginRaceScoreFile()
  创建 Score 文件夹
  扫描已有 16 位数字 CSV 文件
  生成本场文件名
  创建 CSV 文件并写入表头
  设置 currentScoreFilePath 和 scoreFileReady

appendRaceScore()
  如果 scoreFileReady 为 false，直接返回 false
  如果 athlete 为空，返回 false
  打开 currentScoreFilePath
  追加一行 CSV 数据
  flush + close
  scoreRecordCount++

closeRaceScoreFile()
  清理 currentScoreFilePath、scoreFileReady 等运行状态
```

说明：第一版每次追加时打开文件、写入、关闭。这样写入次数会多一些，但断电风险更低，也更符合当前项目保守优先的存储风格。



### 六、SpeedSkatingTimer 接入计划

修改文件：

```text
SpeedSkatingTimer.ino
```

新增函数声明：

```cpp
void beginRaceScoreStorage();
void appendRaceScoreIfNeeded(const Athlete* athlete);
```

### 1. 比赛开始时创建成绩文件

接入位置：

```text
LoRa COMMAND_START
串口 START
```

在以下逻辑之后调用：

```cpp
timingLogic.startRace();
```

计划调用：

```cpp
beginRaceScoreStorage();
```

处理原则：

```text
成绩文件创建失败时，不阻断比赛开始。
通过串口输出错误提示。
后续成绩刷新时如果文件未准备好，则跳过 CSV 写入。
```

### 2. 成绩刷新时追加 CSV

接入位置：

```text
processDetectedTag()
```

现有刷新链路：

```text
processDetectedTag()
  -> timingLogic.recordLap(shortEPC)
  -> 重新获取 athlete
  -> sendAthleteDataLora(athlete)
```

计划新增：

```text
timingLogic.recordLap(shortEPC) 成功后
  -> getLastLapTime(athlete)
  -> storageManager.appendRaceScore(athlete, lastLapTime)
```

推荐放置在 LoRa 发送前后均可。为了让本地文件和 LoRa 数据都基于同一个更新后的 athlete，建议放在重新获取 athlete 之后：

```cpp
athlete = athleteManager.getAthleteByEPC(shortEPC);
appendRaceScoreIfNeeded(athlete);
sendAthleteDataLora(athlete);
```

首次检测时 `lapCount` 可能为 0，`lastLapTime` 记录为 0。

### 3. 比赛停止与重置

`STOP` 进入领滑结束状态时，不关闭成绩文件。因为领滑结束阶段其他运动员仍会继续刷新成绩。

以下情况关闭当前成绩文件状态：

```text
RESET
resetRaceData()
领滑结束超过 5 分钟后彻底停止计时和 RFID
```

关闭含义是清理运行状态，不删除已经生成的 CSV 文件。



### 七、与现有存储功能的边界

该功能只新增比赛成绩记录，不改变现有运动员信息保存格式。

不修改：

```text
athletes.csv
athletes_bak.csv
athletes_tmp.csv
```

新增：

```text
Score/0000000000000000.csv
Score/0000000000000001.csv
...
```

现有运动员资料链路保持不变：

```text
AthleteManager -> StorageManager -> TF 卡 athletes.csv
```

新增成绩保存链路：

```text
RFID 读取 -> processDetectedTag -> TimingLogic::recordLap -> StorageManager::appendRaceScore -> TF 卡 Score/*.csv
```



### 八、错误处理计划

### 1. TF 卡未初始化

`beginRaceScoreFile()` 返回 false，串口提示：

```text
[Storage] 比赛成绩文件创建失败: TF卡未初始化
```

比赛继续运行。

### 2. Score 文件夹创建失败

返回 false，串口提示：

```text
[Storage] Score 文件夹创建失败
```

比赛继续运行。

### 3. 文件名达到最大值

如果最大有效文件名为：

```text
9999999999999999.csv
```

则返回 false，串口提示：

```text
[Storage] 成绩文件编号已达到最大值
```

### 4. 单次成绩写入失败

只打印错误，不影响计时和 LoRa 发送。

```text
[Storage] 成绩写入失败
```



### 九、验证计划

### 1. 空 Score 文件夹

条件：

```text
Score 不存在或 Score 中无有效成绩文件
```

预期：

```text
创建 Score
创建 Score/0000000000000000.csv
写入 CSV 表头
```

### 2. 已有成绩文件

条件：

```text
Score/0000000000000000.csv
Score/0000000000000001.csv
```

预期：

```text
新建 Score/0000000000000002.csv
```

### 3. 忽略无效文件名

条件：

```text
Score/test.csv
Score/abc.csv
Score/0000000000000003.txt
Score/0000000000000004.csv
```

预期：

```text
只识别 0000000000000004.csv
新建 0000000000000005.csv
```

### 4. 成绩刷新写入

条件：

```text
比赛开始
运动员 RFID 被有效识别
timingLogic.recordLap() 返回 true
```

预期 CSV 内容类似：

```text
name,epc,lap,lastLapTime,totalTime
张三,3333F337,0,0,0
张三,3333F337,1,42150,42150
```

### 5. 领滑结束阶段

条件：

```text
STOP 后进入领滑结束
其他运动员继续达到目标圈数
```

预期：

```text
仍继续追加成绩行
直到 RESET 或 5 分钟超时彻底停止
```



### 十、文档同步计划

代码完成后需要同步：

```text
CurrentTask.md
ARCHITECTURE.md
```

`CurrentTask.md`：从待完成移动到待验证。

`ARCHITECTURE.md`：补充 `Score` 文件夹、16 位数字成绩文件、成绩刷新写入链路。

如果后续 App 需要读取该 CSV 格式，再单独补充 App 侧读取协议或文件格式文档。



## 领滑信息单圈计时改造（已取消）

本项已取消，不作为当前待完成任务执行。取消原因：当前字节协议 `0x06` 返回领滑运动员信息时已经包含领滑运动员总用时，外部 App 可以缓存上一条领滑信息，并使用新旧领滑总用时差值计算领滑间隔。因此 STM32 侧暂不新增最大圈数/领滑时长变量，也不扩展领滑返回协议字段。

以下内容仅作为历史方案参考。

### 一、需求目标

领滑信息中的“单圈计时”不再表示领滑运动员个人最近一圈用时，而是表示：

```text
当前/新领滑者本次过圈时间 - 上一个领滑者对应过圈时间
```

该时间用于描述领滑节奏间隔。运动员个人成绩中的本圈时长保持原逻辑，不受本需求影响。



### 二、当前代码状态

当前已发现的相关代码位置：

```text
TimingLogic.h
SpeedSkatingTimer.ino
LoraManager.h
LORAProtocol.txt
LORAProtocol-byte.md
```

`TimingLogic.h` 中已有 `getLeaderLastLapTime()`，其注释和内部逻辑已经接近本需求：使用上一圈领滑运动员通过计时点的时间，与当前圈领滑运动员通过计时点的时间做差。

`SpeedSkatingTimer.ino` 中 `getLastLapTime(const Athlete* athlete)` 仍然是运动员个人本圈用时，当前通过 `loraManager.begin(..., getLastLapTime)` 提供给 LoRa 层。

`LoraManager.h` 中：

```cpp
buildLeaderMessage()
```

仍使用：

```cpp
LAST_LAP=getLapTime(leader)
```

这会把领滑者个人最近单圈写入文本领滑包，需改为领滑间隔。

字节协议 `0x06` 当前只包含：

```text
byte0-byte1：领滑运动员 ID
byte2：圈数
byte3-byte5：总用时，uint24 百分秒
```

尚未包含领滑间隔字段，需要扩展。



### 三、代码修改计划

### 1. 明确 TimingLogic 的领滑间隔接口

修改文件：

```text
TimingLogic.h
```

计划新增或重命名接口：

```cpp
unsigned long getLeaderPassInterval();
```

行为：

```text
无当前领滑者 -> 返回 0
当前领滑者未完成有效圈数 -> 返回 0
找到上一圈/上一轮领滑者 -> 使用当前领滑过圈时间减去上一领滑过圈时间
第一圈且无上一圈领滑者 -> 使用当前领滑者 startTime 到当前过圈时间的差值
时间戳缺失或异常 -> 返回 0
```

处理原则：

```text
保留 getLeaderLastLapTime() 作为兼容包装时，内部直接调用 getLeaderPassInterval()
后续新代码优先调用 getLeaderPassInterval()
注释统一改为“领滑过圈间隔”，避免继续称为个人单圈
```

### 2. 区分 LoRa 的运动员本圈用时与领滑间隔

修改文件：

```text
LoraManager.h
SpeedSkatingTimer.ino
```

计划保留现有运动员个人本圈用时回调：

```cpp
LoraLapTimeProvider lapTimeProvider;
```

该回调继续只服务于：

```text
0x02 运动员成绩
TYPE=ATHLETE_DATA
```

领滑数据不再通过 `getLapTime(leader)` 间接取值，而由主流程显式传入：

```cpp
void sendLeaderData(const Athlete* leader, unsigned long leaderPassInterval);
```

如需保留旧函数签名，可增加兼容重载：

```cpp
void sendLeaderData(const Athlete* leader);
```

但主流程和查询领滑命令应改用带 `leaderPassInterval` 的新接口。

### 3. 更新主流程领滑发送

修改文件：

```text
SpeedSkatingTimer.ino
```

计划新增缓存字段：

```cpp
unsigned long lastLeaderPassInterval = 0;
```

修改领滑发送函数：

```cpp
void sendLeaderDataLoraIfChanged(const Athlete* leader)
```

调整为：

```text
1. leader 为空则返回
2. 调用 timingLogic.getLeaderPassInterval()
3. 比较 leader id、lapCount、totalTime、leaderPassInterval
4. 任一字段变化则发送领滑包
5. 更新缓存
```

LoRa `COMMAND_LEADER` 查询当前领滑时也应计算：

```cpp
unsigned long leaderPassInterval = timingLogic.getLeaderPassInterval();
loraManager.sendLeaderData(leader, leaderPassInterval);
```

重置比赛数据时同步清空：

```cpp
lastLeaderPassInterval = 0;
```

### 4. 更新 LoraManager 领滑发送字段

修改文件：

```text
LoraManager.h
```

文本协议构造计划：

```cpp
String buildLeaderMessage(const Athlete* leader, unsigned long leaderPassInterval);
```

字段建议保持原位置兼容：

```text
LAST_LAP=<领滑过圈间隔毫秒>
```

说明：字段名可暂时保留 `LAST_LAP`，但文档必须明确它在 `TYPE=LEADER` 中表示领滑间隔，不再表示个人最近单圈。若 App 侧允许同步升级，也可以后续改名为 `LEADER_INTERVAL`。

字节协议 `0x06` 扩展计划：

```text
byte0-byte1：领滑运动员 ID
byte2：圈数
byte3-byte5：总用时，uint24 百分秒
byte6-byte8：领滑过圈间隔，uint24 百分秒
```

对应代码：

```cpp
byte payload[9];
writeUInt16BE(payload, index, parseAthleteId(leader->id));
payload[index++] = (byte)leader->lapCount;
writeUInt24BE(payload, index, toCentiseconds(leader->totalTime));
writeUInt24BE(payload, index, toCentiseconds(leaderPassInterval));
sendPacket(CMD_LEADER_RESULT, payload, index);
```

### 5. 更新协议文档

修改文件：

```text
LORAProtocol.txt
LORAProtocol-byte.md
```

`LORAProtocol.txt`：

```text
TYPE=LEADER ... LAST_LAP=<领滑过圈间隔毫秒>
```

并补充说明：

```text
运动员成绩中的 LAST_LAP 表示该运动员个人本圈用时。
领滑信息中的 LAST_LAP 表示上一个领滑者到当前/新领滑者的过圈间隔。
```

`LORAProtocol-byte.md`：

```text
0x06 byte6-byte8：领滑过圈间隔，uint24 百分秒
```



### 四、验证计划

### 1. 第一位领滑者完成第一圈

条件：

```text
当前领滑者 startTime = 10000
当前领滑者第一圈过圈 timestamp = 52000
```

预期：

```text
leaderPassInterval = 42000
```

### 2. 新领滑者接替

条件：

```text
上一圈领滑者过圈 timestamp = 52000
当前/新领滑者过圈 timestamp = 93000
```

预期：

```text
leaderPassInterval = 41000
```

### 3. 领滑者不变

条件：

```text
上一圈领滑者和当前领滑者为同一运动员
上一圈过圈 timestamp = 52000
当前圈过圈 timestamp = 93000
```

预期：

```text
leaderPassInterval = 41000
```

此时计算结果等价于该领滑者个人单圈，但语义仍按“上一领滑过圈到当前领滑过圈的间隔”理解。

### 4. 协议发送检查

验证内容：

```text
TYPE=LEADER 中 LAST_LAP 数值为 leaderPassInterval
0x06 的 byte6-byte8 为 leaderPassInterval 转换后的百分秒
0x02 运动员成绩中的 byte3-byte5 仍是个人本圈用时
```



### 五、主要风险与处理


## 添加运动员错误信息细分与蓝牙返回

### 一、需求目标

添加运动员失败时，系统需要向蓝牙端返回具体失败原因，不再把以下三类错误统一合并为 `DUPLICATE_OR_FULL`：

```text
运动员数量已满
ID 已存在
EPC 已存在
```

当前蓝牙链路为：

```text
App/上位机 <-> ESP32 Bluetooth SPP <-> ESP32 LoRa 串口 <-> STM32 LoRa 串口 <-> SpeedSkatingTimer
```

ESP32-LORA 当前程序是字节透传桥，LoRa 收到的字节会原样写入蓝牙。因此第一阶段重点在 STM32 侧返回更精确的 LoRa 文本 reason 和字节协议状态码；ESP32 侧保持透传即可让蓝牙端收到具体错误码。若 App 侧要求人类可读中文文本，再在 ESP32 或 App 侧增加状态码到文案的映射。



### 二、当前代码状态

相关文件：

```text
AthleteManager.h
SpeedSkatingTimer.ino
LoraManager.h
LORAProtocol.txt
LORAProtocol-byte.md
ESP32-LORA/LORAProtocol-byte.md
ESP32-LORA/ESP32-LORA.ino
```

当前 STM32 侧 `AthleteManager::addAthlete()` 只返回 `bool`：

```cpp
bool addAthlete(String id, String name, String epc)
```

失败原因包括：

```text
athleteCount >= MAX_ATHLETES
getAthleteByID(id) != nullptr
getAthleteByEPC(epc) != nullptr
```

但调用处无法知道具体是哪一种失败。

当前 LoRa 添加运动员失败时：

```cpp
loraManager.sendCommandReply("ADD", false, "DUPLICATE_OR_FULL");
```

`LoraManager::statusFromReason()` 会把 `DUPLICATE_OR_FULL` 映射为 `STATUS_DUPLICATE_EPC`，导致蓝牙端无法区分“数量已满 / ID 已存在 / EPC 已存在”。

ESP32-LORA 当前是透明桥接：

```text
LoRaSerial -> SerialBT
SerialBT -> LoRaSerial
```

因此 ESP32 侧第一版不需要解析命令回复，只需要同步协议文档，确保 App/上位机知道 `0xF1` 中新增状态码的含义。



### 三、错误码设计

### 1. STM32 内部添加结果

计划在 `AthleteManager.h` 中新增枚举：

```cpp
enum AthleteAddResult {
  ATHLETE_ADD_OK,
  ATHLETE_ADD_FULL,
  ATHLETE_ADD_DUPLICATE_ID,
  ATHLETE_ADD_DUPLICATE_EPC
};
```

新增接口：

```cpp
AthleteAddResult addAthleteWithResult(String id, String name, String epc);
```

保留旧接口作为兼容包装：

```cpp
bool addAthlete(String id, String name, String epc) {
  return addAthleteWithResult(id, name, epc) == ATHLETE_ADD_OK;
}
```

这样 `StorageManager` 等既有调用可以先不大范围改动，新增需求只在需要具体错误原因的业务入口使用新接口。

### 2. 错误判断优先级

计划判断顺序：

```text
1. ID 已存在
2. EPC 已存在
3. 运动员数量已满
4. 写入新运动员
```

选择该顺序的原因：

```text
如果请求本身带有重复 ID 或重复 EPC，即使当前数组也已满，返回重复原因更便于用户修正输入。
如果 ID 和 EPC 都不重复但没有空位，则返回运动员数量已满。
```

说明：当前 `ADD` 命令由系统自动生成 ID，ID 重复理论上少见，但 `BIND` 或后续扫描添加复用添加逻辑时仍可能触发该原因。

### 3. LoRa 文本协议 reason

计划新增失败原因：

```text
ATHLETE_FULL
DUPLICATE_ID
DUPLICATE_EPC
```

文本回复示例：

```text
TYPE=COMMAND_REPLY;COMMAND=ADD;RESULT=FAIL;REASON=ATHLETE_FULL
TYPE=COMMAND_REPLY;COMMAND=ADD;RESULT=FAIL;REASON=DUPLICATE_ID
TYPE=COMMAND_REPLY;COMMAND=ADD;RESULT=FAIL;REASON=DUPLICATE_EPC
```

保留 `DUPLICATE_OR_FULL` 作为旧文档兼容说明，但新代码不再用于 `ADD` 的失败返回。

### 4. LoRa 字节协议状态码

现有通用回复 `0xF1`：

```text
byte0：原命令 ID
byte1：状态码
```

计划状态码：

```text
0x00：成功
0x01：数据格式错误
0x02：EPC 已存在 / EPC 已绑定
0x03：未找到运动员
0x04：等待扫描超时
0x05：存储失败
0x06：当前状态不允许执行
0x07：运动员数量已满
0x08：ID 已存在
```

其中 `0x02` 保持为 EPC 重复，避免改动旧含义；新增 `0x07` 和 `0x08` 用于补齐数量已满与 ID 已存在。



### 四、代码修改计划

### 1. AthleteManager

修改文件：

```text
AthleteManager.h
```

计划修改：

```text
新增 AthleteAddResult 枚举
新增 addAthleteWithResult()
保留 addAthlete() bool 包装
视情况将 addAthleteTEST() 标记为旧测试接口，后续不再用于正式流程
```

`addAthleteWithResult()` 内部只负责内存数据判断和写入，不处理 TF 卡保存，不直接发送 LoRa。

### 2. SpeedSkatingTimer LoRa ADD 处理

修改文件：

```text
SpeedSkatingTimer.ino
```

计划新增辅助函数：

```cpp
String addResultToReason(AthleteAddResult result);
```

`COMMAND_ADD` 处理流程调整为：

```text
1. 规范化 EPC 为大写
2. 生成运动员 ID
3. 调用 athleteManager.addAthleteWithResult()
4. 成功：保存 TF 卡并返回 OK + 生成 ID
5. 保存失败：返回 STORAGE_ERROR
6. 失败：按结果返回 ATHLETE_FULL / DUPLICATE_ID / DUPLICATE_EPC
```

注意：当前代码调用 `storageManager.saveAthletes()` 后未检查返回值。实现该需求时建议同步检查保存结果，避免内存添加成功但 TF 卡保存失败时仍向蓝牙返回成功。

### 3. 串口 ADD 处理

修改文件：

```text
SpeedSkatingTimer.ino
```

计划将串口 `ADD,name,epc` 也改用 `addAthleteWithResult()`，串口提示分别输出：

```text
运动员添加失败：运动员数量已满
运动员添加失败：ID已存在
运动员添加失败：EPC已存在
```

该部分不直接影响蓝牙，但有利于本地调试与行为一致。

### 4. BIND 和后续 SCAN_ADD 的边界

`BIND` 当前在 ID 不存在时也会调用 `addAthlete()` 新增运动员。计划同步改为 `addAthleteWithResult()`，让新增路径也能返回具体失败原因。

待完成的 `0x12` 扫描添加运动员后续实现时必须复用同一套 `AthleteAddResult`，扫描到 EPC 后如果添加失败，应通过 `0xF1` 返回：

```text
0x07 运动员数量已满
0x08 ID 已存在
0x02 EPC 已存在
```

### 5. LoraManager 状态码映射

修改文件：

```text
LoraManager.h
```

计划新增状态码常量：

```cpp
static const byte STATUS_ATHLETE_FULL = 0x07;
static const byte STATUS_DUPLICATE_ID = 0x08;
```

更新：

```cpp
byte statusFromReason(bool success, const String& reason);
```

新增映射：

```text
ATHLETE_FULL  -> 0x07
DUPLICATE_ID  -> 0x08
DUPLICATE_EPC -> 0x02
```

旧 `DUPLICATE_OR_FULL` 可暂时保留为兼容映射，但不再作为新代码首选 reason。

### 6. ESP32 蓝牙侧

修改文件：

```text
ESP32-LORA/ESP32-LORA.ino
```

第一阶段计划不改代码。原因：

```text
当前 ESP32-LORA 是 Bluetooth SPP 字节透传桥。
STM32 发出的 0xF1 字节回复会原样进入 SerialBT。
```

需要同步 ESP32 侧协议文档：

```text
ESP32-LORA/LORAProtocol-byte.md
```

如果后续 App 侧不能解析二进制错误码，再考虑在 ESP32 增加可选解析模式，将 `0xF1` 状态码转换成文本事件发给蓝牙；但这会改变当前“字节透传”的边界，需单独确认。



### 五、文档同步计划

代码实现时同步更新：

```text
LORAProtocol.txt
LORAProtocol-byte.md
ESP32-LORA/LORAProtocol-byte.md
ARCHITECTURE.md
CurrentTask.md
```

`LORAProtocol.txt`：

```text
COMMAND_REPLY 的 REASON 列表新增 ATHLETE_FULL / DUPLICATE_ID / DUPLICATE_EPC
```

`LORAProtocol-byte.md` 和 `ESP32-LORA/LORAProtocol-byte.md`：

```text
0xF1 状态码新增 0x07 运动员数量已满、0x08 ID 已存在
明确 0x02 表示 EPC 已存在 / EPC 已绑定
```

`ARCHITECTURE.md`：

```text
补充添加运动员失败原因从 AthleteManager -> LoraManager -> ESP32 蓝牙透传的链路。
```

`CurrentTask.md`：

```text
代码完成后从待完成移入待验证，等待编译、蓝牙透传和 STM32/ESP32 联调确认。
```



### 六、验证计划

### 1. EPC 已存在

条件：

```text
已有运动员 EPC = 2222F337
再次执行 ADD,name,2222F337
```

预期：

```text
文本协议：REASON=DUPLICATE_EPC
字节协议：0xF1 byte1 = 0x02
蓝牙端收到对应回复
```

### 2. ID 已存在

条件：

```text
BIND 或内部添加路径传入已存在 ID
```

预期：

```text
文本协议：REASON=DUPLICATE_ID
字节协议：0xF1 byte1 = 0x08
蓝牙端收到对应回复
```

### 3. 运动员数量已满

条件：

```text
有效运动员数量达到 MAX_ATHLETES
新增一个 ID/EPC 均不重复的运动员
```

预期：

```text
文本协议：REASON=ATHLETE_FULL
字节协议：0xF1 byte1 = 0x07
蓝牙端收到对应回复
```

### 4. 添加成功但保存失败

条件：

```text
模拟 TF 卡保存失败
```

预期：

```text
返回 STORAGE_ERROR / 0x05
不应向蓝牙报告添加成功
```



### 七、主要风险与处理

### 1. 旧 bool 接口调用点较多

风险：

```text
直接改 `addAthlete()` 返回类型会影响 StorageManager 加载、测试数据初始化等多处调用。
```

处理：

```text
新增 addAthleteWithResult()，保留 addAthlete() 包装，逐步替换需要精确错误原因的入口。
```

### 2. ESP32 透传边界被误改

风险：

```text
如果 ESP32 侧直接把二进制帧改成人类可读文本，可能破坏 App 当前按字节协议解析的行为。
```

处理：

```text
第一阶段保持 ESP32-LORA 字节透传，只同步协议文档。
需要文本化蓝牙事件时另开需求确认。
```

### 3. 添加成功但保存失败的数据一致性

风险：

```text
内存添加成功但 TF 卡保存失败，设备重启后该运动员丢失。
```

处理：

```text
检查 saveAthletes() 返回值。
保存失败时返回 STORAGE_ERROR。
是否回滚内存中的新增运动员需结合现有 remove/edit 能力在实现时评估，至少不能对外报告成功。
```
