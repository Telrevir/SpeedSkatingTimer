#ifndef DETECTION_CONTROLLER_H
#define DETECTION_CONTROLLER_H

#include <stddef.h>
#include <stdint.h>

enum class DetectResult : uint8_t {
  Accepted,
  DuplicateIgnored,
  StateNotAllowed,
  TableFull
};

class DetectionController {
private:
  static constexpr size_t RECENT_EPC_CAPACITY = 100;
  static constexpr uint32_t DUPLICATE_INTERVAL_MS = 8000UL;
  static constexpr uint32_t MAX_CENTISECONDS = 0xFFFFFFUL;

  struct RecentEpc {
    uint32_t epc;
    uint32_t detectedAtMs;
    bool used;
  };

  bool running_;
  uint32_t startTimeMs_;
  mutable bool timeSaturated_;
  RecentEpc recentEpcs_[RECENT_EPC_CAPACITY];

  void clearRecentEpcs() {
    for (size_t i = 0; i < RECENT_EPC_CAPACITY; ++i) {
      recentEpcs_[i] = {0, 0, false};
    }
  }

public:
  DetectionController() : running_(false), startTimeMs_(0), timeSaturated_(false) {
    clearRecentEpcs();
  }

  bool isRunning() const {
    return running_;
  }

  DetectResult start(uint32_t nowMs) {
    if (running_) return DetectResult::StateNotAllowed;
    clearRecentEpcs();
    startTimeMs_ = nowMs;
    timeSaturated_ = false;
    running_ = true;
    return DetectResult::Accepted;
  }

  DetectResult stop() {
    if (!running_) return DetectResult::StateNotAllowed;
    running_ = false;
    startTimeMs_ = 0;
    timeSaturated_ = false;
    clearRecentEpcs();
    return DetectResult::Accepted;
  }

  uint32_t elapsedCentiseconds(uint32_t nowMs) const {
    if (!running_) return 0;
    if (timeSaturated_) return MAX_CENTISECONDS;
    uint32_t elapsedMs = nowMs - startTimeMs_;
    // 分开计算商和余数，避免millis接近上限时加5发生溢出。
    uint32_t value = elapsedMs / 10UL + (elapsedMs % 10UL >= 5UL ? 1UL : 0UL);
    if (value >= MAX_CENTISECONDS) {
      timeSaturated_ = true;
      return MAX_CENTISECONDS;
    }
    return value;
  }

  DetectResult evaluateEpc(uint32_t epc, uint32_t nowMs) {
    if (!running_) return DetectResult::StateNotAllowed;

    size_t reusableIndex = RECENT_EPC_CAPACITY;
    uint32_t reusableAge = 0;

    for (size_t i = 0; i < RECENT_EPC_CAPACITY; ++i) {
      RecentEpc& entry = recentEpcs_[i];
      if (!entry.used) {
        if (reusableIndex == RECENT_EPC_CAPACITY) reusableIndex = i;
        continue;
      }

      uint32_t age = nowMs - entry.detectedAtMs;
      if (entry.epc == epc) {
        if (age < DUPLICATE_INTERVAL_MS) return DetectResult::DuplicateIgnored;
        entry.detectedAtMs = nowMs;
        return DetectResult::Accepted;
      }

      // 只复用已经离开8秒保护期的最旧记录。
      if (age >= DUPLICATE_INTERVAL_MS &&
          (reusableIndex == RECENT_EPC_CAPACITY || age > reusableAge)) {
        reusableIndex = i;
        reusableAge = age;
      }
    }

    if (reusableIndex == RECENT_EPC_CAPACITY) return DetectResult::TableFull;
    recentEpcs_[reusableIndex] = {epc, nowMs, true};
    return DetectResult::Accepted;
  }
};

#endif
