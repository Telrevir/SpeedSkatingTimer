#ifndef RFID_READER_H
#define RFID_READER_H

#include <Arduino.h>
#include <HardwareSerial.h>
#include "config.h"
#include "RfidPollingState.h"
#include "RfidTagEvent.h"

enum class RfidError : uint8_t {
  None,
  InvalidFrame,
  IoFailure
};

class RFIDReader {
private:
  static constexpr uint8_t QUEUE_CAPACITY = 64;
  static constexpr uint16_t FRAME_CAPACITY = 128;
  static constexpr uint16_t MAX_BYTES_PER_POLL = 96;
  // 2026-10-01：无响应重试由300ms缩短为100ms，减少读写器失联后的恢复等待。
  static constexpr uint32_t ACTIVE_RESPONSE_TIMEOUT_MS = 100;
  static constexpr uint32_t ACTIVE_INTER_FRAME_GAP_MS = 20;

  HardwareSerial serial_;
  uint8_t inventoryCommand_[7] = CMD_SINGLE_INVENTORY;
  uint8_t multipleInventoryCommand_[10] = CMD_MULTIPLE_INVENTORY;
  uint8_t stopCommand_[7] = CMD_STOP_INVENTORY;
  uint8_t frame_[FRAME_CAPACITY];
  uint16_t frameLength_;
  uint16_t expectedLength_;
  RfidTagEvent queue_[QUEUE_CAPACITY];
  uint8_t queueRead_;
  uint8_t queueWrite_;
  uint8_t queueCount_;
  bool ready_;
  bool reading_;
  bool queueOverflowed_;
  RfidError error_;
  RfidPollingState pollingState_;

  bool checksumValid() const {
    if (frameLength_ < 7) return false;
    uint8_t sum = 0;
    for (uint16_t i = 1; i < frameLength_ - 2; ++i) sum += frame_[i];
    return sum == frame_[frameLength_ - 2];
  }

  void drainInput(uint32_t maxDurationMs = 20) {
    uint32_t startedAt = millis();
    while (serial_.available() > 0 && millis() - startedAt < maxDurationMs) {
      serial_.read();
    }
  }

  bool enqueue(const RfidTagEvent& event) {
    if (queueCount_ >= QUEUE_CAPACITY) {
      queueOverflowed_ = true;
      return false;
    }
    queue_[queueWrite_] = event;
    queueWrite_ = (queueWrite_ + 1) % QUEUE_CAPACITY;
    ++queueCount_;
    return true;
  }

  void processFrame() {
    if (!checksumValid()) {
      error_ = RfidError::InvalidFrame;
      return;
    }

    uint16_t dataLength = (static_cast<uint16_t>(frame_[3]) << 8) | frame_[4];
    if (frameLength_ != dataLength + 7) {
      error_ = RfidError::InvalidFrame;
      return;
    }

    // E720空盘点帧表示本轮单次盘点已经结束，可立即安排下一轮。
    if (frame_[1] == 0x01 && frame_[2] == 0xFF &&
        dataLength == 1 && frame_[5] == 0x15) {
      pollingState_.finishRound();
      return;
    }

    if (frame_[1] != 0x02 || frame_[2] != 0x22) return;
    if (frameLength_ < 12 || dataLength < 9) {
      error_ = RfidError::InvalidFrame;
      return;
    }

    // RFID响应中EPC从byte8开始，DetectOnly只使用前4字节。
    uint32_t epc = (static_cast<uint32_t>(frame_[8]) << 24) |
                   (static_cast<uint32_t>(frame_[9]) << 16) |
                   (static_cast<uint32_t>(frame_[10]) << 8) |
                   static_cast<uint32_t>(frame_[11]);
    RfidTagEvent event = {
      epc,
      static_cast<int8_t>(frame_[5]),
      millis()
    };
    enqueue(event);
  }

  void consumeByte(uint8_t value) {
    if (frameLength_ == 0) {
      if (value != 0xBB) return;
      frame_[frameLength_++] = value;
      expectedLength_ = 0;
      return;
    }

    if (frameLength_ >= FRAME_CAPACITY) {
      error_ = RfidError::InvalidFrame;
      frameLength_ = 0;
      expectedLength_ = 0;
      return;
    }
    frame_[frameLength_++] = value;

    if (frameLength_ == 5) {
      uint16_t payloadLength =
        (static_cast<uint16_t>(frame_[3]) << 8) | frame_[4];
      expectedLength_ = payloadLength + 7;
      if (expectedLength_ < 7 || expectedLength_ > FRAME_CAPACITY) {
        error_ = RfidError::InvalidFrame;
        frameLength_ = 0;
        expectedLength_ = 0;
      }
      return;
    }

    if (expectedLength_ > 0 && frameLength_ == expectedLength_) {
      if (frame_[expectedLength_ - 1] == 0x7E) {
        processFrame();
      } else {
        error_ = RfidError::InvalidFrame;
      }
      frameLength_ = 0;
      expectedLength_ = 0;
    }
  }

  void readAvailableBytes() {
    uint16_t bytesRead = 0;
    while (serial_.available() > 0 && bytesRead < MAX_BYTES_PER_POLL) {
      uint32_t receivedAt = millis();
      pollingState_.noteByteReceived(receivedAt);
      consumeByte(static_cast<uint8_t>(serial_.read()));
      ++bytesRead;
    }
  }

  bool checkConnection() {
    const uint8_t command[] = {0xBB, 0x00, 0x03, 0x00, 0x01, 0x00, 0x04, 0x7E};
    drainInput();
    if (serial_.write(command, sizeof(command)) != sizeof(command)) return false;
    uint32_t startedAt = millis();
    while (serial_.available() == 0 && millis() - startedAt < 300) yield();
    bool responded = serial_.available() > 0;
    drainInput();
    return responded;
  }

public:
  RFIDReader()
    : serial_(RFID_SERIAL_RX, RFID_SERIAL_TX),
      frameLength_(0), expectedLength_(0), queueRead_(0), queueWrite_(0),
      queueCount_(0), ready_(false), reading_(false), queueOverflowed_(false),
      error_(RfidError::None),
      pollingState_(RFID_USE_PASSIVE_INVENTORY, ACTIVE_RESPONSE_TIMEOUT_MS,
                    ACTIVE_INTER_FRAME_GAP_MS) {}

  bool begin() {
    serial_.begin(RFID_BAUDRATE);
    delay(1000);
    ready_ = checkConnection();
    Serial.println(ready_ ? "[RFID] 初始化成功" :
                            "[错误] RFID初始化失败，请检查接线和供电");
    return ready_;
  }

  bool isReady() const { return ready_; }
  bool hasEpc() const { return queueCount_ > 0; }

  bool startInventory() {
    if (!ready_) return false;
    if (reading_) return true;

    pollingState_.start(millis());
    if (RFID_USE_PASSIVE_INVENTORY &&
        serial_.write(multipleInventoryCommand_, sizeof(multipleInventoryCommand_)) !=
          sizeof(multipleInventoryCommand_)) {
      pollingState_.stop();
      return false;
    }
    reading_ = true;
    return true;
  }

  bool stopInventory() {
    if (!ready_) return false;
    if (!reading_) return true;
    if (serial_.write(stopCommand_, sizeof(stopCommand_)) != sizeof(stopCommand_))
      return false;
    reading_ = false;
    pollingState_.stop();
    return true;
  }

  void poll() {
    if (!reading_) return;
    readAvailableBytes();

    if (pollingState_.takeAction(millis()) ==
        RfidPollingAction::SendSingleInventory) {
      if (serial_.write(inventoryCommand_, sizeof(inventoryCommand_)) !=
          sizeof(inventoryCommand_)) {
        error_ = RfidError::IoFailure;
        pollingState_.finishRound();
      }
    }
  }

  bool readTagEvent(RfidTagEvent& event) {
    if (queueCount_ == 0) return false;
    event = queue_[queueRead_];
    queueRead_ = (queueRead_ + 1) % QUEUE_CAPACITY;
    --queueCount_;
    return true;
  }

  void clearQueue() {
    queueRead_ = 0;
    queueWrite_ = 0;
    queueCount_ = 0;
    queueOverflowed_ = false;
    error_ = RfidError::None;
    frameLength_ = 0;
    expectedLength_ = 0;
    drainInput();
  }

  bool takeQueueOverflow() {
    bool value = queueOverflowed_;
    queueOverflowed_ = false;
    return value;
  }

  RfidError takeError() {
    RfidError value = error_;
    error_ = RfidError::None;
    return value;
  }
};

#endif
