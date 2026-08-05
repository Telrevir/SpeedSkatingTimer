#ifndef DATA_SENDER_H
#define DATA_SENDER_H

#include <Arduino.h>
#include "AthleteManager.h"
#include "TimingLogic.h"

class DataSender {
private:
  bool networkConnected;

public:
  DataSender() : networkConnected(false) {}

  bool connectNetwork() {
    Serial.println("[DataSender] 网络发送功能已停用");
    networkConnected = false;
    return false;
  }

  bool sendRaceData(Athlete* athletes, int count, Athlete* leader,
                    unsigned long raceDuration, TimingLogic* timingLogic) {
    (void)athletes;
    (void)count;
    (void)leader;
    (void)raceDuration;
    (void)timingLogic;
    Serial.println("[DataSender] 网络比赛数据发送已停用");
    return false;
  }

  bool isConnected() { return false; }

  void setNetworkConnected(bool connected) {
    (void)connected;
    networkConnected = false;
  }
};

#endif
