#include <assert.h>
#include <stdint.h>
#include "../../DetectProtocol.h"

int main() {
  static_assert(DetectProtocol::STATUS_RECEIVE_TIMEOUT == 0x0E,
                "receive timeout status changed");
  static_assert(DetectProtocol::STATUS_RFID_IO_ERROR == 0x0F,
                "RFID I/O status changed");
  uint8_t packet[16] = {};
  uint8_t epcPayload[7] = {0x33, 0x33, 0xF3, 0x37, 0x00, 0x00, 0x64};

  assert(DetectProtocol::checksum(0x13, 7, epcPayload) == 0x0E);
  assert(DetectProtocol::encodePacket(0x13, epcPayload, 7, packet, sizeof(packet)) == 12);
  assert(packet[0] == 0xAA);
  assert(packet[1] == 0x13);
  assert(packet[2] == 7);
  assert(packet[10] == 0x0E);
  assert(packet[11] == 0xF9);

  uint8_t timePayload[3] = {};
  DetectProtocol::writeUInt24BE(timePayload, 0x123456UL);
  assert(timePayload[0] == 0x12);
  assert(timePayload[1] == 0x34);
  assert(timePayload[2] == 0x56);

  assert(DetectProtocol::isAppCommand(0x01));
  assert(DetectProtocol::isAppCommand(0x02));
  assert(DetectProtocol::isAppCommand(0x03));
  assert(!DetectProtocol::isAppCommand(0x04));
  assert(!DetectProtocol::isAppCommand(0x13));
  assert(!DetectProtocol::isAppCommand(0xF0));
  assert(!DetectProtocol::isAppCommand(0x99));
  return 0;
}
