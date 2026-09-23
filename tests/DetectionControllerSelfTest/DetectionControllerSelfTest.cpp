#include <assert.h>
#include <stdint.h>
#include "../../DetectionController.h"
#include "../../RfidTagEvent.h"
#include "../../RssiScoringController.h"

int main() {
  DetectionController controller;
  AthleteInfo info{};

  assert(!controller.isRunning());
  assert(controller.start(1000) == DetectResult::Accepted);
  assert(!controller.isAthleteClockRunning());
  assert(controller.start(2000) == DetectResult::StateNotAllowed);

  // 普通EPC保持原有8秒静默规则。
  EpcEvent ordinary = controller.evaluateEpc(0x11111111UL, 1500);
  assert(ordinary.type == EpcEventType::Ordinary);
  assert(controller.evaluateEpc(0x11111111UL, 9499).type ==
         EpcEventType::Ignored);
  assert(controller.evaluateEpc(0x11111111UL, 9500).type ==
         EpcEventType::Ordinary);

  // 第一名运动员确认时启动运动员成绩时钟，初始圈数和总时长必须为0。
  assert(controller.defineEpc(true, 0x11111111UL, 1, 10500, info) ==
         DefineResult::AthleteDefined);
  assert(controller.isAthleteClockRunning());
  assert(info.id == 1);
  assert(info.lapCount == 0);
  assert(info.lapCentiseconds == 0);
  assert(info.totalCentiseconds == 0);

  // 定义时刻开始运动员的8秒去重，不能立即计为第1圈。
  assert(controller.evaluateEpc(0x11111111UL, 10500).type ==
         EpcEventType::Ignored);

  // 后续运动员共用首个运动员启动的成绩时钟。
  assert(controller.defineEpc(true, 0x22222222UL, 2, 11500, info) ==
         DefineResult::AthleteDefined);
  assert(info.id == 2);
  assert(info.lapCount == 0);
  assert(info.lapCentiseconds == 0);
  assert(info.totalCentiseconds == 100);

  // 定义后不足8秒完全静默，满8秒后才计为第1圈。
  assert(controller.evaluateEpc(0x11111111UL, 18499).type ==
         EpcEventType::Ignored);
  EpcEvent firstLap = controller.evaluateEpc(0x11111111UL, 18500);
  assert(firstLap.type == EpcEventType::Athlete);
  assert(firstLap.athlete.id == 1);
  assert(firstLap.athlete.lapCount == 1);
  assert(firstLap.athlete.lapCentiseconds == 800);
  assert(firstLap.athlete.totalCentiseconds == 800);
  assert(controller.evaluateEpc(0x11111111UL, 26499).type ==
         EpcEventType::Ignored);
  EpcEvent secondLap = controller.evaluateEpc(0x11111111UL, 26500);
  assert(secondLap.type == EpcEventType::Athlete);
  assert(secondLap.athlete.lapCount == 2);
  assert(secondLap.athlete.lapCentiseconds == 800);
  assert(secondLap.athlete.totalCentiseconds == 1600);

  // 黑名单优先级最高，并从普通EPC记录中移除。
  assert(controller.evaluateEpc(0x33333333UL, 19000).type ==
         EpcEventType::Ordinary);
  assert(controller.defineEpc(false, 0x33333333UL, 0, 19100, info) ==
         DefineResult::Blacklisted);
  assert(controller.evaluateEpc(0x33333333UL, 28000).type ==
         EpcEventType::Ignored);

  // 0x11只遍历启用的运动员槽位。
  size_t found = 0;
  for (size_t slot = 0; slot < controller.athleteSlotCount(); ++slot) {
    if (!controller.athleteAt(slot, info)) continue;
    ++found;
  }
  assert(found == 2);

  // 结束后清空名单、黑名单、去重记录和运动员成绩时钟。
  assert(controller.stop() == DetectResult::Accepted);
  assert(!controller.isAthleteClockRunning());
  assert(controller.stop() == DetectResult::StateNotAllowed);
  assert(controller.start(30000) == DetectResult::Accepted);
  found = 0;
  for (size_t slot = 0; slot < controller.athleteSlotCount(); ++slot) {
    if (controller.athleteAt(slot, info)) ++found;
  }
  assert(found == 0);
  assert(controller.evaluateEpc(0x33333333UL, 30000).type ==
         EpcEventType::Ordinary);
  assert(controller.defineEpc(true, 0x44444444UL, 4, 33000, info) ==
         DefineResult::AthleteDefined);
  assert(info.lapCentiseconds == 0);
  assert(info.totalCentiseconds == 0);

  // RSSI模块只选择计分时刻，最终成绩仍由DetectionController计算。
  DetectionController rssiController;
  assert(rssiController.start(0) == DetectResult::Accepted);
  assert(rssiController.defineEpc(true, 0x55555555UL, 5, 0, info) ==
         DefineResult::AthleteDefined);
  assert(rssiController.isAthleteEpc(0x55555555UL));
  assert(!rssiController.isAthleteEpc(0x99999999UL));

  RssiScoringController scorer(100);
  RssiScoreSelection selection{};
  assert(scorer.accept({0x55555555UL, -70, 8000}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.accept({0x55555555UL, -40, 8020}, selection) ==
         RssiAcceptResult::Stored);
  assert(!scorer.takeExpired(8119, selection));
  assert(scorer.takeExpired(8120, selection));
  EpcEvent rssiLap = rssiController.evaluateEpc(selection.epc,
                                                 selection.detectedMs);
  assert(rssiLap.type == EpcEventType::Athlete);
  assert(rssiLap.athlete.lapCount == 1);
  assert(rssiLap.athlete.lapCentiseconds == 802);
  assert(rssiLap.athlete.totalCentiseconds == 802);

  // 有效过线将当时的圈数、名次和总用时写入近10圈固定历史。
  DetectionController rankedController;
  assert(rankedController.start(0) == DetectResult::Accepted);
  assert(rankedController.defineEpc(true, 0x66666666UL, 6, 0, info) ==
         DefineResult::AthleteDefined);
  assert(rankedController.defineEpc(true, 0x77777777UL, 7, 0, info) ==
         DefineResult::AthleteDefined);
  assert(rankedController.evaluateEpc(0x66666666UL, 8000).type ==
         EpcEventType::Athlete);
  assert(rankedController.evaluateEpc(0x77777777UL, 8000).type ==
         EpcEventType::Athlete);
  assert(rankedController.evaluateEpc(0x77777777UL, 16000).type ==
         EpcEventType::Athlete);
  assert(rankedController.evaluateEpc(0x66666666UL, 16000).type ==
         EpcEventType::Athlete);

  size_t athleteSixSlot = rankedController.athleteSlotCount();
  size_t athleteSevenSlot = rankedController.athleteSlotCount();
  for (size_t slot = 0; slot < rankedController.athleteSlotCount(); ++slot) {
    if (!rankedController.athleteAt(slot, info)) continue;
    if (info.id == 6) athleteSixSlot = slot;
    if (info.id == 7) athleteSevenSlot = slot;
  }
  assert(athleteSixSlot < rankedController.athleteSlotCount());
  assert(athleteSevenSlot < rankedController.athleteSlotCount());
  AthleteLapHistoryRecord history{};
  assert(rankedController.athleteHistoryCount(athleteSixSlot) == 2);
  assert(rankedController.athleteHistoryAt(athleteSixSlot, 0, history));
  assert(history.lapCount == 1 && history.rank == 1);
  assert(history.totalCentiseconds == 800);
  assert(rankedController.athleteHistoryAt(athleteSixSlot, 1, history));
  assert(history.lapCount == 2 && history.rank == 2);
  assert(history.totalCentiseconds == 1600);
  assert(rankedController.athleteHistoryCount(athleteSevenSlot) == 2);
  assert(rankedController.athleteHistoryAt(athleteSevenSlot, 0, history));
  assert(history.lapCount == 1 && history.rank == 2);
  assert(rankedController.athleteHistoryAt(athleteSevenSlot, 1, history));
  assert(history.lapCount == 2 && history.rank == 1);

  // 第11次有效过线覆盖最早记录，读取顺序始终为最早到最新。
  DetectionController ringController;
  assert(ringController.start(0) == DetectResult::Accepted);
  assert(ringController.defineEpc(true, 0x88888888UL, 8, 0, info) ==
         DefineResult::AthleteDefined);
  for (uint32_t lap = 1; lap <= 11; ++lap) {
    assert(ringController.evaluateEpc(0x88888888UL, lap * 8000UL).type ==
           EpcEventType::Athlete);
  }
  assert(ringController.evaluateEpc(0x88888888UL, 88001).type ==
         EpcEventType::Ignored);
  assert(ringController.athleteHistoryCount(0) == 10);
  assert(ringController.athleteHistoryAt(0, 0, history));
  assert(history.lapCount == 2 && history.rank == 1);
  assert(history.totalCentiseconds == 1600);
  assert(ringController.athleteHistoryAt(0, 9, history));
  assert(history.lapCount == 11 && history.rank == 1);
  assert(history.totalCentiseconds == 8800);
  assert(ringController.stop() == DetectResult::Accepted);
  assert(ringController.start(100000) == DetectResult::Accepted);
  assert(ringController.athleteHistoryCount(0) == 0);

  return 0;
}
