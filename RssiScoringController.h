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

  struct WindowEntry {
    bool enabled;
    uint32_t epc;
    uint32_t windowStartedMs;
    int8_t bestRssiDbm;
    uint32_t bestDetectedMs;
  };

  uint32_t windowMs_;
  WindowEntry entries_[WINDOW_CAPACITY];

  bool expired(uint32_t nowMs, uint32_t startedMs) const {
    return nowMs - startedMs >= windowMs_;
  }

  RssiScoreSelection selectionFor(const WindowEntry& entry) const {
    return {entry.epc, entry.bestDetectedMs, entry.bestRssiDbm};
  }

  void startWindow(WindowEntry& entry, const RfidTagEvent& event) {
    entry = {true, event.epc, event.detectedMs, event.rssiDbm, event.detectedMs};
  }

public:
  explicit RssiScoringController(uint32_t windowMs) : windowMs_(windowMs) {
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

      if (expired(event.detectedMs, entry.windowStartedMs)) {
        expiredSelection = selectionFor(entry);
        startWindow(entry, event);
        return RssiAcceptResult::ExpiredSelection;
      }

      if (event.rssiDbm > entry.bestRssiDbm) {
        entry.bestRssiDbm = event.rssiDbm;
        entry.bestDetectedMs = event.detectedMs;
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
      if (!entry.enabled || !expired(nowMs, entry.windowStartedMs)) continue;
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
