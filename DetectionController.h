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

struct AthleteLapHistoryRecord {
  uint16_t lapCount;
  uint16_t rank;
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
  static constexpr uint8_t LAP_HISTORY_CAPACITY = 10;
  static constexpr uint8_t LAP_HISTORY_RECORD_SIZE = 7;
  static constexpr uint32_t MAX_CENTISECONDS = 0xFFFFFFUL;

  struct AthleteEntry {
    bool enabled;
    uint16_t id;
    uint32_t epc;
    uint32_t lastDetectedMs;
    bool hasDetectionTime;
    uint32_t lastScoredOrder;
  };

  struct AthleteScoreEntry {
    bool enabled;
    uint16_t id;
    uint8_t lapCount;
    uint32_t lapCentiseconds;
    uint32_t totalCentiseconds;
    uint8_t lapHistory[LAP_HISTORY_CAPACITY][LAP_HISTORY_RECORD_SIZE];
    uint8_t lapHistoryCount;
    uint8_t nextLapHistoryIndex;
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
  uint32_t nextScoredOrder_;
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
    nextScoredOrder_ = 0;
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

  const AthleteScoreEntry* findScore(uint16_t id) const {
    for (size_t i = 0; i < LIST_CAPACITY; ++i) {
      if (athleteScores_[i].enabled && athleteScores_[i].id == id) {
        return &athleteScores_[i];
      }
    }
    return nullptr;
  }

  void writeLapHistory(AthleteScoreEntry& entry, uint16_t rank) {
    uint8_t* record = entry.lapHistory[entry.nextLapHistoryIndex];
    uint16_t lapCount = entry.lapCount;
    record[0] = static_cast<uint8_t>((lapCount >> 8) & 0xFF);
    record[1] = static_cast<uint8_t>(lapCount & 0xFF);
    record[2] = static_cast<uint8_t>((rank >> 8) & 0xFF);
    record[3] = static_cast<uint8_t>(rank & 0xFF);
    record[4] = static_cast<uint8_t>((entry.totalCentiseconds >> 16) & 0xFF);
    record[5] = static_cast<uint8_t>((entry.totalCentiseconds >> 8) & 0xFF);
    record[6] = static_cast<uint8_t>(entry.totalCentiseconds & 0xFF);

    entry.nextLapHistoryIndex = static_cast<uint8_t>(
      (entry.nextLapHistoryIndex + 1) % LAP_HISTORY_CAPACITY);
    if (entry.lapHistoryCount < LAP_HISTORY_CAPACITY) {
      ++entry.lapHistoryCount;
    }
  }

  uint16_t rankFor(const AthleteEntry& athlete,
                   const AthleteScoreEntry& score) const {
    uint16_t rank = 1;
    for (size_t i = 0; i < LIST_CAPACITY; ++i) {
      const AthleteEntry& otherAthlete = athletes_[i];
      if (!otherAthlete.enabled || otherAthlete.id == athlete.id) continue;
      const AthleteScoreEntry* otherScore = findScore(otherAthlete.id);
      if (otherScore == nullptr) continue;

      bool otherAhead = otherScore->lapCount > score.lapCount ||
        (otherScore->lapCount == score.lapCount &&
         otherScore->totalCentiseconds < score.totalCentiseconds) ||
        (otherScore->lapCount == score.lapCount &&
         otherScore->totalCentiseconds == score.totalCentiseconds &&
         otherAthlete.lastScoredOrder < athlete.lastScoredOrder);
      if (otherAhead) ++rank;
    }
    return rank;
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
      athleteClockStarted_(false), nextScoredOrder_(0) {
    clearAll();
  }

  bool isRunning() const { return running_; }
  bool isAthleteClockRunning() const { return athleteClockStarted_; }

  bool isAthleteEpc(uint32_t epc) const {
    for (size_t i = 0; i < LIST_CAPACITY; ++i) {
      if (athletes_[i].enabled && athletes_[i].epc == epc) return true;
    }
    return false;
  }

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
      athletes_[athleteSlot] = {true, id, epc, nowMs, true, 0};
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
      ++nextScoredOrder_;
      athlete.lastScoredOrder = nextScoredOrder_;
      writeLapHistory(*score, rankFor(athlete, *score));
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

  uint8_t athleteHistoryCount(size_t slot) const {
    if (slot >= LIST_CAPACITY || !athleteScores_[slot].enabled) return 0;
    return athleteScores_[slot].lapHistoryCount;
  }

  bool athleteHistoryAt(size_t slot, uint8_t historyIndex,
                        AthleteLapHistoryRecord& record) const {
    if (slot >= LIST_CAPACITY || !athleteScores_[slot].enabled) return false;
    const AthleteScoreEntry& entry = athleteScores_[slot];
    if (historyIndex >= entry.lapHistoryCount) return false;

    uint8_t firstIndex = entry.lapHistoryCount == LAP_HISTORY_CAPACITY
      ? entry.nextLapHistoryIndex : 0;
    uint8_t physicalIndex = static_cast<uint8_t>(
      (firstIndex + historyIndex) % LAP_HISTORY_CAPACITY);
    const uint8_t* bytes = entry.lapHistory[physicalIndex];
    record.lapCount = static_cast<uint16_t>(
      (static_cast<uint16_t>(bytes[0]) << 8) | bytes[1]);
    record.rank = static_cast<uint16_t>(
      (static_cast<uint16_t>(bytes[2]) << 8) | bytes[3]);
    record.totalCentiseconds = (static_cast<uint32_t>(bytes[4]) << 16) |
      (static_cast<uint32_t>(bytes[5]) << 8) | bytes[6];
    return true;
  }
};

#endif
