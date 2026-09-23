#ifndef CONFIG_H
#define CONFIG_H

#include <stdint.h>

enum class ScoringMode : uint8_t {
  LegacyImmediate,
  RssiPeak
};

constexpr ScoringMode ACTIVE_SCORING_MODE = ScoringMode::RssiPeak;
// 同一运动员最后一次通知后达到该时长即结算当前峰值。
constexpr uint32_t RSSI_PEAK_IDLE_TIMEOUT_MS = 100UL;

// RFID serial wiring: RFID TX -> STM32 PC7, RFID RX -> STM32 PC6.
#define RFID_SERIAL_RX PC7
#define RFID_SERIAL_TX PC6
#define RFID_BAUDRATE 115200

// LoRa serial wiring: LoRa TXD -> STM32 PA3, LoRa RXD -> STM32 PA2, AUX -> PA1.
#define LORA_SERIAL_RX PA3
#define LORA_SERIAL_TX PA2
#define LORA_AUX_PIN PA1
#define LORA_BAUD_RATE 9600

// RFID commands.
#define CMD_SINGLE_INVENTORY {0xBB, 0x00, 0x22, 0x00, 0x00, 0x22, 0x7E}
#define CMD_STOP_INVENTORY {0xBB, 0x00, 0x28, 0x00, 0x00, 0x28, 0x7E}
#endif
