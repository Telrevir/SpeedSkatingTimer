#ifndef LORA_MANAGER_H
#define LORA_MANAGER_H

#include <Arduino.h>
#include <HardwareSerial.h>
#include "config.h"
#include "DetectProtocol.h"
#include "DetectionController.h"

typedef void (*DetectCommandHandler)(uint8_t commandId,
                                     const uint8_t* payload,
                                     uint8_t payloadLength);

class LoraManager {
private:
  enum class RxState : uint8_t {
    WaitHeader,
    ReadCommand,
    ReadLength,
    ReadPayload,
    ReadChecksum,
    ReadTail
  };

  HardwareSerial serial_;
  DetectCommandHandler commandHandler_;
  RxState rxState_;
  uint8_t commandId_;
  uint8_t payloadLength_;
  uint8_t payload_[DetectProtocol::MAX_PAYLOAD_LENGTH];
  uint8_t payloadIndex_;
  uint8_t receivedChecksum_;
  bool ready_;
  uint32_t lastRxByteAtMs_;

  static constexpr uint32_t RX_TIMEOUT_MS = 200UL;

  void resetReceiver() {
    rxState_ = RxState::WaitHeader;
    commandId_ = 0;
    payloadLength_ = 0;
    payloadIndex_ = 0;
    receivedChecksum_ = 0;
  }

  void printCommand(uint8_t commandId) {
    if (commandId < 0x10) Serial.print('0');
    Serial.print(commandId, HEX);
  }

  bool sendPacket(uint8_t commandId, const uint8_t* payload,
                  uint8_t payloadLength) {
    if (!ready_) {
      Serial.println("[错误] LoRa未初始化，无法发送数据");
      return false;
    }

    uint8_t packet[DetectProtocol::MAX_PAYLOAD_LENGTH + 5];
    size_t packetLength = DetectProtocol::encodePacket(
      commandId, payload, payloadLength, packet, sizeof(packet));
    if (packetLength == 0) {
      Serial.println("[错误] LoRa发送失败：Payload长度超过上限");
      return false;
    }

    if (serial_.write(packet, packetLength) != packetLength) {
      Serial.println("[错误] LoRa串口写入不完整");
      return false;
    }
    return true;
  }

  void processPacket() {
    if (!DetectProtocol::isAppCommand(commandId_)) {
      Serial.print("[错误] 收到未知命令：0x");
      printCommand(commandId_);
      Serial.println();
      sendStatus(commandId_, DetectProtocol::STATUS_UNKNOWN_COMMAND);
      return;
    }

    if (payloadLength_ != DetectProtocol::expectedPayloadLength(commandId_)) {
      Serial.print("[错误] 命令Payload长度错误：0x");
      printCommand(commandId_);
      Serial.println();
      sendStatus(commandId_, DetectProtocol::STATUS_LENGTH_ERROR);
      return;
    }

    if (commandHandler_ == nullptr) {
      Serial.println("[错误] LoRa命令处理器未设置");
      sendStatus(commandId_, DetectProtocol::STATUS_STATE_NOT_ALLOWED);
      return;
    }
    commandHandler_(commandId_, payload_, payloadLength_);
  }

  void consumeByte(uint8_t value) {
    switch (rxState_) {
      case RxState::WaitHeader:
        if (value == DetectProtocol::PACKET_HEADER) rxState_ = RxState::ReadCommand;
        break;

      case RxState::ReadCommand:
        commandId_ = value;
        rxState_ = RxState::ReadLength;
        break;

      case RxState::ReadLength:
        payloadLength_ = value;
        payloadIndex_ = 0;
        if (payloadLength_ > DetectProtocol::MAX_PAYLOAD_LENGTH) {
          Serial.println("[错误] 数据包Payload长度超过上限");
          sendStatus(commandId_, DetectProtocol::STATUS_PAYLOAD_TOO_LONG);
          resetReceiver();
        } else {
          rxState_ = payloadLength_ == 0 ? RxState::ReadChecksum : RxState::ReadPayload;
        }
        break;

      case RxState::ReadPayload:
        payload_[payloadIndex_++] = value;
        if (payloadIndex_ == payloadLength_) rxState_ = RxState::ReadChecksum;
        break;

      case RxState::ReadChecksum:
        receivedChecksum_ = value;
        rxState_ = RxState::ReadTail;
        break;

      case RxState::ReadTail:
        if (value != DetectProtocol::PACKET_TAIL) {
          Serial.println("[错误] 数据包尾错误");
          sendStatus(commandId_, DetectProtocol::STATUS_TAIL_ERROR);
        } else if (receivedChecksum_ != DetectProtocol::checksum(
                     commandId_, payloadLength_, payload_)) {
          Serial.println("[错误] 数据包校验和错误");
          sendStatus(commandId_, DetectProtocol::STATUS_CHECKSUM_ERROR);
        } else {
          processPacket();
        }
        resetReceiver();
        break;
    }
  }

public:
  LoraManager()
    : serial_(LORA_SERIAL_RX, LORA_SERIAL_TX),
      commandHandler_(nullptr),
      rxState_(RxState::WaitHeader),
      commandId_(0),
      payloadLength_(0),
      payloadIndex_(0),
      receivedChecksum_(0),
      ready_(false),
      lastRxByteAtMs_(0) {}

  bool begin(DetectCommandHandler commandHandler) {
    commandHandler_ = commandHandler;
    serial_.begin(LORA_BAUD_RATE);
    pinMode(LORA_AUX_PIN, INPUT_PULLUP);
    ready_ = true;
    Serial.println("[LoRa] 初始化成功");
    return true;
  }

  void handleReceive() {
    if (!ready_) return;
    if (rxState_ != RxState::WaitHeader &&
        millis() - lastRxByteAtMs_ > RX_TIMEOUT_MS) {
      Serial.println("[错误] LoRa数据包接收超时，已丢弃截断包");
      sendStatus(commandId_, DetectProtocol::STATUS_RECEIVE_TIMEOUT);
      resetReceiver();
    }
    uint8_t count = 0;
    while (serial_.available() > 0 && count < 64) {
      consumeByte(static_cast<uint8_t>(serial_.read()));
      lastRxByteAtMs_ = millis();
      ++count;
    }
  }

  bool sendRaceStatus(bool running) {
    uint8_t payload[1] = {static_cast<uint8_t>(running ? 0x01 : 0x00)};
    return sendPacket(DetectProtocol::CMD_STATE, payload, sizeof(payload));
  }

  bool sendAthlete(const AthleteInfo& athlete) {
    uint8_t payload[9];
    DetectProtocol::buildAthletePayload(
      athlete.id, athlete.lapCount, athlete.lapCentiseconds,
      athlete.totalCentiseconds, payload);
    return sendPacket(DetectProtocol::CMD_ATHLETE, payload, sizeof(payload));
  }

  bool sendAthleteTransfer(bool started) {
    uint8_t payload[1] = {static_cast<uint8_t>(started ? 0x01 : 0x00)};
    return sendPacket(DetectProtocol::CMD_ATHLETE_TRANSFER,
                      payload, sizeof(payload));
  }

  bool sendDetectedEpc(uint32_t epc) {
    uint8_t payload[4];
    DetectProtocol::buildEpcPayload(epc, payload);
    return sendPacket(DetectProtocol::CMD_EPC, payload, sizeof(payload));
  }

  bool sendStatus(uint8_t sourceCommandId, uint8_t status) {
    uint8_t payload[2] = {sourceCommandId, status};
    return sendPacket(DetectProtocol::CMD_STATUS, payload, sizeof(payload));
  }
};

#endif
