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
  if (status == DetectProtocol::STATUS_SUCCESS) {
    Serial.print("[控制] ");
  } else {
    Serial.print("[错误] ");
  }
  Serial.println(message);
  if (!loraManager.sendStatus(commandId, status)) {
    Serial.println("[错误] 返回执行状态失败：LoRa发送失败");
  }
}

void handleDetectCommand(uint8_t commandId) {
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

  if (!loraManager.sendRaceStatus(detectionController.isRunning())) {
    Serial.println("[错误] 返回比赛状态失败：LoRa发送失败");
  }
}

void processDetectedEpc(uint32_t epc) {
  uint32_t now = millis();
  DetectResult result = detectionController.evaluateEpc(epc, now);
  if (result == DetectResult::DuplicateIgnored) return;  // 8秒内重复完全静默。
  if (result == DetectResult::TableFull) {
    sendStatus(DetectProtocol::CMD_EPC, DetectProtocol::STATUS_DEDUP_TABLE_FULL,
               "EPC处理失败：去重表已满");
    return;
  }
  if (result != DetectResult::Accepted) return;

  uint32_t elapsed = detectionController.elapsedCentiseconds(now);
  if (!loraManager.sendDetectedEpc(epc, elapsed)) {
    sendStatus(DetectProtocol::CMD_EPC, DetectProtocol::STATUS_LORA_SEND_FAILED,
               "EPC发送失败：LoRa发送失败");
    return;
  }

  Serial.print("[检测] EPC=");
  printEpc(epc);
  Serial.print("，总时长=");
  Serial.print(elapsed);
  Serial.println("百分秒");
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
      sendStatus(DetectProtocol::CMD_EPC, DetectProtocol::STATUS_QUEUE_OVERFLOW,
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
