#include "config.h"
#include "DetectProtocol.h"
#include "DetectionController.h"
#include "LoraManager.h"
#include "RFIDReader.h"

DetectionController detectionController;
LoraManager loraManager;
RFIDReader rfidReader;

void printEpc(uint32_t epc) {
  if (epc < 0x10000000UL) Serial.print('0');
  if (epc < 0x01000000UL) Serial.print('0');
  if (epc < 0x00100000UL) Serial.print('0');
  if (epc < 0x00010000UL) Serial.print('0');
  if (epc < 0x00001000UL) Serial.print('0');
  if (epc < 0x00000100UL) Serial.print('0');
  if (epc < 0x00000010UL) Serial.print('0');
  Serial.print(epc, HEX);
}

void sendStatus(uint8_t commandId, uint8_t status, const char* message) {
  Serial.print(status == DetectProtocol::STATUS_SUCCESS ? "[控制] " : "[错误] ");
  Serial.println(message);
  if (!loraManager.sendStatus(commandId, status)) {
    Serial.println("[错误] 返回执行状态失败：LoRa发送失败");
  }
}

void sendAthlete(const AthleteInfo& athlete, const char* errorMessage) {
  if (!loraManager.sendAthlete(athlete)) {
    sendStatus(DetectProtocol::CMD_ATHLETE,
               DetectProtocol::STATUS_LORA_SEND_FAILED, errorMessage);
  }
}

void defineEpc(const uint8_t* payload, uint8_t payloadLength) {
  DetectProtocol::DefineEpcData definition{};
  if (!DetectProtocol::decodeDefineEpc(payload, payloadLength, definition)) {
    sendStatus(DetectProtocol::CMD_DEFINE_EPC,
               DetectProtocol::STATUS_EPC_FORMAT_ERROR,
               "定义EPC失败：参数格式错误");
    return;
  }

  AthleteInfo athlete{};
  DefineResult result = detectionController.defineEpc(
    definition.isAthlete, definition.epc, definition.athleteId,
    millis(), athlete);

  if (result == DefineResult::StateNotAllowed) {
    sendStatus(DetectProtocol::CMD_DEFINE_EPC,
               DetectProtocol::STATUS_STATE_NOT_ALLOWED,
               "定义EPC失败：当前未处于检测中");
    return;
  }
  if (result == DefineResult::TableFull) {
    sendStatus(DetectProtocol::CMD_DEFINE_EPC,
               DetectProtocol::STATUS_DEDUP_TABLE_FULL,
               "定义EPC失败：临时列表已满");
    return;
  }

  if (result == DefineResult::Blacklisted) {
    sendStatus(DetectProtocol::CMD_DEFINE_EPC,
               DetectProtocol::STATUS_SUCCESS,
               "非运动员EPC定义成功");
    return;
  }

  // 协议要求先确认0x10成功，再立即返回0x12运动员信息。
  sendStatus(DetectProtocol::CMD_DEFINE_EPC,
             DetectProtocol::STATUS_SUCCESS,
             "运动员定义成功");
  sendAthlete(athlete, "运动员初始信息发送失败：LoRa发送失败");
}

void sendAllAthletes() {
  if (!detectionController.isRunning()) {
    sendStatus(DetectProtocol::CMD_GET_ATHLETES,
               DetectProtocol::STATUS_STATE_NOT_ALLOWED,
               "获取运动员信息失败：当前未处于检测中");
    return;
  }

  if (!loraManager.sendAthleteTransfer(true)) {
    sendStatus(DetectProtocol::CMD_GET_ATHLETES,
               DetectProtocol::STATUS_LORA_SEND_FAILED,
               "发送运动员列表开始状态失败");
    return;
  }

  AthleteInfo athlete{};
  for (size_t slot = 0; slot < detectionController.athleteSlotCount(); ++slot) {
    if (!detectionController.athleteAt(slot, athlete)) continue;
    if (!loraManager.sendAthlete(athlete)) {
      sendStatus(DetectProtocol::CMD_GET_ATHLETES,
                 DetectProtocol::STATUS_LORA_SEND_FAILED,
                 "发送运动员信息失败");
      break;
    }
  }

  if (!loraManager.sendAthleteTransfer(false)) {
    sendStatus(DetectProtocol::CMD_GET_ATHLETES,
               DetectProtocol::STATUS_LORA_SEND_FAILED,
               "发送运动员列表结束状态失败");
  }
}

void handleDetectCommand(uint8_t commandId, const uint8_t* payload,
                         uint8_t payloadLength) {
  if (commandId == DetectProtocol::CMD_START) {
    if (detectionController.isRunning()) {
      sendStatus(commandId, DetectProtocol::STATUS_STATE_NOT_ALLOWED,
                 "开始检测失败：当前已经处于检测中");
      return;
    }
    if (!rfidReader.isReady()) {
      sendStatus(commandId, DetectProtocol::STATUS_RFID_NOT_READY,
                 "开始检测失败：RFID未初始化");
      return;
    }

    rfidReader.clearQueue();
    if (!rfidReader.startInventory()) {
      sendStatus(commandId, DetectProtocol::STATUS_RFID_START_FAILED,
                 "开始检测失败：RFID启动失败");
      return;
    }
    detectionController.start(millis());
    sendStatus(commandId, DetectProtocol::STATUS_SUCCESS, "开始检测成功");
    return;
  }

  if (commandId == DetectProtocol::CMD_STOP) {
    if (!detectionController.isRunning()) {
      sendStatus(commandId, DetectProtocol::STATUS_STATE_NOT_ALLOWED,
                 "结束检测失败：当前已经处于停止状态");
      return;
    }
    if (!rfidReader.stopInventory()) {
      sendStatus(commandId, DetectProtocol::STATUS_RFID_STOP_FAILED,
                 "结束检测失败：RFID停止失败");
      return;
    }
    detectionController.stop();
    rfidReader.clearQueue();
    sendStatus(commandId, DetectProtocol::STATUS_SUCCESS, "结束检测成功");
    return;
  }

  if (commandId == DetectProtocol::CMD_GET_STATE) {
    if (!loraManager.sendRaceStatus(detectionController.isRunning())) {
      Serial.println("[错误] 返回比赛状态失败：LoRa发送失败");
    }
    return;
  }

  if (commandId == DetectProtocol::CMD_DEFINE_EPC) {
    defineEpc(payload, payloadLength);
    return;
  }

  sendAllAthletes();
}

void processDetectedEpc(uint32_t epc) {
  EpcEvent event = detectionController.evaluateEpc(epc, millis());
  if (event.type == EpcEventType::Ignored ||
      event.type == EpcEventType::StateNotAllowed) {
    return;  // 8秒重复和黑名单命中完全静默。
  }

  if (event.type == EpcEventType::TableFull) {
    sendStatus(DetectProtocol::CMD_EPC,
               DetectProtocol::STATUS_DEDUP_TABLE_FULL,
               "EPC处理失败：普通EPC去重表已满");
    return;
  }

  if (event.type == EpcEventType::Athlete) {
    sendAthlete(event.athlete, "运动员信息发送失败：LoRa发送失败");
    Serial.print("[运动员] ID=");
    Serial.print(event.athlete.id);
    Serial.print("，圈数=");
    Serial.print(event.athlete.lapCount);
    Serial.print("，单圈时长=");
    Serial.print(event.athlete.lapCentiseconds);
    Serial.print("百分秒");
    Serial.print("，总时长=");
    Serial.print(event.athlete.totalCentiseconds);
    Serial.println("百分秒");
    return;
  }

  if (!loraManager.sendDetectedEpc(epc)) {
    sendStatus(DetectProtocol::CMD_EPC,
               DetectProtocol::STATUS_LORA_SEND_FAILED,
               "普通EPC发送失败：LoRa发送失败");
    return;
  }
  Serial.print("[检测] EPC=");
  printEpc(epc);
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n[系统] DetectOnly固件启动");

  rfidReader.begin();
  loraManager.begin(handleDetectCommand);
  Serial.println("[系统] 初始化完成，当前状态：已停止");
}

void loop() {
  loraManager.handleReceive();

  if (detectionController.isRunning()) {
    rfidReader.poll();
    uint32_t epc;
    for (uint8_t i = 0; i < 4 && rfidReader.readEpc(epc); ++i) {
      processDetectedEpc(epc);
    }
    if (rfidReader.takeQueueOverflow()) {
      sendStatus(DetectProtocol::CMD_EPC,
                 DetectProtocol::STATUS_QUEUE_OVERFLOW,
                 "EPC处理失败：RFID接收队列溢出");
    }
    RfidError rfidError = rfidReader.takeError();
    if (rfidError == RfidError::InvalidFrame) {
      sendStatus(DetectProtocol::CMD_EPC,
                 DetectProtocol::STATUS_EPC_FORMAT_ERROR,
                 "EPC处理失败：RFID数据帧格式或校验和错误");
    } else if (rfidError == RfidError::IoFailure) {
      sendStatus(DetectProtocol::CMD_EPC,
                 DetectProtocol::STATUS_RFID_IO_ERROR,
                 "EPC处理失败：RFID串口写入不完整");
    }
  }

  yield();
}
