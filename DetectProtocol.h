#ifndef DETECT_PROTOCOL_H
#define DETECT_PROTOCOL_H

#include <stddef.h>
#include <stdint.h>

namespace DetectProtocol {

static constexpr uint8_t PACKET_HEADER = 0xAA;
static constexpr uint8_t PACKET_TAIL = 0xF9;
static constexpr uint8_t MAX_PAYLOAD_LENGTH = 230;

static constexpr uint8_t CMD_START = 0x01;
static constexpr uint8_t CMD_STOP = 0x02;
static constexpr uint8_t CMD_GET_STATE = 0x03;
static constexpr uint8_t CMD_STATE = 0x04;
static constexpr uint8_t CMD_DEFINE_EPC = 0x10;
static constexpr uint8_t CMD_GET_ATHLETES = 0x11;
static constexpr uint8_t CMD_ATHLETE = 0x12;
static constexpr uint8_t CMD_ATHLETE_TRANSFER = 0x13;
static constexpr uint8_t CMD_EPC = 0x14;
static constexpr uint8_t CMD_STATUS = 0xF0;

static constexpr uint8_t STATUS_SUCCESS = 0x00;
static constexpr uint8_t STATUS_LENGTH_ERROR = 0x01;
static constexpr uint8_t STATUS_UNKNOWN_COMMAND = 0x02;
static constexpr uint8_t STATUS_RFID_NOT_READY = 0x03;
static constexpr uint8_t STATUS_RFID_START_FAILED = 0x04;
static constexpr uint8_t STATUS_RFID_STOP_FAILED = 0x05;
static constexpr uint8_t STATUS_EPC_FORMAT_ERROR = 0x06;
static constexpr uint8_t STATUS_QUEUE_OVERFLOW = 0x07;
static constexpr uint8_t STATUS_DEDUP_TABLE_FULL = 0x08;
static constexpr uint8_t STATUS_LORA_SEND_FAILED = 0x09;
static constexpr uint8_t STATUS_STATE_NOT_ALLOWED = 0x0A;
static constexpr uint8_t STATUS_CHECKSUM_ERROR = 0x0B;
static constexpr uint8_t STATUS_TAIL_ERROR = 0x0C;
static constexpr uint8_t STATUS_PAYLOAD_TOO_LONG = 0x0D;
static constexpr uint8_t STATUS_RECEIVE_TIMEOUT = 0x0E;
static constexpr uint8_t STATUS_RFID_IO_ERROR = 0x0F;

struct DefineEpcData {
  bool isAthlete;
  uint32_t epc;
  uint16_t athleteId;
};

inline uint8_t checksum(uint8_t commandId, uint8_t payloadLength,
                        const uint8_t* payload) {
  uint16_t sum = commandId + payloadLength;
  for (uint8_t i = 0; i < payloadLength; ++i) sum += payload[i];
  return static_cast<uint8_t>(sum & 0xFF);
}

inline size_t encodePacket(uint8_t commandId, const uint8_t* payload,
                           uint8_t payloadLength, uint8_t* output,
                           size_t outputCapacity) {
  const size_t packetLength = static_cast<size_t>(payloadLength) + 5;
  if (payloadLength > MAX_PAYLOAD_LENGTH || outputCapacity < packetLength) return 0;

  output[0] = PACKET_HEADER;
  output[1] = commandId;
  output[2] = payloadLength;
  for (uint8_t i = 0; i < payloadLength; ++i) output[3 + i] = payload[i];
  output[3 + payloadLength] = checksum(commandId, payloadLength, payload);
  output[4 + payloadLength] = PACKET_TAIL;
  return packetLength;
}

inline void writeUInt24BE(uint8_t* output, uint32_t value) {
  output[0] = static_cast<uint8_t>((value >> 16) & 0xFF);
  output[1] = static_cast<uint8_t>((value >> 8) & 0xFF);
  output[2] = static_cast<uint8_t>(value & 0xFF);
}

inline uint16_t readUInt16BE(const uint8_t* input) {
  return (static_cast<uint16_t>(input[0]) << 8) | input[1];
}

inline uint32_t readUInt32BE(const uint8_t* input) {
  return (static_cast<uint32_t>(input[0]) << 24) |
         (static_cast<uint32_t>(input[1]) << 16) |
         (static_cast<uint32_t>(input[2]) << 8) |
         input[3];
}

inline void writeUInt16BE(uint8_t* output, uint16_t value) {
  output[0] = static_cast<uint8_t>((value >> 8) & 0xFF);
  output[1] = static_cast<uint8_t>(value & 0xFF);
}

inline void writeUInt32BE(uint8_t* output, uint32_t value) {
  output[0] = static_cast<uint8_t>((value >> 24) & 0xFF);
  output[1] = static_cast<uint8_t>((value >> 16) & 0xFF);
  output[2] = static_cast<uint8_t>((value >> 8) & 0xFF);
  output[3] = static_cast<uint8_t>(value & 0xFF);
}

inline uint8_t expectedPayloadLength(uint8_t commandId) {
  return commandId == CMD_DEFINE_EPC ? 7 : 0;
}

inline bool decodeDefineEpc(const uint8_t* payload, uint8_t payloadLength,
                            DefineEpcData& result) {
  if (payloadLength != 7 || payload[0] > 0x01) return false;
  result.isAthlete = payload[0] == 0x01;
  result.epc = readUInt32BE(payload + 1);
  result.athleteId = readUInt16BE(payload + 5);
  return true;
}

inline void buildAthletePayload(uint16_t id, uint8_t lapCount,
                                uint32_t lapCentiseconds,
                                uint32_t totalCentiseconds,
                                uint8_t* output) {
  writeUInt16BE(output, id);
  output[2] = lapCount;
  writeUInt24BE(output + 3, lapCentiseconds);
  writeUInt24BE(output + 6, totalCentiseconds);
}

inline void buildEpcPayload(uint32_t epc, uint8_t* output) {
  writeUInt32BE(output, epc);
}

inline bool isAppCommand(uint8_t commandId) {
  return commandId == CMD_START || commandId == CMD_STOP ||
         commandId == CMD_GET_STATE || commandId == CMD_DEFINE_EPC ||
         commandId == CMD_GET_ATHLETES;
}

}  // namespace DetectProtocol

#endif
