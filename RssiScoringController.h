#ifndef RSSI_SCORING_CONTROLLER_H
#define RSSI_SCORING_CONTROLLER_H

#include <stddef.h>
#include <stdint.h>

#include "RfidTagEvent.h"

struct RssiScoreSelection {
  uint32_t epc;
  uint32_t detectedMs;
  int8_t rssiDbm;
};

enum class RssiAcceptResult : uint8_t {
  Stored,
  ExpiredSelection,
  TableFull
};

class RssiScoringController {
private:
  static constexpr size_t WINDOW_CAPACITY = 50;
  static constexpr uint8_t DESCENDING_THRESHOLD = 3;

  struct WindowEntry {
    bool enabled;
    uint32_t epc;
    uint32_t lastDetectedMs;
    int8_t lastRssiDbm;
    int8_t peakRssiDbm;
    uint32_t peakDetectedMs;
    uint8_t consecutiveDescending;
  };

  uint32_t idleTimeoutMs_;
  WindowEntry entries_[WINDOW_CAPACITY];

  bool expired(uint32_t nowMs, uint32_t lastDetectedMs) const {
    return nowMs - lastDetectedMs >= idleTimeoutMs_;
  }

  RssiScoreSelection selectionFor(const WindowEntry& entry) const {
    return {entry.epc, entry.peakDetectedMs, entry.peakRssiDbm};
  }

  void startWindow(WindowEntry& entry, const RfidTagEvent& event) {
    entry = {
      true, event.epc, event.detectedMs, event.rssiDbm,
      event.rssiDbm, event.detectedMs, 0
    };
  }

public:
  explicit RssiScoringController(uint32_t idleTimeoutMs)
    : idleTimeoutMs_(idleTimeoutMs) {
    clear();
  }

  RssiAcceptResult accept(const RfidTagEvent& event,
                          RssiScoreSelection& expiredSelection) {
    WindowEntry* emptyEntry = nullptr;

    for (size_t i = 0; i < WINDOW_CAPACITY; ++i) {
      WindowEntry& entry = entries_[i];
      if (!entry.enabled) {
        if (emptyEntry == nullptr) emptyEntry = &entry;
        continue;
      }

      if (entry.epc != event.epc) continue;

      if (expired(event.detectedMs, entry.lastDetectedMs)) {
        expiredSelection = selectionFor(entry);
        startWindow(entry, event);
        return RssiAcceptResult::ExpiredSelection;
      }

      if (event.rssiDbm < entry.lastRssiDbm) {
        ++entry.consecutiveDescending;
      } else {
        entry.consecutiveDescending = 0;
      }
      entry.lastRssiDbm = event.rssiDbm;
      entry.lastDetectedMs = event.detectedMs;

      // 相同峰值取后一次样本，保证峰顶平台取离开前的最后时刻。
      if (event.rssiDbm >= entry.peakRssiDbm) {
        entry.peakRssiDbm = event.rssiDbm;
        entry.peakDetectedMs = event.detectedMs;
      }
      if (entry.consecutiveDescending >= DESCENDING_THRESHOLD) {
        expiredSelection = selectionFor(entry);
        entry = {};
        return RssiAcceptResult::ExpiredSelection;
      }
      return RssiAcceptResult::Stored;
    }

    if (emptyEntry == nullptr) return RssiAcceptResult::TableFull;
    startWindow(*emptyEntry, event);
    return RssiAcceptResult::Stored;
  }

  bool takeExpired(uint32_t nowMs, RssiScoreSelection& selection) {
    for (size_t i = 0; i < WINDOW_CAPACITY; ++i) {
      WindowEntry& entry = entries_[i];
      if (!entry.enabled || !expired(nowMs, entry.lastDetectedMs)) continue;
      selection = selectionFor(entry);
      entry = {};
      return true;
    }
    return false;
  }

  void clear() {
    for (size_t i = 0; i < WINDOW_CAPACITY; ++i) entries_[i] = {};
  }
};

#endif
