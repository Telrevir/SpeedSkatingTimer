#ifndef RFID_POLLING_STATE_H
#define RFID_POLLING_STATE_H

#include <stdint.h>

enum class RfidPollingAction : uint8_t {
  None,
  SendSingleInventory
};

class RfidPollingState {
private:
  bool passiveMode_;
  bool running_;
  bool waitingForResponse_;
  bool receivedByte_;
  uint32_t responseStartedMs_;
  uint32_t lastByteMs_;
  uint32_t responseTimeoutMs_;
  uint32_t interFrameGapMs_;

  bool elapsed(uint32_t nowMs, uint32_t sinceMs, uint32_t durationMs) const {
    return nowMs - sinceMs >= durationMs;
  }

public:
  RfidPollingState(bool passiveMode, uint32_t responseTimeoutMs,
                   uint32_t interFrameGapMs)
    : passiveMode_(passiveMode), running_(false), waitingForResponse_(false),
      receivedByte_(false), responseStartedMs_(0), lastByteMs_(0),
      responseTimeoutMs_(responseTimeoutMs), interFrameGapMs_(interFrameGapMs) {}

  void start(uint32_t nowMs) {
    running_ = true;
    waitingForResponse_ = false;
    receivedByte_ = false;
    responseStartedMs_ = nowMs;
    lastByteMs_ = nowMs;
  }

  void stop() {
    running_ = false;
    waitingForResponse_ = false;
    receivedByte_ = false;
  }

  void noteByteReceived(uint32_t nowMs) {
    if (!running_ || passiveMode_ || !waitingForResponse_) return;
    receivedByte_ = true;
    lastByteMs_ = nowMs;
  }

  // E720空盘点响应已明确结束本次单次盘点。
  void finishRound() {
    if (!passiveMode_) waitingForResponse_ = false;
  }

  RfidPollingAction takeAction(uint32_t nowMs) {
    if (!running_ || passiveMode_) {
      //***测试代码，稍后删除 */
      if(!running_){
        Serial.println("polling失败：当前没有运行");
      }
      else{
        Serial.println("polling失败：当前为被动模式");
      }
      return RfidPollingAction::None;
    }

    if (waitingForResponse_) {
      if (receivedByte_) {
        if (!elapsed(nowMs, lastByteMs_, interFrameGapMs_)) {
          return RfidPollingAction::None;
        }
      } else if (!elapsed(nowMs, responseStartedMs_, responseTimeoutMs_)) {
        return RfidPollingAction::None;
      }
      waitingForResponse_ = false;
    }

    waitingForResponse_ = true;
    receivedByte_ = false;
    responseStartedMs_ = nowMs;
    return RfidPollingAction::SendSingleInventory;
  }
};

#endif
