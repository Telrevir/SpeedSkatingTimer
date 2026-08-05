#ifndef CONFIG_H
#define CONFIG_H

// RFID serial wiring: RFID TX -> STM32 PC7, RFID RX -> STM32 PC6.
#define RFID_SERIAL_RX PC7
#define RFID_SERIAL_TX PC6
#define RFID_BAUDRATE 115200

// LoRa serial wiring: LoRa TXD -> STM32 PA3, LoRa RXD -> STM32 PA2, AUX -> PA1.
#define LORA_SERIAL_RX PA3
#define LORA_SERIAL_TX PA2
#define LORA_AUX_PIN PA1
#define LORA_BAUD_RATE 9600

// System parameters.
#define MAX_ATHLETES 50
#define MAX_LAPS 100

// Anti-duplicate detection interval in milliseconds.
#define MIN_LAP_INTERVAL 8000

// RFID commands.
#define CMD_SINGLE_INVENTORY {0xBB, 0x00, 0x22, 0x00, 0x00, 0x22, 0x7E}
#define CMD_STOP_INVENTORY {0xBB, 0x00, 0x28, 0x00, 0x00, 0x28, 0x7E}
#define CMD_MULTIPLE_INVENTORY {0xBB,0x00,0x27,0x00,0x03,0x22,0xFF,0xFF,0x4A,0x7E}

// RFID polling configuration.
#define RFID_POLL_INTERVAL 50
#define RFID_RESPONSE_TIMEOUT 200
#define RFID_MAX_RETRY 3
#define RFID_DEBUG_ENABLED true

#endif
