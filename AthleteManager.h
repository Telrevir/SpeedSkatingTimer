#ifndef ATHLETE_MANAGER_H
#define ATHLETE_MANAGER_H

#include <Arduino.h>

struct LapTime {
  unsigned long timestamp;
  unsigned long lapTime;
};

struct Athlete {
  String id;
  String name;
  String epc;
  int lapCount;
  unsigned long startTime;
  unsigned long lastTime;
  unsigned long totalTime;
  unsigned long lastDetectedTime;  // 上次检测到标签的时间（用于防重复检测）
  int rank;                        // 当前比赛排名，0 表示未排名
  bool resultLocked;               // 收尾阶段成绩锁定后不再更新
  LapTime lapTimes[MAX_LAPS];
  bool isActive;
  
  Athlete() {
    lapCount = 0;
    startTime = 0;
    lastTime = 0;
    totalTime = 0;
    lastDetectedTime = 0;
    rank = 0;
    resultLocked = false;
    isActive = false;
  }
};

class AthleteManager {
private:
  Athlete athletes[MAX_ATHLETES];
  //已记录运动员总数（包括已删除）
  int athleteCount;
  
public:
  AthleteManager() : athleteCount(0) {}
  
  bool addAthlete(String id, String name, String epc) {
    if (athleteCount >= MAX_ATHLETES) return false;
    
    // 检查ID是否已存在
    if (getAthleteByID(id) != nullptr) {
      return false;  // ID已存在
    }
    
    // 检查EPC是否已存在（如果EPC不为空）
    if (epc.length() > 0 && getAthleteByEPC(epc) != nullptr) {
      return false;  // EPC已存在
    }
 
    athletes[athleteCount].id = id;
    athletes[athleteCount].name = name;
    athletes[athleteCount].epc = epc;
    athletes[athleteCount].rank = 0;
    athletes[athleteCount].resultLocked = false;
    athletes[athleteCount].isActive = true;
    athleteCount++;
    return true;
  }

  int addAthleteTEST(String id, String name, String epc) {
    if (getActiveAthleteCount() >= MAX_ATHLETES) return 0;
    
    // 检查ID是否已存在
    if (getAthleteByID(id) != nullptr) {
      return 1;  // ID已存在
    }
    
    // 检查EPC是否已存在（如果EPC不为空）
    if (epc.length() > 0 && getAthleteByEPC(epc) != nullptr) {
      return 2;  // EPC已存在
    }
    //运动员数组数量已满
    if(athleteCount >= MAX_ATHLETES){
      for (int i = 0; i < athleteCount; i++) {
        if(!athletes[i].isActive){
          athletes[i].id = id;
          athletes[i].name = name;
          athletes[i].epc = epc;
          athletes[i].rank = 0;
          athletes[i].resultLocked = false;
          athletes[i].isActive = true;
        }
      }
    }
    else{
      athletes[athleteCount].id = id;
      athletes[athleteCount].name = name;
      athletes[athleteCount].epc = epc;
      athletes[athleteCount].rank = 0;
      athletes[athleteCount].resultLocked = false;
      athletes[athleteCount].isActive = true;
      athleteCount++;
    }  
    return 3;
  }
  
  Athlete* getAthleteByEPC(String epc) {
    // 统一转换为大写进行比较（EPC是十六进制，应该区分大小写，但为了兼容性统一处理）
    epc.toUpperCase();
    for (int i = 0; i < athleteCount; i++) {
      String storedEPC = athletes[i].epc;
      storedEPC.toUpperCase();
      if (storedEPC == epc && athletes[i].isActive) {
        return &athletes[i];
      }
    }
    return nullptr;
  }
  
  Athlete* getAthleteByID(String id) {
    for (int i = 0; i < athleteCount; i++) {
      if (athletes[i].id == id && athletes[i].isActive) {
        return &athletes[i];
      }
    }
    return nullptr;
  }
  
  bool removeAthlete(String id) {
    for (int i = 0; i < athleteCount; i++) {
      if (athletes[i].id == id) {
        athletes[i].isActive = false;
        return true;
      }
    }
    return false;
  }
  
  bool editAthlete(String id,String name,String epc){
    for (int i = 0; i < athleteCount; i++) {
      if (athletes[i].id == id && athletes[i].isActive == true) {
        athletes[i].epc = epc;
        athletes[i].name = name;
        return true;
      }
    }
    return false;
  }
  
  int getActiveAthleteCount() {
    int count = 0;
    for (int i = 0; i < athleteCount; i++) {
      if (athletes[i].isActive) count++;
    }
    return count;
  }

  void clearAthletes() {
    for (int i = 0; i < MAX_ATHLETES; i++) {
      athletes[i] = Athlete();
    }
    athleteCount = 0;
  }

  
  
  Athlete* getAthletes() { return athletes; }
  int getAthleteCount() { return athleteCount; }
};

#endif
