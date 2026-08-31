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
  uint32_t lapCentiseconds;
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
    uint32_t lastDetectedMs;
    bool hasDetectionTime;
  };

  struct AthleteScoreEntry {
    bool enabled;
    uint16_t id;
    uint8_t lapCount;
    uint32_t lapCentiseconds;
    uint32_t totalCentiseconds;
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
  uint32_t athleteClockStartMs_;
  bool athleteClockStarted_;
  AthleteEntry athletes_[LIST_CAPACITY];
  AthleteScoreEntry athleteScores_[LIST_CAPACITY];
  BlacklistEntry blacklist_[LIST_CAPACITY];
  RecentEpcEntry recentEpcs_[LIST_CAPACITY];

  void clearAll() {
    for (size_t i = 0; i < LIST_CAPACITY; ++i) {
      athletes_[i] = {};
      athleteScores_[i] = {};
      blacklist_[i] = {};
      recentEpcs_[i] = {};
    }
    athleteClockStartMs_ = 0;
    athleteClockStarted_ = false;
  }

  uint32_t toCentiseconds(uint32_t milliseconds) const {
    uint32_t value = milliseconds / 10UL +
                     (milliseconds % 10UL >= 5UL ? 1UL : 0UL);
    return value > MAX_CENTISECONDS ? MAX_CENTISECONDS : value;
  }

  uint32_t athleteTotal(uint32_t nowMs) const {
    if (!athleteClockStarted_) return 0;
    return toCentiseconds(nowMs - athleteClockStartMs_);
  }

  AthleteScoreEntry* findScore(uint16_t id) {
    for (size_t i = 0; i < LIST_CAPACITY; ++i) {
      if (athleteScores_[i].enabled && athleteScores_[i].id == id) {
        return &athleteScores_[i];
      }
    }
    return nullptr;
  }

  AthleteInfo snapshot(const AthleteScoreEntry& entry) const {
    return {entry.id, entry.lapCount, entry.lapCentiseconds,
            entry.totalCentiseconds};
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
    : running_(false), athleteClockStartMs_(0),
      athleteClockStarted_(false) {
    clearAll();
  }

  bool isRunning() const { return running_; }
  bool isAthleteClockRunning() const { return athleteClockStarted_; }

  DetectResult start(uint32_t nowMs) {
    if (running_) return DetectResult::StateNotAllowed;
    (void)nowMs;
    clearAll();
    running_ = true;
    return DetectResult::Accepted;
  }

  DetectResult stop() {
    if (!running_) return DetectResult::StateNotAllowed;
    running_ = false;
    clearAll();
    return DetectResult::Accepted;
  }

  DefineResult defineEpc(bool isAthlete, uint32_t epc, uint16_t id,
                         uint32_t nowMs, AthleteInfo& info) {
    if (!running_) return DefineResult::StateNotAllowed;

    if (isAthlete) {
      size_t athleteSlot = LIST_CAPACITY;
      size_t scoreSlot = LIST_CAPACITY;
      for (size_t i = 0; i < LIST_CAPACITY; ++i) {
        if (!athletes_[i].enabled && athleteSlot == LIST_CAPACITY) {
          athleteSlot = i;
        }
        if (!athleteScores_[i].enabled && scoreSlot == LIST_CAPACITY) {
          scoreSlot = i;
        }
      }
      if (athleteSlot == LIST_CAPACITY || scoreSlot == LIST_CAPACITY) {
        return DefineResult::TableFull;
      }

      uint32_t total = 0;
      if (!athleteClockStarted_) {
        // 首个运动员被确认时才启动成绩时钟，并强制从0开始。
        athleteClockStartMs_ = nowMs;
        athleteClockStarted_ = true;
      } else {
        total = athleteTotal(nowMs);
      }

      // 定义表只负责EPC匹配和去重，成绩表独立保存比赛成绩。
      athletes_[athleteSlot] = {true, id, epc, nowMs, true};
      athleteScores_[scoreSlot] = {true, id, 0, 0, total};
      removeRecentEpc(epc);
      info = snapshot(athleteScores_[scoreSlot]);
      return DefineResult::AthleteDefined;
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
      AthleteScoreEntry* score = findScore(athlete.id);
      if (score == nullptr) return {EpcEventType::TableFull, {}};
      uint32_t total = athleteTotal(nowMs);
      score->lapCentiseconds = total >= score->totalCentiseconds
        ? total - score->totalCentiseconds
        : 0;
      score->totalCentiseconds = total;
      ++score->lapCount;
      return {EpcEventType::Athlete, snapshot(*score)};
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
    if (slot >= LIST_CAPACITY || !athleteScores_[slot].enabled) return false;
    info = snapshot(athleteScores_[slot]);
    return true;
  }
};

#endif
