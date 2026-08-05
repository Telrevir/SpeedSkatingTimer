#include "config.h"
#include "AthleteManager.h"
#include "RFIDReader.h"
#include "TimingLogic.h"
#include "StorageManager.h"
#include "LoraManager.h"

AthleteManager athleteManager;
RFIDReader rfidReader;
TimingLogic timingLogic(&athleteManager);
StorageManager storageManager;
LoraManager loraManager;

int detectID = 0;
bool scanningMode = false;
String lastLeaderId = "";
int lastLeaderLapCount = -1;
unsigned long lastLeaderTotalTime = 0;
unsigned long lastLoopHeartbeat = 0;
const unsigned long RACE_FINISH_TIMEOUT_MS = 300000UL;

void sendAthleteDataLora(const Athlete* athlete);
void sendLeaderDataLoraIfChanged(const Athlete* leader);
void sendAthleteListLora();
void sendAllResultsLora();
void sendRaceStatusLora();
void checkRaceFinishTimeout();
unsigned long getLastLapTime(const Athlete* athlete);
String getShortEPC(String fullEPC);
bool isNumericId(const String& id);
String formatAthleteId(int value);
String generateNextAthleteId();
void setupDemoAthletes();
void resetRaceData();
void testRFIDFunction();
void processDetectedTag(const String& shortEPC);
void handleLoraCommand(const LoraCommand& command);
void handleSerialCommands();
void addAthleteFromCommand(String command);
void bindAthleteFromCommand(String command);
void removeAthleteFromCommand(String command);
void simulateLoraBytesFromCommand(String command);
bool parseHexByteToken(const String& token, byte& value);
void printAthleteList();

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(50);
  delay(2000);

  Serial.println("\n=== 速度滑冰计时系统启动 ===");

  storageManager.begin();
  rfidReader.begin();
  loraManager.begin(handleLoraCommand, getLastLapTime);

  if (storageManager.loadAthletes(&athleteManager)) {
    Serial.println("[Storage] 已从TF卡加载运动员数据");
  } else {
    Serial.println("[Storage] 未找到保存的运动员数据，使用示例数据");
    setupDemoAthletes();
    storageManager.saveAthletes(&athleteManager);
  }

  Serial.println("\nSpeed Skating Timing System Ready");
  Serial.println("Commands:");
  Serial.println("  START - Start race and RFID single-inventory scanning");
  Serial.println("  STOP - Stop race and scanning");
  Serial.println("  RESET - Reset race timing data");
  Serial.println("  LIST - List athletes");
  Serial.println("  ADD,name,epc - Add athlete");
  Serial.println("  BIND,id,name,epc - Add or update athlete binding");
  Serial.println("  REMOVE,id - Remove athlete");
  Serial.println("  SCAN - Enter scan mode");
  Serial.println("  TEST - Test RFID functionality");
  Serial.println("  RFIDDEBUG - Show RFID debug information");
  Serial.println("  STORAGE - Show TF card storage information");
  Serial.println("  FILES - List TF card root files");
  Serial.println("  SAVE - Save current athletes to TF card");
  Serial.println("  LOAD - Load athletes from TF card");

  Serial.println("启动完成。需要 RFID 测试时请发送 TEST 命令。");
}

void loop() {
  checkRaceFinishTimeout();

  if (scanningMode || timingLogic.isRaceStarted() || timingLogic.isWaitingForStart()) {
    if (EPCQueueCount > 0) {
      String epc = rfidReader.readTagEvent();
      if (epc.length() > 0) {
        processDetectedTag(epc);
      }
    }
    // SINGLE_INVENTORY_LOOP_READ:
    // 当前实测多次轮询效果不理想，主流程恢复为单次轮询。
    // receiveTag() 内部会主动发送单次盘点指令并读取响应。
    rfidReader.receiveTag();
    // LEGACY_MULTI_INVENTORY:
    // rfidReader.receiveTagMultiInventory();
  }

  handleSerialCommands();
  loraManager.handleReceive();

  // if (millis() - lastLoopHeartbeat >= 1000) {
  //   lastLoopHeartbeat = millis();
  //   Serial.println("[Loop] alive");
  // }

  yield();
}

void handleLoraCommand(const LoraCommand& command) {
  if (command.type == "COMMAND_START") {
    timingLogic.startRace();
    scanningMode = true;
    rfidReader.startInventory();
    // LEGACY_MULTI_INVENTORY:
    // rfidReader.startMultiInventory();
    Serial.println("[LoRa RX] 执行 START");
    if (command.fromByteProtocol) {
      loraManager.sendCommandReplyByte(command.sourceCommandId, 0x00);
    }
    sendRaceStatusLora();

  } else if (command.type == "COMMAND_SCAN") {
    scanningMode = true;
    rfidReader.startInventory();
    // LEGACY_MULTI_INVENTORY:
    // rfidReader.startMultiInventory();
    Serial.println("[LoRa RX] 执行 SCAN");

  } else if (command.type == "COMMAND_STOP") {
    bool finishStarted = timingLogic.beginLeaderFinish();
    if (finishStarted) {
      scanningMode = true;
      rfidReader.startInventory();
      Serial.print("[LoRa RX] 执行 STOP，进入领滑结束，目标圈数: ");
      Serial.println(timingLogic.getFinishTargetLap());
      if (command.fromByteProtocol) {
        loraManager.sendCommandReplyByte(command.sourceCommandId, 0x00);
      }
    } else {
      scanningMode = false;
      rfidReader.stopInventory();
      Serial.println("[LoRa RX] STOP 时没有有效领滑运动员，已安全停机");
      if (command.fromByteProtocol) {
        loraManager.sendCommandReplyByte(command.sourceCommandId, 0x06);
      }
    }
    sendRaceStatusLora();

  } else if (command.type == "COMMAND_RESET") {
    resetRaceData();
    Serial.println("[LoRa RX] 执行 RESET");
    if (command.fromByteProtocol) {
      loraManager.sendCommandReplyByte(command.sourceCommandId, 0x00);
    }
    sendRaceStatusLora();

  } else if (command.type == "COMMAND_ADD") {
    String normalizedEpc = command.epc;
    normalizedEpc.toUpperCase();
    String generatedId = generateNextAthleteId();

    if (athleteManager.addAthlete(generatedId, command.name, normalizedEpc)) {
      storageManager.saveAthletes(&athleteManager);
      Serial.print("[LoRa RX] 执行 ADD 成功，生成ID: ");
      Serial.println(generatedId);
      loraManager.sendCommandReply("ADD", true, "", generatedId);
    } else {
      Serial.println("[LoRa RX] 执行 ADD 失败");
      loraManager.sendCommandReply("ADD", false, "DUPLICATE_OR_FULL");
    }

  } else if (command.type == "COMMAND_REMOVE") {
    if (athleteManager.removeAthlete(command.id)) {
      storageManager.saveAthletes(&athleteManager);
      Serial.println("[LoRa RX] 执行 REMOVE 成功");
      loraManager.sendCommandReply("REMOVE", true);
    } else {
      Serial.println("[LoRa RX] 执行 REMOVE 失败");
      loraManager.sendCommandReply("REMOVE", false, "NOT_FOUND");
    }

  } else if (command.type == "COMMAND_BIND") {
    String normalizedEpc = command.epc;
    normalizedEpc.toUpperCase();

    bool success = false;
    if (athleteManager.getAthleteByID(command.id)) {
      success = athleteManager.editAthlete(command.id, command.name, normalizedEpc);
    } else {
      success = athleteManager.addAthlete(command.id, command.name, normalizedEpc);
    }

    if (success) {
      storageManager.saveAthletes(&athleteManager);
      Serial.println("[LoRa RX] 执行 BIND 成功");
      loraManager.sendCommandReply("BIND", true);
    } else {
      Serial.println("[LoRa RX] 执行 BIND 失败");
      loraManager.sendCommandReply("BIND", false, "DUPLICATE_OR_FULL");
    }

  } else if (command.type == "COMMAND_LIST") {
    Serial.println("[LoRa RX] 执行 LIST");
    sendAthleteListLora();

  } else if (command.type == "COMMAND_RESULTS") {
    Serial.println("[LoRa RX] 执行 RESULTS");
    sendAllResultsLora();

  } else if (command.type == "COMMAND_LEADER") {
    Serial.println("[LoRa RX] 执行 LEADER");
    Athlete* leader = timingLogic.getCurrentLeader();
    if (leader != nullptr) {
      loraManager.sendLeaderData(leader);
    } else if (command.fromByteProtocol) {
      loraManager.sendCommandReplyByte(command.sourceCommandId, 0x03);
    }

  } else if (command.type == "COMMAND_QUERY") {
    Serial.println("[LoRa RX] 执行 QUERY");
    Athlete* athlete = athleteManager.getAthleteByID(command.id);
    if (athlete != nullptr) {
      loraManager.sendAthleteInfo(athlete);
    } else if (command.fromByteProtocol) {
      loraManager.sendCommandReplyByte(command.sourceCommandId, 0x03);
    }
  } else if (command.type == "COMMAND_RACE_STATUS") {
    Serial.println("[LoRa RX] 执行 RACE_STATUS");
    sendRaceStatusLora();
  }
}

void sendAthleteDataLora(const Athlete* athlete) {
  if (athlete == nullptr) return;
  loraManager.sendAthleteData(athlete);
}

void sendLeaderDataLoraIfChanged(const Athlete* leader) {
  if (leader == nullptr) return;

  if (leader->id == lastLeaderId &&
      leader->lapCount == lastLeaderLapCount &&
      leader->totalTime == lastLeaderTotalTime) {
    return;
  }

  lastLeaderId = leader->id;
  lastLeaderLapCount = leader->lapCount;
  lastLeaderTotalTime = leader->totalTime;
  loraManager.sendLeaderData(leader);
}

void sendAthleteListLora() {
  Athlete* athletes = athleteManager.getAthletes();
  int count = athleteManager.getAthleteCount();
  int activeCount = 0;

  for (int i = 0; i < count; i++) {
    if (athletes[i].isActive) {
      activeCount++;
    }
  }

  loraManager.sendAthleteListBegin(activeCount);

  int index = 1;
  for (int i = 0; i < count; i++) {
    if (!athletes[i].isActive) continue;
    loraManager.sendAthleteListItem(index, &athletes[i]);
    index++;
  }

  loraManager.sendAthleteListEnd(activeCount);
}

void sendAllResultsLora() {
  Athlete* athletes = athleteManager.getAthletes();
  int count = athleteManager.getAthleteCount();

  loraManager.sendResultsBegin();
  for (int i = 0; i < count; i++) {
    if (!athletes[i].isActive) continue;
    loraManager.sendAthleteData(&athletes[i]);
  }
  loraManager.sendResultsEnd();
}

void sendRaceStatusLora() {
  loraManager.sendRaceStatus(timingLogic.getRaceStatusByte());
}

void checkRaceFinishTimeout() {
  if (!timingLogic.isLeaderFinishTimeout(RACE_FINISH_TIMEOUT_MS)) {
    return;
  }

  timingLogic.stopRaceTimingOnly();
  scanningMode = false;
  rfidReader.stopInventory();
  Serial.println("[Race] 领滑结束超过5分钟，已彻底停止计时并关闭 RFID");
  sendRaceStatusLora();
}

unsigned long getLastLapTime(const Athlete* athlete) {
  if (athlete == nullptr || athlete->lapCount <= 0) return 0;
  int lapIndex = athlete->lapCount - 1;
  if (lapIndex < 0 || lapIndex >= MAX_LAPS) return 0;
  return athlete->lapTimes[lapIndex].lapTime;
}

String getShortEPC(String fullEPC) {
  if (fullEPC.length() >= 8) {
    return fullEPC.substring(0, 8);
  }
  return fullEPC;
}

bool isNumericId(const String& id) {
  if (id.length() == 0) return false;

  for (size_t i = 0; i < id.length(); i++) {
    if (id[i] < '0' || id[i] > '9') {
      return false;
    }
  }

  return true;
}

String formatAthleteId(int value) {
  if (value < 0) value = 0;

  if (value < 10) {
    return "00" + String(value);
  }

  if (value < 100) {
    return "0" + String(value);
  }

  return String(value);
}

String generateNextAthleteId() {
  Athlete* athletes = athleteManager.getAthletes();
  int count = athleteManager.getAthleteCount();
  int maxId = 0;

  for (int i = 0; i < count; i++) {
    if (!athletes[i].isActive) continue;

    String id = athletes[i].id;
    id.trim();
    if (!isNumericId(id)) continue;

    int numericId = id.toInt();
    if (numericId > maxId) {
      maxId = numericId;
    }
  }

  return formatAthleteId(maxId + 1);
}

void setupDemoAthletes() {
  athleteManager.addAthlete("001", "张三", "AA01F337");
  athleteManager.addAthlete("002", "李四", "2222F337");
  athleteManager.addAthlete("003", "王五", "5555F337");
  athleteManager.addAthlete("004", "陈六", "3333F337");
  athleteManager.addAthlete("005", "七", "4444F337");
  athleteManager.addAthlete("005", "八", "6666F337");

  Serial.println("Demo athletes added (using 8-bit EPC)");
  printAthleteList();
}

void resetRaceData() {
  timingLogic.stopRace();
  scanningMode = false;
  rfidReader.stopInventory();

  Athlete* athletes = athleteManager.getAthletes();
  int count = athleteManager.getAthleteCount();
  for (int i = 0; i < count; i++) {
    athletes[i].lapCount = 0;
    athletes[i].startTime = 0;
    athletes[i].lastTime = 0;
    athletes[i].totalTime = 0;
    athletes[i].lastDetectedTime = 0;
    athletes[i].rank = 0;
    athletes[i].resultLocked = false;
    for (int lap = 0; lap < MAX_LAPS; lap++) {
      athletes[i].lapTimes[lap].timestamp = 0;
      athletes[i].lapTimes[lap].lapTime = 0;
    }
  }

  detectID = 0;
  lastLeaderId = "";
  lastLeaderLapCount = -1;
  lastLeaderTotalTime = 0;
}

void testRFIDFunction() {
  Serial.println("\n=== RFID功能测试 ===");
  Serial.println("1. 检查连接...");
  if (rfidReader.checkConnection()) {
    Serial.println("RFID连接正常");

    Serial.println("2. 开始测试扫描...");
    Serial.println("请将RFID标签靠近天线，持续5秒...");

    rfidReader.startInventory();
    unsigned long startTime = millis();
    int tagCount = 0;

    while (millis() - startTime < 5000) {
      String epc = rfidReader.readTag();
      if (epc.length() > 0) {
        tagCount++;
        Serial.print("检测到标签 #");
        Serial.print(tagCount);
        Serial.print(": ");
        Serial.println(epc);
      }
      delay(100);
    }

    rfidReader.stopInventory();

    if (tagCount > 0) {
      Serial.println("RFID扫描测试成功");
    } else {
      Serial.println("未检测到任何标签，请检查标签、天线和模块电源");
    }
  } else {
    Serial.println("RFID连接测试失败");
    Serial.println("请检查 STM32 与 RFID 模块接线: STM32 RX=PC7<-RFID TX, STM32 TX=PC6->RFID RX");
  }
  Serial.println("=== 测试结束 ===\n");
}

void processDetectedTag(const String& shortEPC) {
  if (timingLogic.isRaceStarted() || timingLogic.isWaitingForStart()) {
    Athlete* athlete = athleteManager.getAthleteByEPC(shortEPC);
    if (athlete == nullptr) {
      Serial.print("未找到对应运动员: ");
      Serial.println(shortEPC);
      return;
    }

    byte previousRaceStatus = timingLogic.getRaceStatusByte();
    if (timingLogic.recordLap(shortEPC)) {
      byte currentRaceStatus = timingLogic.getRaceStatusByte();
      Serial.print("--------------当前ID: ");
      Serial.println(detectID++);
      Serial.println("=== RFID标签检测 ===");
      Serial.print("使用EPC: ");
      Serial.println(shortEPC);

      athlete = athleteManager.getAthleteByEPC(shortEPC);
      Athlete* leader = timingLogic.getCurrentLeader();

      Serial.print("找到运动员: ");
      Serial.print(athlete->name);
      Serial.print(" 当前圈数: ");
      Serial.println(athlete->lapCount);
      Serial.print("最近单圈用时: ");
      Serial.println(getLastLapTime(athlete));

      if (leader) {
        Serial.println("领滑运动员: " + leader->name + " (第" + String(leader->lapCount) + "圈)");
      }
      sendAthleteDataLora(athlete);
      sendLeaderDataLoraIfChanged(leader);
      if (currentRaceStatus != previousRaceStatus) {
        sendRaceStatusLora();
      }
      Serial.println("===================");
    }
    
  } else {
    Serial.println("比赛状态: 未开始 - 扫描模式");

    Serial.println("=== RFID标签检测 ===");
      Serial.print("使用EPC: ");
      Serial.println(shortEPC);
    Athlete* athlete = athleteManager.getAthleteByEPC(shortEPC);
    if (athlete) {
      Serial.println("标签已绑定到: " + athlete->name);
    } else {
      Serial.println("标签未绑定，可绑定到运动员");
    }
    loraManager.sendScannedEpc(shortEPC, athlete);
  }
}

void handleSerialCommands() {
  if (!Serial.available()) {
    return;
  }

  String command = Serial.readStringUntil('\n');
  Serial.println("CHECK:"+command);
  command.trim();
  command.toUpperCase();


  if (command == "START") {
    timingLogic.startRace();
    scanningMode = true;
    rfidReader.startInventory();
    // LEGACY_MULTI_INVENTORY:
    // rfidReader.startMultiInventory();
    Serial.println("比赛开始 - RFID单次轮询扫描激活");
    sendRaceStatusLora();

  } else if (command == "STOP") {
    bool finishStarted = timingLogic.beginLeaderFinish();
    if (finishStarted) {
      scanningMode = true;
      rfidReader.startInventory();
      Serial.print("比赛进入领滑结束，目标圈数: ");
      Serial.println(timingLogic.getFinishTargetLap());
    } else {
      scanningMode = false;
      rfidReader.stopInventory();
      Serial.println("没有有效领滑运动员，比赛已安全停止");
    }
    sendRaceStatusLora();

  } else if (command == "RESET") {
    resetRaceData();
    Serial.println("比赛计时数据已重置");
    sendRaceStatusLora();

  } else if (command == "LIST") {
    printAthleteList();

  } else if (command.startsWith("ADD")) {
    addAthleteFromCommand(command);

  } else if (command.startsWith("BIND")) {
    bindAthleteFromCommand(command);

  } else if (command.startsWith("REMOVE")) {
    removeAthleteFromCommand(command);

  } else if (command.startsWith("LORA,")) {
    simulateLoraBytesFromCommand(command);

  } else if (command == "SCAN") {
    scanningMode = true;
    rfidReader.startInventory();
    // LEGACY_MULTI_INVENTORY:
    // rfidReader.startMultiInventory();
    Serial.println("进入扫描模式 - 单次轮询扫描所有标签");

  } else if (command == "TEST") {
    testRFIDFunction();

  } else if (command == "RFIDDEBUG") {
    rfidReader.printDebugInfo();

  } else if (command == "STORAGE") {
    storageManager.printStorageInfo();

  } else if (command == "FILES") {
    storageManager.listFiles();

  } else if (command == "SAVE") {
    if (storageManager.saveAthletes(&athleteManager)) {
      Serial.println("运动员数据已保存");
    } else {
      Serial.println("保存失败");
    }

  } else if (command == "LOAD") {
    if (storageManager.loadAthletes(&athleteManager)) {
      Serial.println("运动员数据已加载");
      printAthleteList();
    } else {
      Serial.println("加载失败或数据不存在");
    }

  } else {
    Serial.println("未知命令");
  }
}

void addAthleteFromCommand(String command) {
  int firstComma = command.indexOf(',');
  int secondComma = command.indexOf(',', firstComma + 1);
  int thirdComma = command.indexOf(',', secondComma + 1);

  if (firstComma == -1 || secondComma == -1 || thirdComma != -1) {
    Serial.println("命令格式错误: ADD,name,epc");
    return;
  }

  String name = command.substring(firstComma + 1, secondComma);
  String epc = command.substring(secondComma + 1);
  String id = generateNextAthleteId();
  name.trim();
  epc.trim();
  epc.toUpperCase();

  if (athleteManager.addAthlete(id, name, epc)) {
    Serial.print("运动员添加成功，生成ID: ");
    Serial.println(id);
    storageManager.saveAthletes(&athleteManager);
  } else {
    Serial.println("运动员添加失败，可能是EPC重复或数量已满");
  }
}

void bindAthleteFromCommand(String command) {
  int firstComma = command.indexOf(',');
  int secondComma = command.indexOf(',', firstComma + 1);
  int thirdComma = command.indexOf(',', secondComma + 1);

  if (firstComma == -1 || secondComma == -1 || thirdComma == -1) {
    Serial.println("命令格式错误: BIND,id,name,epc");
    return;
  }

  String id = command.substring(firstComma + 1, secondComma);
  String name = command.substring(secondComma + 1, thirdComma);
  String epc = command.substring(thirdComma + 1);
  id.trim();
  name.trim();
  epc.trim();
  epc.toUpperCase();

  bool success = false;
  if (athleteManager.getAthleteByID(id)) {
    success = athleteManager.editAthlete(id, name, epc);
  } else {
    success = athleteManager.addAthlete(id, name, epc);
  }

  if (success) {
    Serial.println("标签绑定成功");
    storageManager.saveAthletes(&athleteManager);
  } else {
    Serial.println("标签绑定失败，可能是EPC重复或数量已满");
  }
}

void removeAthleteFromCommand(String command) {
  int firstComma = command.indexOf(',');
  if (firstComma == -1) {
    Serial.println("命令格式错误: REMOVE,id");
    return;
  }

  String id = command.substring(firstComma + 1);
  id.trim();

  if (athleteManager.removeAthlete(id)) {
    Serial.println("运动员删除成功");
    storageManager.saveAthletes(&athleteManager);
  } else {
    Serial.println("未找到该运动员");
  }
}

bool parseHexByteToken(const String& token, byte& value) {
  String normalized = token;
  normalized.trim();
  if (normalized.startsWith("0X")) {
    normalized = normalized.substring(2);
  }
  if (normalized.length() == 0 || normalized.length() > 2) {
    return false;
  }

  for (size_t i = 0; i < normalized.length(); i++) {
    if (!isHexadecimalDigit(normalized[i])) {
      return false;
    }
  }

  value = (byte)strtoul(normalized.c_str(), nullptr, 16);
  return true;
}

void simulateLoraBytesFromCommand(String command) {
  int commaIndex = command.indexOf(',');
  if (commaIndex == -1) {
    Serial.println("命令格式错误: LORA,AA 01 02 9F");
    return;
  }

  String hexText = command.substring(commaIndex + 1);
  hexText.trim();
  if (hexText.length() == 0) {
    Serial.println("[LORA TEST] 未输入十六进制字节");
    return;
  }

  int parsedCount = 0;
  int startIndex = 0;
  while (startIndex < hexText.length()) {
    while (startIndex < hexText.length() && hexText[startIndex] == ' ') {
      startIndex++;
    }
    if (startIndex >= hexText.length()) break;

    int endIndex = hexText.indexOf(' ', startIndex);
    if (endIndex == -1) {
      endIndex = hexText.length();
    }

    String token = hexText.substring(startIndex, endIndex);
    byte value = 0;
    if (!parseHexByteToken(token, value)) {
      Serial.print("[LORA TEST] 非法十六进制字节: ");
      Serial.println(token);
      return;
    }

    loraManager.feedReceivedByte(value);
    parsedCount++;
    startIndex = endIndex + 1;
  }

  Serial.print("[LORA TEST] 已模拟输入字节数: ");
  Serial.println(parsedCount);
}

void printAthleteList() {
  Serial.println("\n=== 运动员列表 ===");
  Athlete* athletes = athleteManager.getAthletes();
  int count = athleteManager.getAthleteCount();
  int activeCount = 0;

  for (int i = 0; i < count; i++) {
    if (!athletes[i].isActive) continue;
    activeCount++;
    Serial.print(activeCount);
    Serial.print(". ID=");
    Serial.print(athletes[i].id);
    Serial.print(", NAME=");
    Serial.print(athletes[i].name);
    Serial.print(", EPC=");
    Serial.print(athletes[i].epc);
    Serial.print(", LAP=");
    Serial.print(athletes[i].lapCount);
    Serial.print(", TOTAL_TIME=");
    Serial.print(athletes[i].totalTime);
    Serial.print(", RANK=");
    Serial.println(athletes[i].rank);
  }

  if (activeCount == 0) {
    Serial.println("(无运动员)");
  }
  Serial.println("================\n");
}
