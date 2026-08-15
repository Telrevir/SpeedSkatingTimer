#ifndef DETECTION_CONTROLLER_H
#define DETECTION_CONTROLLER_H

#include <stddef.h>
#include <stdint.h>

enum class DetectResult : uint8_t {
  Accepted,
  StateNotAllowed
};

enum class DefineResult : uint8_t {
  AthleteDefined,
  Blacklisted,
  StateNotAllowed,
  TableFull
};

enum class EpcEventType : uint8_t {
  Ignored,
  Ordinary,
  Athlete,
  StateNotAllowed,
  TableFull
};

struct AthleteInfo {
  uint16_t id;
  uint8_t lapCount;
  uint32_t totalCentiseconds;
};

struct EpcEvent {
  EpcEventType type;
  AthleteInfo athlete;
};

class DetectionController {
private:
  static constexpr size_t LIST_CAPACITY = 50;
  static constexpr uint32_t DUPLICATE_INTERVAL_MS = 8000UL;
  static constexpr uint32_t MAX_CENTISECONDS = 0xFFFFFFUL;

  struct AthleteEntry {
    bool enabled;
    uint16_t id;
    uint32_t epc;
    uint8_t lapCount;
    uint32_t totalCentiseconds;
    uint32_t lastDetectedMs;
    bool hasDetectionTime;
  };

  struct BlacklistEntry {
    bool enabled;
    uint32_t epc;
  };

  struct RecentEpcEntry {
    bool enabled;
    uint32_t epc;
    uint32_t lastDetectedMs;
  };

  bool running_;
  uint32_t raceStartMs_;
  uint32_t athleteOffsetMs_;
  bool athleteOffsetSet_;
  AthleteEntry athletes_[LIST_CAPACITY];
  BlacklistEntry blacklist_[LIST_CAPACITY];
  RecentEpcEntry recentEpcs_[LIST_CAPACITY];

  void clearAll() {
    for (size_t i = 0; i < LIST_CAPACITY; ++i) {
      athletes_[i] = {};
      blacklist_[i] = {};
      recentEpcs_[i] = {};
    }
    athleteOffsetMs_ = 0;
    athleteOffsetSet_ = false;
  }

  uint32_t raceElapsedMs(uint32_t nowMs) const {
    return nowMs - raceStartMs_;
  }

  uint32_t toCentiseconds(uint32_t milliseconds) const {
    uint32_t value = milliseconds / 10UL +
                     (milliseconds % 10UL >= 5UL ? 1UL : 0UL);
    return value > MAX_CENTISECONDS ? MAX_CENTISECONDS : value;
  }

  uint32_t athleteTotal(uint32_t nowMs) const {
    if (!athleteOffsetSet_) return 0;
    return toCentiseconds(raceElapsedMs(nowMs) - athleteOffsetMs_);
  }

  AthleteInfo snapshot(const AthleteEntry& entry) const {
    return {entry.id, entry.lapCount, entry.totalCentiseconds};
  }

  void removeRecentEpc(uint32_t epc) {
    for (size_t i = 0; i < LIST_CAPACITY; ++i) {
      if (recentEpcs_[i].enabled && recentEpcs_[i].epc == epc) {
        recentEpcs_[i].enabled = false;
        return;
      }
    }
  }

public:
  DetectionController()
    : running_(false), raceStartMs_(0), athleteOffsetMs_(0),
      athleteOffsetSet_(false) {
    clearAll();
  }

  bool isRunning() const { return running_; }

  DetectResult start(uint32_t nowMs) {
    if (running_) return DetectResult::StateNotAllowed;
    clearAll();
    raceStartMs_ = nowMs;
    running_ = true;
    return DetectResult::Accepted;
  }

  DetectResult stop() {
    if (!running_) return DetectResult::StateNotAllowed;
    running_ = false;
    raceStartMs_ = 0;
    clearAll();
    return DetectResult::Accepted;
  }

  DefineResult defineEpc(bool isAthlete, uint32_t epc, uint16_t id,
                         uint32_t nowMs, AthleteInfo& info) {
    if (!running_) return DefineResult::StateNotAllowed;

    if (isAthlete) {
      for (size_t i = 0; i < LIST_CAPACITY; ++i) {
        if (athletes_[i].enabled) continue;

        uint32_t total = 0;
        if (!athleteOffsetSet_) {
          // 第一名运动员定义时建立统一偏移量，并强制从0开始。
          athleteOffsetMs_ = raceElapsedMs(nowMs);
          athleteOffsetSet_ = true;
        } else {
          total = athleteTotal(nowMs);
        }

        // 定义时刻即启动8秒去重，避免标签停留时立即被计为第1圈。
        athletes_[i] = {true, id, epc, 0, total, nowMs, true};
        removeRecentEpc(epc);
        info = snapshot(athletes_[i]);
        return DefineResult::AthleteDefined;
      }
      return DefineResult::TableFull;
    }

    for (size_t i = 0; i < LIST_CAPACITY; ++i) {
      if (blacklist_[i].enabled) continue;
      blacklist_[i] = {true, epc};
      removeRecentEpc(epc);
      info = {};
      return DefineResult::Blacklisted;
    }
    return DefineResult::TableFull;
  }

  EpcEvent evaluateEpc(uint32_t epc, uint32_t nowMs) {
    if (!running_) return {EpcEventType::StateNotAllowed, {}};

    // 黑名单优先级最高，命中后完全静默。
    for (size_t i = 0; i < LIST_CAPACITY; ++i) {
      if (blacklist_[i].enabled && blacklist_[i].epc == epc) {
        return {EpcEventType::Ignored, {}};
      }
    }

    for (size_t i = 0; i < LIST_CAPACITY; ++i) {
      AthleteEntry& athlete = athletes_[i];
      if (!athlete.enabled || athlete.epc != epc) continue;
      if (athlete.hasDetectionTime &&
          nowMs - athlete.lastDetectedMs < DUPLICATE_INTERVAL_MS) {
        return {EpcEventType::Ignored, {}};
      }

      athlete.lastDetectedMs = nowMs;
      athlete.hasDetectionTime = true;
      ++athlete.lapCount;
      athlete.totalCentiseconds = athleteTotal(nowMs);
      return {EpcEventType::Athlete, snapshot(athlete)};
    }

    size_t reusable = LIST_CAPACITY;
    uint32_t reusableAge = 0;
    for (size_t i = 0; i < LIST_CAPACITY; ++i) {
      RecentEpcEntry& entry = recentEpcs_[i];
      if (!entry.enabled) {
        if (reusable == LIST_CAPACITY) reusable = i;
        continue;
      }

      uint32_t age = nowMs - entry.lastDetectedMs;
      if (entry.epc == epc) {
        if (age < DUPLICATE_INTERVAL_MS) {
          return {EpcEventType::Ignored, {}};
        }
        entry.lastDetectedMs = nowMs;
        return {EpcEventType::Ordinary, {}};
      }

      // 只复用已经离开8秒保护期的最旧普通EPC记录。
      if (age >= DUPLICATE_INTERVAL_MS &&
          (reusable == LIST_CAPACITY || age > reusableAge)) {
        reusable = i;
        reusableAge = age;
      }
    }

    if (reusable == LIST_CAPACITY) return {EpcEventType::TableFull, {}};
    recentEpcs_[reusable] = {true, epc, nowMs};
    return {EpcEventType::Ordinary, {}};
  }

  size_t athleteSlotCount() const { return LIST_CAPACITY; }

  bool athleteAt(size_t slot, AthleteInfo& info) const {
    if (slot >= LIST_CAPACITY || !athletes_[slot].enabled) return false;
    info = snapshot(athletes_[slot]);
    return true;
  }
};

#endif
