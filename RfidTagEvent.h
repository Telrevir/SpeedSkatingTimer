#ifndef RFID_TAG_EVENT_H
#define RFID_TAG_EVENT_H

#include <stdint.h>

struct RfidTagEvent {
  uint32_t epc;
  int8_t rssiDbm;
  uint32_t detectedMs;
};

#endif
