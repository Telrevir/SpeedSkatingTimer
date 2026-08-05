#ifndef TIMING_LOGIC_H
#define TIMING_LOGIC_H

#include "AthleteManager.h"
#include "config.h"

// 记录每圈第一个通过计时点的运动员信息
struct LapFirstPass {
  String athleteId;
  unsigned long timestamp;
  int lapNumber;
};

class TimingLogic {
public:
  enum RaceStatus {
    RACE_NOT_STARTED = 0x00,
    RACE_WAITING_ATHLETE = 0x01,
    RACE_RUNNING = 0x02,
    RACE_LEADER_FINISHED = 0x03
  };

private:
  AthleteManager* athleteManager;
  Athlete* currentLeader;
  unsigned long raceStartTime;
  bool raceStarted;
  bool waitingForStart;  // 等待第一名运动员通过计时点
  RaceStatus raceStatus;
  int finishTargetLap;
  unsigned long leaderFinishStartTime;
  unsigned long lapTime = 0;
  
  // 记录每圈第一个通过计时点的运动员（除去被套圈的）
  LapFirstPass lapFirstPasses[MAX_LAPS];
  int lapFirstPassCount;
  
  // 判断运动员是否被套圈
  bool isLapped(Athlete* athlete) {
    if (!currentLeader || !athlete || athlete->lapCount == 0) return false;
    
    // 如果圈数差大于等于1，则被套圈
    int lapDifference = currentLeader->lapCount - athlete->lapCount;
    return lapDifference >= 1;
  }
  
  // 获取未被套圈的运动员中圈数最多的圈数
  int getMaxLapCountExcludingLapped() {
    Athlete* athletes = athleteManager->getAthletes();
    int count = athleteManager->getAthleteCount();
    int maxLaps = 0;
    
    for (int i = 0; i < count; i++) {
      if (!athletes[i].isActive || athletes[i].lapCount == 0) continue;
      if (!isLapped(&athletes[i])) {
        if (athletes[i].lapCount > maxLaps) {
          maxLaps = athletes[i].lapCount;
        }
      }
    }
    
    return maxLaps;
  }
  
  // 获取指定圈数第一个通过计时点的运动员时间（除去被套圈的）
  // 注意：记录时已经排除了被套圈的运动员，所以直接返回即可
  unsigned long getFirstPassTimeForLap(int lapNumber) {
    for (int i = 0; i < lapFirstPassCount; i++) {
      if (lapFirstPasses[i].lapNumber == lapNumber) {
        return lapFirstPasses[i].timestamp;
      }
    }
    return 0;
  }
  
  // 记录当前圈第一个通过计时点的运动员
  // lapNumber: 新圈数（递增后的值）
  void recordLapFirstPass(Athlete* athlete, unsigned long timestamp, int lapNumber) {
    // 检查是否已经有该圈的第一个通过记录
    for (int i = 0; i < lapFirstPassCount; i++) {
      if (lapFirstPasses[i].lapNumber == lapNumber) {
        // 如果当前运动员更早通过，更新记录
        if (timestamp < lapFirstPasses[i].timestamp) {
          lapFirstPasses[i].athleteId = athlete->id;
          lapFirstPasses[i].timestamp = timestamp;
        }
        return;
      }
    }
    
    // 如果没有记录，添加新记录
    if (lapFirstPassCount < MAX_LAPS) {
      lapFirstPasses[lapFirstPassCount].athleteId = athlete->id;
      lapFirstPasses[lapFirstPassCount].timestamp = timestamp;
      lapFirstPasses[lapFirstPassCount].lapNumber = lapNumber;
      lapFirstPassCount++;
    }
  }

  void lockFinishedAthletes() {
    if (raceStatus != RACE_LEADER_FINISHED || finishTargetLap <= 0) return;

    Athlete* athletes = athleteManager->getAthletes();
    int count = athleteManager->getAthleteCount();
    for (int i = 0; i < count; i++) {
      if (!athletes[i].isActive) continue;
      if (athletes[i].lapCount >= finishTargetLap) {
        athletes[i].resultLocked = true;
      }
    }
  }
  
public:
  TimingLogic(AthleteManager* manager) : 
    athleteManager(manager), currentLeader(nullptr), 
    raceStarted(false), waitingForStart(false), raceStatus(RACE_NOT_STARTED),
    finishTargetLap(0), leaderFinishStartTime(0), lapFirstPassCount(0) {}
  
  void startRace() {
    // 进入等待开始状态，不立即开始计时
    waitingForStart = true;
    raceStarted = false;
    raceStatus = RACE_WAITING_ATHLETE;
    raceStartTime = 0;
    finishTargetLap = 0;
    leaderFinishStartTime = 0;
    lapFirstPassCount = 0;
    
    // 重置所有运动员数据
    for (int i = 0; i < athleteManager->getAthleteCount(); i++) {
      Athlete* athlete = &athleteManager->getAthletes()[i];
      if (athlete->isActive) {
        athlete->startTime = 0;
        athlete->lastTime = 0;
        athlete->lapCount = 0;
        athlete->totalTime = 0;
        athlete->lastDetectedTime = 0;
        athlete->rank = 0;
        athlete->resultLocked = false;
      }
    }
    
    currentLeader = nullptr;
    Serial.println("🏁 比赛准备开始 - 等待第一名运动员通过计时点...");
  }
  
  void stopRace() {
    raceStarted = false;
    waitingForStart = false;
    raceStatus = RACE_NOT_STARTED;
    finishTargetLap = 0;
    leaderFinishStartTime = 0;
  }

  void stopRaceTimingOnly() {
    raceStarted = false;
    waitingForStart = false;
    leaderFinishStartTime = 0;
  }

  bool beginLeaderFinish() {
    updateLeader();
    if (currentLeader == nullptr || currentLeader->lapCount <= 0) {
      stopRace();
      return false;
    }

    raceStatus = RACE_LEADER_FINISHED;
    finishTargetLap = currentLeader->lapCount;
    leaderFinishStartTime = millis();
    waitingForStart = false;
    raceStarted = true;
    lockFinishedAthletes();
    return true;
  }

  bool isLeaderFinishTimeout(unsigned long timeoutMs) {
    return raceStatus == RACE_LEADER_FINISHED &&
           leaderFinishStartTime > 0 &&
           millis() - leaderFinishStartTime >= timeoutMs;
  }
  
  bool recordLap(String epc) {
    // 如果还在等待开始，检查是否是第一名运动员
    if (waitingForStart) {
      Athlete* athlete = athleteManager->getAthleteByEPC(epc);
      if (!athlete) return false;
      
      // 第一名运动员通过，正式开始比赛
      unsigned long currentTime = millis();
      raceStartTime = currentTime;
      raceStarted = true;
      waitingForStart = false;
      raceStatus = RACE_RUNNING;
      
      // 初始化第一名运动员的数据
      // 第一次检测：圈数保持为0，只记录检测时间
      athlete->startTime = currentTime;
      athlete->lastTime = currentTime;
      athlete->lapCount = 0;  // 第一次检测，圈数为0
      athlete->totalTime = 0;  // 第一次检测时总用时为0（从比赛开始计时）
      athlete->lastDetectedTime = currentTime;
      
      // 注意：第一次检测时圈数为0，不存储在lapTimes数组中
      // lapTimes[0]将在第二次检测时（圈数变为1）存储
      
      currentLeader = athlete;
      
      Serial.print("✅ 比赛正式开始！第一名运动员: ");
      Serial.print(athlete->name);
      Serial.println(" (第一次检测，圈数: 0)");
      updateAthleteRanks();
      return true;
    }
    
    if (!raceStarted) return false;
    
    // 这里传入的epc已经是8位短EPC
    Athlete* athlete = athleteManager->getAthleteByEPC(epc);
    if (!athlete) return false;

    if (raceStatus == RACE_LEADER_FINISHED && athlete->resultLocked) {
      return false;
    }
    
    unsigned long currentTime = millis();
    
    // 检查是否是第一次检测（圈数为0且从未检测过）
    bool isFirstDetection = (athlete->lapCount == 0 && athlete->lastDetectedTime == 0);
    
    // 防重复检测：检查距离上次检测的时间间隔
    if (athlete->lastDetectedTime > 0) {
      unsigned long timeSinceLastDetection = currentTime - athlete->lastDetectedTime;
      if (timeSinceLastDetection < MIN_LAP_INTERVAL) {
        // 距离上次检测不足10秒，忽略此次检测
        // Serial.print("⏭️ 忽略重复检测: ");
        // Serial.print(athlete->name);
        // Serial.print(" (距离上次检测仅 ");
        // Serial.print(timeSinceLastDetection / 1000.0);
        // Serial.println(" 秒)");
        return false;
      }
    }
    
    // 如果是第一次检测，只记录检测时间，不递增圈数
    if (isFirstDetection) {
      athlete->startTime = currentTime;
      athlete->lastTime = currentTime;
      athlete->lastDetectedTime = currentTime;
      athlete->lapCount = 0;  // 保持为0
      // 总用时从比赛开始（第一名运动员第一次通过）时开始计时
      athlete->totalTime = currentTime - raceStartTime;
      
      // 注意：第一次检测时圈数为0，不存储在lapTimes数组中
      // lapTimes[0]将在第二次检测时（圈数变为1）存储
      
      Serial.print("✅ 第一次检测到运动员: ");
      Serial.print(athlete->name);
      Serial.print(" (圈数: 0, 总用时: ");
      Serial.print(athlete->totalTime / 1000.0);
      Serial.println(" 秒)");
      updateAthleteRanks();
      lockFinishedAthletes();
      return true;
    }
    
    // 更新检测时间
    athlete->lastDetectedTime = currentTime;
    
    // 检查是否超过最大圈数
    if (athlete->lapCount >= MAX_LAPS) {
      Serial.println("⚠️ 警告: 运动员已达到最大圈数限制");
      return false;
    }
    
    // 如果这是运动员的第一圈（从0到1），初始化startTime（如果还未初始化）
    if (athlete->lapCount == 0 && athlete->startTime == 0) {
      athlete->startTime = currentTime;
    }
    
    // 计算上一圈的用时（如果有上一圈）
    // 注意：当圈数从0变为1时，需要计算第一圈的用时
    if (athlete->lapCount >= 0) {
      unsigned long lapTime;
      if (athlete->lapCount == 0) {
        // 第一圈：从startTime到当前时间
        if (athlete->startTime > 0) {
          lapTime = currentTime - athlete->startTime;
        } else {
          lapTime = currentTime - athlete->lastTime;  // 备用方案
        }
      } else {
        // 后续圈：从lastTime到当前时间
        lapTime = currentTime - athlete->lastTime;
      }
      
      // 存储上一圈的用时（在递增前，所以索引是currentLap）
      athlete->lapTimes[athlete->lapCount].lapTime = lapTime;
    }
    
    // 总用时从比赛开始（第一名运动员第一次通过）时开始计时
    // 每次检测时更新总用时
    athlete->totalTime = currentTime - raceStartTime;
    
    // 记录新圈的时间戳（在递增前写入当前索引）
    int currentLap = athlete->lapCount;
    athlete->lapTimes[currentLap].timestamp = currentTime;
    athlete->lastTime = currentTime;
    
    // 递增圈数（第二次检测时从0变为1，表示完成第一圈）
    athlete->lapCount++;
    int newLapNumber = athlete->lapCount;
    
    // 检查是否是当前圈第一个通过计时点的运动员（除去被套圈的）
    int maxLapCount = getMaxLapCountExcludingLapped();
    if (newLapNumber == maxLapCount && !isLapped(athlete)) {
      // 这是当前领先圈数的第一个通过，记录
      recordLapFirstPass(athlete, currentTime, newLapNumber);
    }
    
    updateLeader();
    updateAthleteRanks();
    lockFinishedAthletes();
    return true;
  }
  
  void updateLeader() {
    Athlete* athletes = athleteManager->getAthletes();
    int count = athleteManager->getAthleteCount();
    
    //currentLeader = nullptr;
    int maxLapCount = 0;
    unsigned long minTotalTime = 0;
    
    // 找到圈数最多且总用时最短的运动员
    for (int i = 0; i < count; i++) {
      if (!athletes[i].isActive || athletes[i].lapCount == 0) continue;
      
      if (currentLeader == nullptr) {
        currentLeader = &athletes[i];
        maxLapCount = athletes[i].lapCount;
        minTotalTime = athletes[i].totalTime;
        continue;
      }
      
      int leaderIndex = 0;
      // 优先比较圈数
      if (athletes[i].lapCount > maxLapCount) {
        leaderIndex = i;
        //currentLeader = &athletes[i];
        maxLapCount = athletes[i].lapCount;
        minTotalTime = athletes[i].totalTime;
      } else if (athletes[i].lapCount == maxLapCount) {
        // 圈数相同，比较总用时
        if (athletes[i].totalTime < minTotalTime || minTotalTime == 0) {
          //currentLeader = &athletes[i];
          leaderIndex = i;
          minTotalTime = athletes[i].totalTime;
        }
      }
      
      currentLeader = &athletes[i];
    }
  }

  bool ranksBefore(const Athlete* left, const Athlete* right) {
    if (left == nullptr || right == nullptr) return false;

    if (left->lapCount != right->lapCount) {
      return left->lapCount > right->lapCount;
    }
    if (left->totalTime != right->totalTime) {
      return left->totalTime < right->totalTime;
    }

    // 圈数和总用时完全相同时，使用检测时间保证先扫到者在前。
    unsigned long leftScanTime = left->lastDetectedTime > 0 ? left->lastDetectedTime : left->lastTime;
    unsigned long rightScanTime = right->lastDetectedTime > 0 ? right->lastDetectedTime : right->lastTime;
    if (leftScanTime != rightScanTime) {
      return leftScanTime > 0 && (rightScanTime == 0 || leftScanTime < rightScanTime);
    }

    return left->id.compareTo(right->id) < 0;
  }

  void updateAthleteRanks() {
    Athlete* athletes = athleteManager->getAthletes();
    int count = athleteManager->getAthleteCount();

    for (int i = 0; i < count; i++) {
      athletes[i].rank = 0;
    }

    for (int i = 0; i < count; i++) {
      if (!athletes[i].isActive || athletes[i].lapCount == 0) continue;

      int rank = 1;
      for (int j = 0; j < count; j++) {
        if (i == j || !athletes[j].isActive || athletes[j].lapCount == 0) continue;
        if (ranksBefore(&athletes[j], &athletes[i])) {
          rank++;
        }
      }
      athletes[i].rank = rank;
    }
  }
  
  Athlete* getCurrentLeader() {
    return currentLeader;
  }
  
  // 获取上一圈时的领滑运动员（除去被套圈的）
  // previousLapNumber: 上一圈的圈数（0表示第一次检测，1表示完成第一圈，以此类推）
  Athlete* getLeaderAtLap(int previousLapNumber) {
    Athlete* athletes = athleteManager->getAthletes();
    int count = athleteManager->getAthleteCount();
    Athlete* leader = nullptr;
    int maxLaps = 0;
    unsigned long earliestTime = 0;
    
    // 特殊处理：圈数为0时（第一次检测）
    if (previousLapNumber == 0) {
      // 找到所有圈数为0或1的运动员（在第一次检测时，圈数应该是0）
      for (int i = 0; i < count; i++) {
        if (!athletes[i].isActive) continue;
        
        // 圈数为0或1的运动员都可能是在第一次检测时的状态
        // 使用startTime作为时间戳（第一次检测的时间）
        if (athletes[i].lapCount == 0 || athletes[i].lapCount == 1) {
          unsigned long timestamp = athletes[i].startTime;
          if (timestamp > 0) {
            // 检查该运动员在第一次检测时是否被套圈
            // 如果其他运动员的圈数>0，说明被套圈（但第一次检测时不应该有这种情况）
            bool wasLapped = false;
            for (int j = 0; j < count; j++) {
              if (!athletes[j].isActive || j == i) continue;
              if (athletes[j].lapCount > 0) {
                wasLapped = true;
                break;
              }
            }
            
            if (!wasLapped) {
              // 未被套圈，可以作为候选领滑
              if (leader == nullptr) {
                leader = &athletes[i];
                earliestTime = timestamp;
              } else {
                // 选择时间戳更早的（更早通过计时点）
                if (timestamp < earliestTime) {
                  leader = &athletes[i];
                  earliestTime = timestamp;
                }
              }
            }
          }
        }
      }
      return leader;
    }
    
    // 处理圈数>=1的情况
    for (int i = 0; i < count; i++) {
      if (!athletes[i].isActive || athletes[i].lapCount == 0) continue;
      
      // 检查该运动员在上一圈时的圈数
      int athleteLapAtPreviousLap = (athletes[i].lapCount >= previousLapNumber) ? previousLapNumber : athletes[i].lapCount;
      
      if (athleteLapAtPreviousLap == previousLapNumber) {
        // 该运动员在上一圈时达到了previousLapNumber圈
        // 检查其时间戳是否存在
        unsigned long timestamp = 0;
        if (previousLapNumber == 1) {
          // 圈数为1时，时间戳在lapTimes[0]
          timestamp = athletes[i].lapTimes[0].timestamp;
        } else if (previousLapNumber > 1) {
          // 圈数>1时，时间戳在lapTimes[previousLapNumber-1]
          timestamp = athletes[i].lapTimes[previousLapNumber - 1].timestamp;
        }
        
        if (timestamp > 0) {
          // 检查该运动员在上一圈时是否被套圈
          // 需要检查是否有其他运动员在上一圈时的圈数更多
          bool wasLapped = false;
          for (int j = 0; j < count; j++) {
            if (!athletes[j].isActive || j == i) continue;
            // 如果其他运动员在上一圈时的圈数更多，说明被套圈
            if (athletes[j].lapCount > previousLapNumber) {
              wasLapped = true;
              break;
            }
          }
          
          if (!wasLapped) {
            // 未被套圈，可以作为候选领滑
            if (leader == nullptr) {
              leader = &athletes[i];
              maxLaps = previousLapNumber;
              earliestTime = timestamp;
            } else {
              // 选择时间戳更早的（更早通过计时点）
              if (timestamp < earliestTime) {
                leader = &athletes[i];
                earliestTime = timestamp;
              }
            }
          }
        }
      }
    }
    
    return leader;
  }
  
  // 获取领滑运动员的上圈用时
  // 计算方法：上一圈的领滑运动员通过计时点的时间到当前圈领滑运动员通过计时点的时间之间的时长
  // 注意：根据新的圈数逻辑，圈数1表示完成第一圈，圈数2表示完成第二圈
  unsigned long getLeaderLastLapTime() {
    if (!currentLeader || currentLeader->lapCount < 1) return 0;
    
    int currentLap = currentLeader->lapCount;  // 当前圈数（已递增）
    int previousLap = currentLap - 1;  // 上一圈数
    
    // 获取当前圈领滑运动员通过计时点的时间
    // lapTimes数组索引从0开始，当前圈的时间戳在currentLap-1位置（因为lapCount已递增）
    unsigned long currentLapTime = currentLeader->lapTimes[currentLap - 1].timestamp;
    if (currentLapTime == 0) return 0;
    
    // 获取上一圈时的领滑运动员（除去被套圈的）
    Athlete* previousLapLeader = getLeaderAtLap(previousLap);
    if (previousLapLeader == nullptr) {
      // 如果找不到上一圈的领滑运动员，可能是第一圈，使用startTime
      if (currentLap == 1 && currentLeader->startTime > 0) {
        return currentLapTime - currentLeader->startTime;
      }
      return 0;
    }
    
    // 获取上一圈领滑运动员通过计时点的时间
    unsigned long previousLapTime = 0;
    if (previousLap == 0) {
      // 上一圈是0圈，使用startTime（第一次检测的时间）
      previousLapTime = previousLapLeader->startTime;
    } else {
      // 上一圈>=1，使用lapTimes数组
      previousLapTime = previousLapLeader->lapTimes[previousLap - 1].timestamp;
    }
    
    if (previousLapTime == 0) return 0;
    
    // 计算差值：当前圈领滑通过时间 - 上一圈领滑通过时间
    return currentLapTime - previousLapTime;
  }
  
  // 获取运动员的排名（1-based）
  int getAthleteRank(Athlete* athlete) {
    if (!athlete || athlete->lapCount == 0) return 0;
    return athlete->rank;
  }
  
  // 计算运动员与领滑的差距
  // 返回结构：{isLapped: bool, gapValue: unsigned long}
  // 如果被套圈，gapValue是圈数差；否则是时间差（毫秒）
  struct GapInfo {
    bool isLapped;
    unsigned long gapValue;  // 圈数差（被套圈时）或时间差（毫秒）
  };
  
  GapInfo getGapFromLeader(Athlete* athlete) {
    GapInfo gap;
    gap.isLapped = false;
    gap.gapValue = 0;
    
    if (!athlete || !currentLeader || athlete->lapCount == 0) {
      return gap;
    }
    
    int lapDifference = currentLeader->lapCount - athlete->lapCount;
    
    if (lapDifference >= 1) {
      // 被套圈，返回圈数差
      gap.isLapped = true;
      gap.gapValue = lapDifference;
    } else {
      // 未被套圈，返回时间差（总用时差）
      gap.isLapped = false;
      if (athlete->totalTime < currentLeader->totalTime) {
        gap.gapValue = currentLeader->totalTime - athlete->totalTime;
      } else {
        gap.gapValue = 0;  // 不应该出现这种情况，但保险起见
      }
    }
    
    return gap;
  }
  
  unsigned long getRaceDuration() {
    return raceStarted ? (millis() - raceStartTime) : 0;
  }
  
  bool isRaceStarted() { return raceStarted; }
  bool isWaitingForStart() { return waitingForStart; }
  RaceStatus getRaceStatus() { return raceStatus; }
  byte getRaceStatusByte() { return (byte)raceStatus; }
  int getFinishTargetLap() { return finishTargetLap; }
  unsigned long getLeaderFinishStartTime() { return leaderFinishStartTime; }
};

#endif
