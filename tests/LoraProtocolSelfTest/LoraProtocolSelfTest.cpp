#include <assert.h>
#include <stdint.h>
#include "../../DetectProtocol.h"

int main() {
  static_assert(DetectProtocol::CMD_DEFINE_EPC == 0x10,
                "define command changed");
  static_assert(DetectProtocol::CMD_GET_ATHLETES == 0x11,
                "list command changed");
  static_assert(DetectProtocol::CMD_ATHLETE == 0x12,
                "athlete command changed");
  static_assert(DetectProtocol::CMD_ATHLETE_TRANSFER == 0x13,
                "transfer command changed");
  static_assert(DetectProtocol::CMD_EPC == 0x14,
                "EPC command changed");

  uint8_t integerBytes[] = {0x12, 0x34, 0x56, 0x78};
  assert(DetectProtocol::readUInt16BE(integerBytes) == 0x1234);
  assert(DetectProtocol::readUInt32BE(integerBytes) == 0x12345678UL);

  assert(DetectProtocol::expectedPayloadLength(DetectProtocol::CMD_START) == 0);
  assert(DetectProtocol::expectedPayloadLength(
           DetectProtocol::CMD_DEFINE_EPC) == 7);
  assert(DetectProtocol::expectedPayloadLength(
           DetectProtocol::CMD_GET_ATHLETES) == 0);

  DetectProtocol::DefineEpcData definition{};
  uint8_t definitionBytes[] = {0x01, 0x33, 0x33, 0xF3,
                               0x37, 0x00, 0x01};
  assert(DetectProtocol::decodeDefineEpc(definitionBytes,
                                         sizeof(definitionBytes), definition));
  assert(definition.isAthlete);
  assert(definition.epc == 0x3333F337UL);
  assert(definition.athleteId == 1);
  definitionBytes[0] = 0x02;
  assert(!DetectProtocol::decodeDefineEpc(definitionBytes,
                                          sizeof(definitionBytes), definition));

  uint8_t output[16] = {};
  uint8_t definePayload[] = {0x01, 0x33, 0x33, 0xF3, 0x37, 0x00, 0x01};
  assert(DetectProtocol::encodePacket(DetectProtocol::CMD_DEFINE_EPC,
                                      definePayload, sizeof(definePayload),
                                      output, sizeof(output)) == 12);
  assert(output[0] == 0xAA && output[1] == 0x10 && output[2] == 0x07);
  assert(output[10] == 0xA9 && output[11] == 0xF9);

  uint8_t athletePayload[9] = {};
  DetectProtocol::writeUInt16BE(athletePayload, 1);
  athletePayload[2] = 2;
  DetectProtocol::writeUInt24BE(athletePayload + 3, 800);
  DetectProtocol::writeUInt24BE(athletePayload + 6, 1600);
  uint8_t builtAthletePayload[9] = {};
  DetectProtocol::buildAthletePayload(1, 2, 800, 1600, builtAthletePayload);
  for (uint8_t i = 0; i < 9; ++i) {
    assert(builtAthletePayload[i] == athletePayload[i]);
  }
  assert(DetectProtocol::encodePacket(DetectProtocol::CMD_ATHLETE,
                                      athletePayload, sizeof(athletePayload),
                                      output, sizeof(output)) == 14);
  assert(output[1] == 0x12 && output[12] == 0x87 && output[13] == 0xF9);

  uint8_t epcPayload[4] = {};
  DetectProtocol::buildEpcPayload(0x3333F337UL, epcPayload);
  assert(DetectProtocol::encodePacket(DetectProtocol::CMD_EPC,
                                      epcPayload, sizeof(epcPayload),
                                      output, sizeof(output)) == 9);
  assert(output[1] == 0x14 && output[7] == 0xA8 && output[8] == 0xF9);

  assert(DetectProtocol::isAppCommand(0x01));
  assert(DetectProtocol::isAppCommand(0x02));
  assert(DetectProtocol::isAppCommand(0x03));
  assert(DetectProtocol::isAppCommand(0x10));
  assert(DetectProtocol::isAppCommand(0x11));
  assert(!DetectProtocol::isAppCommand(0x04));
  assert(!DetectProtocol::isAppCommand(0x12));
  assert(!DetectProtocol::isAppCommand(0x13));
  assert(!DetectProtocol::isAppCommand(0x14));
  assert(!DetectProtocol::isAppCommand(0xF0));
  return 0;
}
