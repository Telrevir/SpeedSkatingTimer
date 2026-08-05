#ifndef STORAGE_MANAGER_H
#define STORAGE_MANAGER_H

#include <Arduino.h>
#include <STM32SD.h>
#include "AthleteManager.h"

class StorageManager {
private:
  static constexpr const char* ATHLETES_FILE = "athletes.csv";
  static constexpr const char* ATHLETES_TMP_FILE = "athletes_tmp.csv";
  static constexpr const char* ATHLETES_BAK_FILE = "athletes_bak.csv";

  bool fsInitialized;

  bool removeFileIfExists(const char* filename) {
    Serial.print("[Storage] 开始删除文件: ");
    Serial.println(filename);
    if (!SD.exists(filename)) {
      return true;
    }
    if (SD.remove(filename)) {
      return true;
    }
    Serial.print("[Storage] 删除文件失败: ");
    Serial.println(filename);
    return false;
  }

  bool copyFile(const char* sourcePath, const char* targetPath) {
    File source = SD.open(sourcePath, FILE_READ);
    if (!source) {
      Serial.print("[Storage] 无法打开源文件: ");
      Serial.println(sourcePath);
      return false;
    }

    if (!removeFileIfExists(targetPath)) {
      source.close();
      return false;
    }

    File target = SD.open(targetPath, FILE_WRITE);
    if (!target) {
      Serial.print("[Storage] 无法打开目标文件: ");
      Serial.println(targetPath);
      source.close();
      return false;
    }

    uint8_t buffer[64];
    bool ok = true;
    while (source.available()) {
      int bytesRead = source.read(buffer, sizeof(buffer));
      if (bytesRead <= 0) {
        ok = false;
        break;
      }

      if (target.write(buffer, bytesRead) != (size_t)bytesRead) {
        ok = false;
        break;
      }
    }

    target.flush();
    target.close();
    source.close();

    if (!ok) {
      Serial.print("[Storage] 文件复制失败: ");
      Serial.print(sourcePath);
      Serial.print(" -> ");
      Serial.println(targetPath);
      SD.remove(targetPath);
    }

    return ok;
  }

  char hexDigit(uint8_t value) {
    value &= 0x0F;
    return value < 10 ? ('0' + value) : ('A' + value - 10);
  }

  int hexValue(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    return -1;
  }

  String stringToHex(const String& value) {
    String hex;
    hex.reserve(value.length() * 2);

    for (size_t i = 0; i < value.length(); i++) {
      uint8_t byteValue = static_cast<uint8_t>(value[i]);
      hex += hexDigit(byteValue >> 4);
      hex += hexDigit(byteValue);
    }

    return hex;
  }

  bool hexToString(const String& hex, String& output) {
    output = "";

    if (hex.length() == 0 || hex.length() % 2 != 0) {
      return false;
    }

    output.reserve(hex.length() / 2);

    for (size_t i = 0; i < hex.length(); i += 2) {
      int high = hexValue(hex[i]);
      int low = hexValue(hex[i + 1]);

      if (high < 0 || low < 0) {
        output = "";
        return false;
      }

      char byteValue = static_cast<char>((high << 4) | low);
      output += byteValue;
    }

    return output.length() > 0;
  }

  bool containsUnsafeCsvChar(const String& value) {
    for (size_t i = 0; i < value.length(); i++) {
      char c = value[i];
      if (c == ';' || c == '\r' || c == '\n') {
        return true;
      }
    }
    return false;
  }

  bool isDigitString(const String& value) {
    if (value.length() == 0) {
      return false;
    }

    for (size_t i = 0; i < value.length(); i++) {
      if (value[i] < '0' || value[i] > '9') {
        return false;
      }
    }
    return true;
  }

  bool isHexString(const String& value) {
    if (value.length() == 0) {
      return false;
    }

    for (size_t i = 0; i < value.length(); i++) {
      if (hexValue(value[i]) < 0) {
        return false;
      }
    }
    return true;
  }

  bool isValidStoredId(const String& id) {
    return id.length() == 3 && isDigitString(id);
  }

  bool isValidStoredNameHex(const String& nameHex) {
    return nameHex.length() > 0 && nameHex.length() % 2 == 0 && isHexString(nameHex);
  }

  bool isValidStoredEpc(const String& epc) {
    return epc.length() == 8 && isHexString(epc);
  }

  bool validateAthleteForSave(const Athlete& athlete) {
    if (athlete.id.length() == 0 || athlete.name.length() == 0 || athlete.epc.length() == 0) {
      Serial.println("[Storage] 保存失败: 运动员 ID/姓名/EPC 不能为空");
      return false;
    }

    if (containsUnsafeCsvChar(athlete.id) ||
        containsUnsafeCsvChar(athlete.name) ||
        containsUnsafeCsvChar(athlete.epc)) {
      Serial.println("[Storage] 保存失败: 运动员字段包含分号或换行");
      return false;
    }

    if (!isValidStoredId(athlete.id)) {
      Serial.print("[Storage] 保存失败: 运动员 ID 非法: ");
      Serial.println(athlete.id);
      return false;
    }

    String epc = athlete.epc;
    epc.trim();
    epc.toUpperCase();
    if (!isValidStoredEpc(epc)) {
      Serial.print("[Storage] 保存失败: 运动员 EPC 非法: ");
      Serial.println(athlete.epc);
      return false;
    }

    String nameHex = stringToHex(athlete.name);
    if (!isValidStoredNameHex(nameHex)) {
      Serial.print("[Storage] 保存失败: 运动员姓名无法编码: ");
      Serial.println(athlete.name);
      return false;
    }

    return true;
  }

  bool validateAthletesForSave(AthleteManager* athleteManager) {
    if (athleteManager == nullptr) {
      return false;
    }

    Athlete* athletes = athleteManager->getAthletes();
    int count = athleteManager->getAthleteCount();

    for (int i = 0; i < count; i++) {
      if (!athletes[i].isActive) continue;

      if (!validateAthleteForSave(athletes[i])) {
        return false;
      }
    }

    return true;
  }

  bool parseAthleteLine(const String& line, String& id, String& name, String& epc) {
    int firstSep = line.indexOf(';');
    int secondSep = firstSep == -1 ? -1 : line.indexOf(';', firstSep + 1);
    int thirdSep = secondSep == -1 ? -1 : line.indexOf(';', secondSep + 1);

    if (firstSep == -1 || secondSep == -1 || thirdSep != -1) {
      Serial.println("[Storage] 运动员文件行格式错误: 必须为 ID;NAME_HEX;EPC 三段");
      return false;
    }

    id = line.substring(0, firstSep);
    String nameHex = line.substring(firstSep + 1, secondSep);
    epc = line.substring(secondSep + 1);

    id.trim();
    nameHex.trim();
    epc.trim();
    epc.toUpperCase();

    if (!isValidStoredId(id)) {
      Serial.print("[Storage] 运动员文件 ID 非法: ");
      Serial.println(id);
      return false;
    }

    if (!isValidStoredNameHex(nameHex)) {
      Serial.print("[Storage] 运动员文件姓名 HEX 非法: ");
      Serial.println(nameHex);
      return false;
    }

    if (!isValidStoredEpc(epc)) {
      Serial.print("[Storage] 运动员文件 EPC 非法: ");
      Serial.println(epc);
      return false;
    }

    if (!hexToString(nameHex, name)) {
      Serial.print("[Storage] 姓名十六进制解析失败: ");
      Serial.println(nameHex);
      return false;
    }

    String trimmedName = name;
    trimmedName.trim();
    if (trimmedName.length() == 0 || containsUnsafeCsvChar(name)) {
      Serial.println("[Storage] 运动员文件姓名非法");
      return false;
    }

    return true;
  }

  bool writeAthletesFile(const char* filename, AthleteManager* athleteManager, int& savedCount) {
    savedCount = 0;
    if (!validateAthletesForSave(athleteManager)) {
      Serial.println("[Storage] 运动员数据校验失败，取消写入文件");
      return false;
    }

    if (!removeFileIfExists(filename)) {
      Serial.print("[Storage] 清理目标文件失败: ");
      Serial.println(filename);
      return false;
    }
    delay(200);
    File file = SD.open(filename, FILE_WRITE);
    if (!file) {
      Serial.print("[Storage] 无法打开运动员文件进行写入: ");
      Serial.println(filename);
      return false;
    }
    Athlete* athletes = athleteManager->getAthletes();
    int count = athleteManager->getAthleteCount();

    for (int i = 0; i < count; i++) {
      if (!athletes[i].isActive) continue;

      file.print(athletes[i].id);
      file.print(';');
      file.print(stringToHex(athletes[i].name));
      file.print(';');
      file.println(athletes[i].epc);
      savedCount++;
    }
    file.flush();
    file.close();

    Serial.print("[Storage] 写入运动员文件: ");
    Serial.print(filename);
    Serial.print(", 数量: ");
    Serial.println(savedCount);
    return true;
  }

public:
  StorageManager() : fsInitialized(false) {}

  bool begin() {
    if (!SD.begin(SD_DETECT_NONE)) {
      fsInitialized = false;
      Serial.println("[Storage] TF卡初始化失败");
      return false;
    }

    fsInitialized = true;
    Serial.println("[Storage] TF卡初始化成功");
    printStorageInfo();
    return true;
  }

  void printStorageInfo() {
    Serial.println("\n=== TF卡存储信息 ===");
    Serial.print("初始化状态: ");
    Serial.println(fsInitialized ? "已初始化" : "未初始化");

    if (!fsInitialized) {
      Serial.println("====================\n");
      return;
    }

    if (SD.exists(ATHLETES_FILE)) {
      File file = SD.open(ATHLETES_FILE, FILE_READ);
      if (file) {
        Serial.print("运动员文件: ");
        Serial.print(ATHLETES_FILE);
        Serial.print(" (");
        Serial.print(file.size());
        Serial.println(" bytes)");
        file.close();
      }
    } else {
      Serial.print("运动员文件不存在: ");
      Serial.println(ATHLETES_FILE);
    }

    Serial.println("====================\n");
  }

  void listFiles() {
    if (!fsInitialized) {
      Serial.println("[Storage] TF卡未初始化");
      return;
    }

    File root = SD.open("/");
    if (!root) {
      Serial.println("[Storage] 无法打开TF卡根目录");
      return;
    }

    Serial.println("[Storage] TF卡根目录文件:");
    File file = root.openNextFile();
    int index = 0;
    while (file) {
      Serial.print("  [");
      Serial.print(index++);
      Serial.print("] ");
      Serial.print(file.name());
      Serial.print(" (");
      Serial.print(file.size());
      Serial.println(" bytes)");
      file.close();
      file = root.openNextFile();
    }

    if (index == 0) {
      Serial.println("  (无文件)");
    }
    root.close();
  }

  bool saveConfig(const char* networkName, const char* networkPassword,
                  const char* targetHost, int targetPort) {
    (void)networkName;
    (void)networkPassword;
    (void)targetHost;
    (void)targetPort;
    Serial.println("[Storage] 网络配置保存已停用");
    return false;
  }

  bool loadConfig(String& networkName, String& networkPassword,
                  String& targetHost, int& targetPort) {
    (void)networkName;
    (void)networkPassword;
    (void)targetHost;
    (void)targetPort;
    Serial.println("[Storage] 网络配置读取已停用");
    return false;
  }

  bool saveAthletes(AthleteManager* athleteManager) {
    if (!fsInitialized || athleteManager == nullptr) {
      Serial.println("[Storage] 保存失败: TF卡未初始化或运动员管理器为空");
      return false;
    }

    Serial.println("开始保存运动员数据");
    bool hadOldFile = SD.exists(ATHLETES_FILE);
    if (hadOldFile) {
      if (!removeFileIfExists(ATHLETES_BAK_FILE)) {
        Serial.println("[Storage] 清理备份运动员文件失败，取消保存");
        SD.remove(ATHLETES_TMP_FILE);
        return false;
      }

      if (!copyFile(ATHLETES_FILE, ATHLETES_BAK_FILE)) {
        Serial.println("[Storage] 创建运动员文件备份失败，取消保存");
        SD.remove(ATHLETES_TMP_FILE);
        return false;
      }
    }
    int savedCount = 0;
    bool saved = writeAthletesFile(ATHLETES_FILE, athleteManager, savedCount);
    if (!saved) {
      Serial.println("[Storage] 运动员文件保存失败");

      if (hadOldFile) {
        Serial.println("[Storage] 尝试从备份恢复旧运动员文件");
        if (!copyFile(ATHLETES_BAK_FILE, ATHLETES_FILE)) {
          Serial.println("[Storage] 备份恢复失败，请检查TF卡中的 athletes_bak.csv");
        }
      }
      SD.remove(ATHLETES_TMP_FILE);
      return false;
    }
    if (!removeFileIfExists(ATHLETES_TMP_FILE)) {
      Serial.println("[Storage] 保存已完成，但临时文件清理失败");
    }

    if (hadOldFile && !removeFileIfExists(ATHLETES_BAK_FILE)) {
      Serial.println("[Storage] 保存已完成，但备份文件清理失败");
    }
    Serial.print("[Storage] 已保存运动员数量: ");
    Serial.println(savedCount);
    return true;
  }

  bool loadAthletes(AthleteManager* athleteManager) {
    Serial.println("[Storage] 尝试从存储卡中读取运动员数据");
    if (!fsInitialized || athleteManager == nullptr) {
      Serial.println("[Storage] 加载失败: TF卡未初始化或运动员管理器为空");
      return false;
    }
    Serial.println("[Storage] 正在查找运动员文件");
    if (!SD.exists(ATHLETES_FILE)) {
      Serial.print("[Storage] 运动员文件不存在: ");
      Serial.println(ATHLETES_FILE);
      return false;
    }
    Serial.println("[Storage] 正在尝试打开运动员文件");
    File file = SD.open(ATHLETES_FILE, FILE_READ);
    if (!file) {
      Serial.println("[Storage] 无法打开运动员文件");
      return false;
    }

    AthleteManager tempManager;

    int loadedCount = 0;
    int lineNumber = 0;
    Serial.println("[Storage] 开始读取运动员数据");
    while (file.available()) {
      String line = file.readStringUntil('\n');
      Serial.println("line:" + line);
      line.trim();
      lineNumber++;

      if (line.length() == 0) {
        continue;
      }

      String id;
      String name;
      String epc;
      if (!parseAthleteLine(line, id, name, epc)) {
        Serial.print("[Storage] 忽略格式错误行 ");
        Serial.print(lineNumber);
        Serial.print(": ");
        Serial.println(line);
        continue;
      }

      if (tempManager.addAthlete(id, name, epc)) {
        loadedCount++;
        Serial.print("[Storage] 加载运动员: ");
        Serial.print(name);
        Serial.print(" (");
        Serial.print(id);
        Serial.print(") EPC=");
        Serial.println(epc);
      } else {
        Serial.print("[Storage] 运动员加载失败，可能重复或数量已满: ");
        Serial.println(line);
      }
    }

    file.close();

    Serial.print("[Storage] 成功加载运动员数量: ");
    Serial.println(loadedCount);
    if (loadedCount <= 0) {
      Serial.println("[Storage] 未加载到有效运动员，保留当前内存数据");
      return false;
    }

    athleteManager->clearAthletes();
    Athlete* loadedAthletes = tempManager.getAthletes();
    int tempCount = tempManager.getAthleteCount();
    for (int i = 0; i < tempCount; i++) {
      if (!loadedAthletes[i].isActive) continue;

      if (!athleteManager->addAthlete(loadedAthletes[i].id,
                                      loadedAthletes[i].name,
                                      loadedAthletes[i].epc)) {
        Serial.println("[Storage] 临时运动员数据复制失败");
        return false;
      }
    }

    return true;
  }

  bool saveRaceRecord(String raceName, AthleteManager* athleteManager,
                      unsigned long raceDuration) {
    (void)raceName;
    (void)athleteManager;
    (void)raceDuration;
    Serial.println("[Storage] 比赛记录保存尚未实现");
    return false;
  }

  bool deleteFile(const char* filename) {
    if (!fsInitialized || filename == nullptr) return false;

    if (!SD.exists(filename)) {
      Serial.print("[Storage] 文件不存在: ");
      Serial.println(filename);
      return false;
    }

    if (SD.remove(filename)) {
      Serial.print("[Storage] 文件已删除: ");
      Serial.println(filename);
      return true;
    }

    Serial.print("[Storage] 删除文件失败: ");
    Serial.println(filename);
    return false;
  }

  bool format() {
    if (!fsInitialized) return false;

    bool ok = true;
    if (SD.exists(ATHLETES_FILE)) {
      ok = SD.remove(ATHLETES_FILE) && ok;
    }
    if (SD.exists(ATHLETES_TMP_FILE)) {
      ok = SD.remove(ATHLETES_TMP_FILE) && ok;
    }
    if (SD.exists(ATHLETES_BAK_FILE)) {
      ok = SD.remove(ATHLETES_BAK_FILE) && ok;
    }
    Serial.println("[Storage] 已清理运动员数据文件。如需格式化TF卡，请在电脑端执行。");
    return ok;
  }

  size_t getFileSize(const char* filename) {
    if (!fsInitialized || filename == nullptr || !SD.exists(filename)) return 0;

    File file = SD.open(filename, FILE_READ);
    if (!file) return 0;
    size_t size = file.size();
    file.close();
    return size;
  }

  bool isInitialized() { return fsInitialized; }
};

#endif
