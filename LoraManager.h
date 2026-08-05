#ifndef LORA_MANAGER_H
#define LORA_MANAGER_H

#include <Arduino.h>
#include <HardwareSerial.h>
#include "config.h"
#include "AthleteManager.h"

struct LoraCommand {
  String type;
  String id;
  String name;
  String epc;
  byte sourceCommandId;
  bool fromByteProtocol;
};

typedef void (*LoraCommandHandler)(const LoraCommand& command);
typedef unsigned long (*LoraLapTimeProvider)(const Athlete* athlete);

class LoraManager {
private:
  HardwareSerial loraSerial;
  bool ready;
  String rxBuffer;
  LoraCommandHandler commandHandler;
  LoraLapTimeProvider lapTimeProvider;

  static const byte PACKET_HEADER = 0xAA;
  static const byte PACKET_TAIL = 0xF9;
  static const byte MAX_PAYLOAD_LENGTH = 230;

  static const byte CMD_RACE_CONTROL = 0x01;
  static const byte CMD_ATHLETE_RESULT = 0x02;
  static const byte CMD_GET_ALL_RESULTS = 0x03;
  static const byte CMD_RESULTS_TRANSFER_STATE = 0x04;
  static const byte CMD_GET_LEADER_RESULT = 0x05;
  static const byte CMD_LEADER_RESULT = 0x06;
  static const byte CMD_GET_RACE_STATUS = 0x07;
  static const byte CMD_RACE_STATUS = 0x08;
  static const byte CMD_ADD_ATHLETE = 0x11;
  static const byte CMD_SCAN_ADD_ATHLETE = 0x12;
  static const byte CMD_EDIT_ATHLETE = 0x13;
  static const byte CMD_SCAN_EDIT_ATHLETE = 0x14;
  static const byte CMD_REMOVE_ATHLETE = 0x15;
  static const byte CMD_QUERY_ATHLETE = 0x16;
  static const byte CMD_ATHLETE_INFO = 0x17;
  static const byte CMD_GET_ATHLETE_LIST = 0x18;
  static const byte CMD_ATHLETE_LIST_STATE = 0x19;
  static const byte CMD_COMMAND_REPLY = 0xF1;

  static const byte STATUS_SUCCESS = 0x00;
  static const byte STATUS_FORMAT_ERROR = 0x01;
  static const byte STATUS_DUPLICATE_EPC = 0x02;
  static const byte STATUS_NOT_FOUND = 0x03;
  static const byte STATUS_SCAN_TIMEOUT = 0x04;
  static const byte STATUS_STORAGE_ERROR = 0x05;
  static const byte STATUS_STATE_NOT_ALLOWED = 0x06;

  enum ByteRxState {
    WAIT_HEADER,
    READ_COMMAND,
    READ_LENGTH,
    READ_PAYLOAD,
    READ_CHECKSUM,
    READ_TAIL
  };

  ByteRxState byteRxState;
  byte byteCommandId;
  byte bytePayloadLength;
  byte bytePayload[MAX_PAYLOAD_LENGTH];
  byte bytePayloadIndex;
  byte byteChecksum;

  int splitFields(const String& packet, String fields[], int maxFields) {
    if (maxFields <= 0) return 0;

    int fieldCount = 0;
    int startIndex = 0;

    while (startIndex <= packet.length() && fieldCount < maxFields) {
      int delimiterIndex = packet.indexOf(';', startIndex);
      if (delimiterIndex != -1 && fieldCount == maxFields - 1) {
        return -1;
      }

      if (delimiterIndex == -1) {
        fields[fieldCount] = packet.substring(startIndex);
        fields[fieldCount].trim();
        fieldCount++;
        break;
      }

      fields[fieldCount] = packet.substring(startIndex, delimiterIndex);
      fields[fieldCount].trim();
      fieldCount++;
      startIndex = delimiterIndex + 1;
    }

    if (packet.indexOf(';', startIndex) != -1) {
      return -1;
    }

    return fieldCount;
  }

  bool validateCommandFields(const String fields[], int fieldCount) {
    if (fieldCount <= 0) return false;
    if (!fields[0].startsWith("COMMAND_")) return false;

    for (int i = 0; i < fieldCount; i++) {
      if (fields[i].length() == 0) return false;
      if (fields[i].indexOf('=') != -1) return false;
    }

    return true;
  }

  unsigned long getLapTime(const Athlete* athlete) {
    if (lapTimeProvider == nullptr) return 0;
    return lapTimeProvider(athlete);
  }

  byte calculateChecksum(byte commandId, byte payloadLength, const byte* payload) {
    unsigned int sum = commandId + payloadLength;
    for (byte i = 0; i < payloadLength; i++) {
      sum += payload[i];
    }
    return (byte)(sum & 0xFF);
  }

  void resetByteReceiver() {
    byteRxState = WAIT_HEADER;
    byteCommandId = 0;
    bytePayloadLength = 0;
    bytePayloadIndex = 0;
    byteChecksum = 0;
  }

  void writeUInt16BE(byte* payload, byte& index, unsigned int value) {
    payload[index++] = (byte)((value >> 8) & 0xFF);
    payload[index++] = (byte)(value & 0xFF);
  }

  void writeUInt24BE(byte* payload, byte& index, unsigned long value) {
    payload[index++] = (byte)((value >> 16) & 0xFF);
    payload[index++] = (byte)((value >> 8) & 0xFF);
    payload[index++] = (byte)(value & 0xFF);
  }

  unsigned int readUInt16BE(const byte* payload, byte index) {
    return ((unsigned int)payload[index] << 8) | payload[index + 1];
  }

  String formatByteHex(byte value) {
    String result = "";
    if (value < 0x10) result += "0";
    result += String(value, HEX);
    result.toUpperCase();
    return result;
  }

  String readEpcHex(const byte* payload, byte index) {
    String epc = "";
    for (byte i = 0; i < 4; i++) {
      epc += formatByteHex(payload[index + i]);
    }
    return epc;
  }

  bool writeEpcBytes(byte* payload, byte& index, const String& epc) {
    String normalized = epc;
    normalized.trim();
    normalized.toUpperCase();
    if (normalized.length() != 8) {
      return false;
    }

    for (byte i = 0; i < 4; i++) {
      char high = normalized[i * 2];
      char low = normalized[i * 2 + 1];
      if (!isHexadecimalDigit(high) || !isHexadecimalDigit(low)) {
        return false;
      }
      payload[index++] = (byte)strtoul(normalized.substring(i * 2, i * 2 + 2).c_str(), nullptr, 16);
    }
    return true;
  }

  unsigned int parseAthleteId(const String& id) {
    String normalized = id;
    normalized.trim();
    return (unsigned int)normalized.toInt();
  }

  String formatAthleteId(unsigned int value) {
    if (value < 10) return "00" + String(value);
    if (value < 100) return "0" + String(value);
    return String(value);
  }

  unsigned long toCentiseconds(unsigned long milliseconds) {
    return (milliseconds + 5) / 10;
  }

  bool appendNameBytes(byte* payload, byte& index, const String& name, byte maxPayloadLength) {
    int nameLength = name.length();
    if (nameLength < 0 || nameLength > 255) {
      return false;
    }
    if ((int)index + 1 + nameLength > maxPayloadLength) {
      return false;
    }

    payload[index++] = (byte)nameLength;
    for (int i = 0; i < nameLength; i++) {
      payload[index++] = (byte)name[i];
    }
    return true;
  }

  String readNameBytes(const byte* payload, byte startIndex, byte payloadLength, bool& ok) {
    ok = false;
    if (startIndex >= payloadLength) return "";

    byte nameLength = payload[startIndex];
    if ((unsigned int)startIndex + 1 + nameLength > payloadLength) {
      return "";
    }

    String name = "";
    for (byte i = 0; i < nameLength; i++) {
      name += (char)payload[startIndex + 1 + i];
    }
    ok = true;
    return name;
  }

  byte statusFromReason(bool success, const String& reason) {
    if (success) return STATUS_SUCCESS;
    if (reason == "NOT_FOUND") return STATUS_NOT_FOUND;
    if (reason == "DUPLICATE_OR_FULL") return STATUS_DUPLICATE_EPC;
    if (reason == "FORMAT_ERROR") return STATUS_FORMAT_ERROR;
    if (reason == "STORAGE_ERROR") return STATUS_STORAGE_ERROR;
    if (reason == "STATE_NOT_ALLOWED") return STATUS_STATE_NOT_ALLOWED;
    return STATUS_FORMAT_ERROR;
  }

  String commandNameFromId(byte commandId) {
    switch (commandId) {
      case CMD_RACE_CONTROL: return "RACE_CONTROL";
      case CMD_ADD_ATHLETE: return "ADD";
      case CMD_SCAN_ADD_ATHLETE: return "SCAN_ADD";
      case CMD_EDIT_ATHLETE: return "BIND";
      case CMD_SCAN_EDIT_ATHLETE: return "SCAN_EDIT";
      case CMD_REMOVE_ATHLETE: return "REMOVE";
      case CMD_QUERY_ATHLETE: return "QUERY";
      case CMD_GET_RACE_STATUS: return "RACE_STATUS";
      case CMD_GET_ATHLETE_LIST: return "LIST";
      default: return "UNKNOWN";
    }
  }

  bool sendPacket(byte commandId, const byte* payload, byte payloadLength) {
    if (!ready) {
      Serial.println("[LoRa] 未初始化，跳过字节发送");
      return false;
    }
    if (payloadLength > MAX_PAYLOAD_LENGTH) {
      Serial.println("[LoRa] 字节包 Payload 过长，跳过发送");
      return false;
    }

    byte checksum = calculateChecksum(commandId, payloadLength, payload);
    loraSerial.write(PACKET_HEADER);
    loraSerial.write(commandId);
    loraSerial.write(payloadLength);
    for (byte i = 0; i < payloadLength; i++) {
      loraSerial.write(payload[i]);
    }
    loraSerial.write(checksum);
    loraSerial.write(PACKET_TAIL);

    Serial.print("[LoRa] 已发送字节包 CMD=0x");
    Serial.print(formatByteHex(commandId));
    Serial.print(", LEN=");
    Serial.println(payloadLength);
    return true;
  }

  void processBytePacket(byte commandId, const byte* payload, byte payloadLength) {
    LoraCommand command;
    command.sourceCommandId = commandId;
    command.fromByteProtocol = true;

    switch (commandId) {
      case CMD_RACE_CONTROL:
        if (payloadLength != 1) {
          sendCommandReplyByte(commandId, STATUS_FORMAT_ERROR);
          return;
        }
        if (payload[0] == 0x01) {
          command.type = "COMMAND_START";
        } else if (payload[0] == 0x00) {
          command.type = "COMMAND_STOP";
        } else if (payload[0] == 0x02) {
          command.type = "COMMAND_RESET";
        } else {
          sendCommandReplyByte(commandId, STATUS_FORMAT_ERROR);
          return;
        }
        break;

      case CMD_GET_ALL_RESULTS:
        if (payloadLength != 0) {
          sendCommandReplyByte(commandId, STATUS_FORMAT_ERROR);
          return;
        }
        command.type = "COMMAND_RESULTS";
        break;

      case CMD_GET_LEADER_RESULT:
        if (payloadLength != 0) {
          sendCommandReplyByte(commandId, STATUS_FORMAT_ERROR);
          return;
        }
        command.type = "COMMAND_LEADER";
        break;

      case CMD_GET_RACE_STATUS:
        if (payloadLength != 0) {
          sendCommandReplyByte(commandId, STATUS_FORMAT_ERROR);
          return;
        }
        command.type = "COMMAND_RACE_STATUS";
        break;

      case CMD_ADD_ATHLETE: {
        if (payloadLength < 5) {
          sendCommandReplyByte(commandId, STATUS_FORMAT_ERROR);
          return;
        }
        command.type = "COMMAND_ADD";
        command.epc = readEpcHex(payload, 0);
        bool ok = false;
        command.name = readNameBytes(payload, 4, payloadLength, ok);
        if (!ok) {
          sendCommandReplyByte(commandId, STATUS_FORMAT_ERROR);
          return;
        }
        break;
      }

      case CMD_EDIT_ATHLETE: {
        if (payloadLength < 7) {
          sendCommandReplyByte(commandId, STATUS_FORMAT_ERROR);
          return;
        }
        command.type = "COMMAND_BIND";
        command.id = formatAthleteId(readUInt16BE(payload, 0));
        command.epc = readEpcHex(payload, 2);
        bool ok = false;
        command.name = readNameBytes(payload, 6, payloadLength, ok);
        if (!ok) {
          sendCommandReplyByte(commandId, STATUS_FORMAT_ERROR);
          return;
        }
        break;
      }

      case CMD_REMOVE_ATHLETE:
        if (payloadLength != 2) {
          sendCommandReplyByte(commandId, STATUS_FORMAT_ERROR);
          return;
        }
        command.type = "COMMAND_REMOVE";
        command.id = formatAthleteId(readUInt16BE(payload, 0));
        break;

      case CMD_QUERY_ATHLETE:
        if (payloadLength != 2) {
          sendCommandReplyByte(commandId, STATUS_FORMAT_ERROR);
          return;
        }
        command.type = "COMMAND_QUERY";
        command.id = formatAthleteId(readUInt16BE(payload, 0));
        break;

      case CMD_GET_ATHLETE_LIST:
        if (payloadLength != 0) {
          sendCommandReplyByte(commandId, STATUS_FORMAT_ERROR);
          return;
        }
        command.type = "COMMAND_LIST";
        break;

      case CMD_SCAN_ADD_ATHLETE:
      case CMD_SCAN_EDIT_ATHLETE:
        sendCommandReplyByte(commandId, STATUS_STATE_NOT_ALLOWED);
        return;

      default:
        Serial.print("[LoRa RX] 未支持的字节命令: 0x");
        Serial.println(formatByteHex(commandId));
        sendCommandReplyByte(commandId, STATUS_FORMAT_ERROR);
        return;
    }

    if (commandHandler != nullptr) {
      commandHandler(command);
    }
  }

  void appendByteToReceiver(byte value) {
    switch (byteRxState) {
      case WAIT_HEADER:
        if (value == PACKET_HEADER) {
          byteRxState = READ_COMMAND;
        }
        break;

      case READ_COMMAND:
        byteCommandId = value;
        byteRxState = READ_LENGTH;
        break;

      case READ_LENGTH:
        bytePayloadLength = value;
        bytePayloadIndex = 0;
        if (bytePayloadLength > MAX_PAYLOAD_LENGTH) {
          Serial.println("[LoRa RX] 字节包长度超限，丢弃");
          resetByteReceiver();
        } else if (bytePayloadLength == 0) {
          byteRxState = READ_CHECKSUM;
        } else {
          byteRxState = READ_PAYLOAD;
        }
        break;

      case READ_PAYLOAD:
        bytePayload[bytePayloadIndex++] = value;
        if (bytePayloadIndex >= bytePayloadLength) {
          byteRxState = READ_CHECKSUM;
        }
        break;

      case READ_CHECKSUM:
        byteChecksum = value;
        byteRxState = READ_TAIL;
        break;

      case READ_TAIL:
        if (value != PACKET_TAIL) {
          Serial.println("[LoRa RX] 字节包包尾错误，丢弃");
          resetByteReceiver();
          break;
        }
        if (calculateChecksum(byteCommandId, bytePayloadLength, bytePayload) != byteChecksum) {
          Serial.println("[LoRa RX] 字节包 checksum 错误，丢弃");
          resetByteReceiver();
          break;
        }
        processBytePacket(byteCommandId, bytePayload, bytePayloadLength);
        resetByteReceiver();
        break;
    }
  }

public:
  LoraManager()
    : loraSerial(LORA_SERIAL_RX, LORA_SERIAL_TX),
      ready(false),
      rxBuffer(""),
      commandHandler(nullptr),
      lapTimeProvider(nullptr),
      byteRxState(WAIT_HEADER),
      byteCommandId(0),
      bytePayloadLength(0),
      bytePayloadIndex(0),
      byteChecksum(0) {}

  void begin(LoraCommandHandler handler, LoraLapTimeProvider provider) {
    commandHandler = handler;
    lapTimeProvider = provider;
    loraSerial.begin(LORA_BAUD_RATE);
    pinMode(LORA_AUX_PIN, INPUT_PULLUP);
    ready = true;
    Serial.println("[LoRa] 初始化完成: RX=PA3, TX=PA2, AUX=PA1, baud=9600");
  }

  void send(const String& message) {
    if (!ready) {
      Serial.println("[LoRa] 未初始化，跳过发送");
      return;
    }

    // if (digitalRead(LORA_AUX_PIN) == LOW) {
    //   Serial.println("[LoRa] 模块忙，跳过本次发送");
    //   return;
    // }

    loraSerial.println(message);
    Serial.print("[LoRa] 已发送: ");
    Serial.println(message);
  }

  void handleReceive() {
    if (!ready) return;

    unsigned int bytesReadThisCall = 0;
    const unsigned int maxBytesPerCall = 64;
    while (loraSerial.available() > 0 && bytesReadThisCall < maxBytesPerCall) {
      byte raw = (byte)loraSerial.read();
      char c = static_cast<char>(raw);
      bytesReadThisCall++;

      if (byteRxState != WAIT_HEADER || raw == PACKET_HEADER) {
        if (byteRxState == WAIT_HEADER && raw == PACKET_HEADER) {
          rxBuffer = "";
        }
        appendByteToReceiver(raw);
        continue;
      }

      if (c == '\r') {
        continue;
      }

      if (c == '\n') {
        rxBuffer.trim();
        if (rxBuffer.length() > 0) {
          processCommand(rxBuffer);
        }
        rxBuffer = "";
        continue;
      }

      rxBuffer += c;
      if (rxBuffer.length() > 160) {
        Serial.println("[LoRa RX] 数据包过长，已丢弃");
        rxBuffer = "";
      }
    }
  }

  void processCommand(const String& packet) {
    String fields[5];
    int fieldCount = splitFields(packet, fields, 5);

    if (fieldCount <= 0) {
      Serial.print("[LoRa RX] 协议错误: ");
      Serial.println(packet);
      return;
    }

    if (!fields[0].startsWith("COMMAND_")) {
      return;
    }

    if (!validateCommandFields(fields, fieldCount)) {
      Serial.print("[LoRa RX] 命令协议错误: ");
      Serial.println(packet);
      return;
    }

    LoraCommand command;
    command.sourceCommandId = 0;
    command.fromByteProtocol = false;
    command.type = fields[0];

    if (command.type == "COMMAND_START" ||
        command.type == "COMMAND_SCAN" ||
        command.type == "COMMAND_STOP" ||
        command.type == "COMMAND_RESET" ||
        command.type == "COMMAND_RACE_STATUS" ||
        command.type == "COMMAND_LIST") {
      if (fieldCount != 1) {
        Serial.print("[LoRa RX] 字段数量错误: ");
        Serial.println(command.type);
        return;
      }

    } else if (command.type == "COMMAND_ADD") {
      if (fieldCount != 3) {
        Serial.print("[LoRa RX] 字段数量错误: ");
        Serial.println(command.type);
        return;
      }
      command.name = fields[1];
      command.epc = fields[2];

    } else if (command.type == "COMMAND_BIND") {
      if (fieldCount != 4) {
        Serial.print("[LoRa RX] 字段数量错误: ");
        Serial.println(command.type);
        return;
      }
      command.id = fields[1];
      command.name = fields[2];
      command.epc = fields[3];

    } else if (command.type == "COMMAND_REMOVE") {
      if (fieldCount != 2) {
        Serial.print("[LoRa RX] 字段数量错误: ");
        Serial.println(command.type);
        return;
      }
      command.id = fields[1];

    } else {
      Serial.print("[LoRa RX] 未支持的命令类型: ");
      Serial.println(command.type);
      return;
    }

    if (commandHandler != nullptr) {
      commandHandler(command);
    }
  }

  String buildAthleteMessage(const Athlete* athlete) {
    // String message = "TYPE=ATHLETE_DATA";
    // message += ";ID=" + athlete->id;
    // message += ";NAME=" + athlete->name;
    // message += ";EPC=" + athlete->epc;
    // message += ";LAP=" + String(athlete->lapCount);
    // message += ";TOTAL_TIME=" + String(athlete->totalTime);
    // message += ";LAST_LAP=" + String(getLapTime(athlete));
    String message = "11111111111111";
    return message;
  }

  String buildLeaderMessage(const Athlete* leader) {
    String message = "TYPE=LEADER";
    message += ";ID=" + leader->id;
    message += ";NAME=" + leader->name;
    message += ";EPC=" + leader->epc;
    message += ";LAP=" + String(leader->lapCount);
    message += ";TOTAL_TIME=" + String(leader->totalTime);
    message += ";LAST_LAP=" + String(getLapTime(leader));
    return message;
  }

  String buildScannedEpcMessage(const String& epc, const Athlete* athlete) {
    // String message = "TYPE=SCANNED_EPC";
    // message += ";EPC=" + epc;
    // message += ";BOUND=" + String(athlete != nullptr ? "1" : "0");

    // if (athlete != nullptr) {
    //   message += ";ID=" + athlete->id;
    //   message += ";NAME=" + athlete->name;
    // }
    String message = "1111111111111";

    return message;
  }

  String buildCountMessage(int count) {
    String message = "TYPE=DETECT_COUNTER";
    message += ";COUNT=" + String(count);
    return message;
  }

  String buildCommandReplyMessage(const String& command, bool success, const String& reason = "", const String& id = "") {
    String message = "TYPE=COMMAND_REPLY";
    message += ";COMMAND=" + command;
    message += ";RESULT=" + String(success ? "OK" : "FAIL");
    if (id.length() > 0) {
      message += ";ID=" + id;
    }
    if (reason.length() > 0) {
      message += ";REASON=" + reason;
    }
    return message;
  }

  String buildAthleteListBeginMessage(int count) {
    String message = "TYPE=ATHLETE_LIST_BEGIN";
    message += ";COUNT=" + String(count);
    return message;
  }

  String buildAthleteListItemMessage(int index, const Athlete* athlete) {
    String message = "TYPE=ATHLETE_LIST_ITEM";
    message += ";INDEX=" + String(index);
    message += ";ID=" + athlete->id;
    message += ";NAME=" + athlete->name;
    message += ";EPC=" + athlete->epc;
    return message;
  }

  String buildAthleteListEndMessage(int count) {
    String message = "TYPE=ATHLETE_LIST_END";
    message += ";COUNT=" + String(count);
    return message;
  }

  void sendAthleteData(const Athlete* athlete) {
    if (athlete == nullptr) return;
    byte payload[16];
    byte index = 0;
    writeUInt16BE(payload, index, parseAthleteId(athlete->id));
    payload[index++] = (byte)athlete->lapCount;
    writeUInt24BE(payload, index, toCentiseconds(getLapTime(athlete)));
    writeUInt24BE(payload, index, toCentiseconds(athlete->totalTime));
    int rank = athlete->rank;
    if (rank < 0) rank = 0;
    if (rank > 255) rank = 255;
    payload[index++] = (byte)rank;
    sendPacket(CMD_ATHLETE_RESULT, payload, index);
  }

  void sendLeaderData(const Athlete* leader) {
    if (leader == nullptr) return;
    byte payload[8];
    byte index = 0;
    writeUInt16BE(payload, index, parseAthleteId(leader->id));
    payload[index++] = (byte)leader->lapCount;
    writeUInt24BE(payload, index, toCentiseconds(leader->totalTime));
    sendPacket(CMD_LEADER_RESULT, payload, index);
  }

  void sendScannedEpc(const String& epc, const Athlete* athlete) {
    send(buildScannedEpcMessage(epc, athlete));
  }

  void sendCount(int count) {
    send(buildCountMessage(count));
  }

  void sendCommandReply(const String& command, bool success, const String& reason = "", const String& id = "") {
    byte commandId = 0x00;
    if (command == "START" || command == "STOP" || command == "RESET") commandId = CMD_RACE_CONTROL;
    else if (command == "ADD") commandId = CMD_ADD_ATHLETE;
    else if (command == "BIND") commandId = CMD_EDIT_ATHLETE;
    else if (command == "REMOVE") commandId = CMD_REMOVE_ATHLETE;
    else if (command == "LIST") commandId = CMD_GET_ATHLETE_LIST;
    else if (command == "QUERY") commandId = CMD_QUERY_ATHLETE;
    else if (command == "RACE_STATUS") commandId = CMD_GET_RACE_STATUS;
    sendCommandReplyByte(commandId, statusFromReason(success, reason));
  }

  void sendRaceStatus(byte status) {
    byte payload[1] = {status};
    sendPacket(CMD_RACE_STATUS, payload, 1);
  }

  void sendAthleteListBegin(int count) {
    byte payload[1] = {0x01};
    sendPacket(CMD_ATHLETE_LIST_STATE, payload, 1);
  }

  void sendAthleteListItem(int index, const Athlete* athlete) {
    if (athlete == nullptr) return;
    sendAthleteInfo(athlete);
  }

  void sendAthleteListEnd(int count) {
    byte payload[1] = {0x00};
    sendPacket(CMD_ATHLETE_LIST_STATE, payload, 1);
  }

  void sendResultsBegin() {
    byte payload[1] = {0x01};
    sendPacket(CMD_RESULTS_TRANSFER_STATE, payload, 1);
  }

  void sendResultsEnd() {
    byte payload[1] = {0x00};
    sendPacket(CMD_RESULTS_TRANSFER_STATE, payload, 1);
  }

  void sendCommandReplyByte(byte originalCommandId, byte statusCode) {
    byte payload[2] = {originalCommandId, statusCode};
    sendPacket(CMD_COMMAND_REPLY, payload, 2);
  }

  void sendAthleteInfo(const Athlete* athlete) {
    if (athlete == nullptr) return;
    byte payload[MAX_PAYLOAD_LENGTH];
    byte index = 0;
    writeUInt16BE(payload, index, parseAthleteId(athlete->id));
    if (!writeEpcBytes(payload, index, athlete->epc)) {
      Serial.println("[LoRa] 运动员 EPC 格式错误，无法发送字节信息");
      return;
    }
    if (!appendNameBytes(payload, index, athlete->name, MAX_PAYLOAD_LENGTH)) {
      Serial.println("[LoRa] 运动员姓名过长，无法发送字节信息");
      return;
    }
    sendPacket(CMD_ATHLETE_INFO, payload, index);
  }

  void feedReceivedByte(byte value) {
    appendByteToReceiver(value);
  }

  void feedReceivedBytes(const byte* data, byte length) {
    for (byte i = 0; i < length; i++) {
      appendByteToReceiver(data[i]);
    }
  }
};

#endif
