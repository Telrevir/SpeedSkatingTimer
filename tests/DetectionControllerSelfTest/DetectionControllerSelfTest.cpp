#include <assert.h>
#include <stdint.h>
#include "../../DetectionController.h"

int main() {
  DetectionController controller;
  AthleteInfo info{};

  assert(!controller.isRunning());
  assert(controller.start(1000) == DetectResult::Accepted);
  assert(controller.start(2000) == DetectResult::StateNotAllowed);

  // 普通EPC保持原有8秒静默规则。
  EpcEvent ordinary = controller.evaluateEpc(0x11111111UL, 1500);
  assert(ordinary.type == EpcEventType::Ordinary);
  assert(controller.evaluateEpc(0x11111111UL, 9499).type ==
         EpcEventType::Ignored);
  assert(controller.evaluateEpc(0x11111111UL, 9500).type ==
         EpcEventType::Ordinary);

  // 第一名运动员建立统一偏移量，初始圈数和总时长必须为0。
  assert(controller.defineEpc(true, 0x11111111UL, 1, 10500, info) ==
         DefineResult::AthleteDefined);
  assert(info.id == 1);
  assert(info.lapCount == 0);
  assert(info.totalCentiseconds == 0);

  // 定义运动员会移除普通EPC记录，因此第一次运动员检测立即生效。
  EpcEvent firstLap = controller.evaluateEpc(0x11111111UL, 10500);
  assert(firstLap.type == EpcEventType::Athlete);
  assert(firstLap.athlete.id == 1);
  assert(firstLap.athlete.lapCount == 1);
  assert(firstLap.athlete.totalCentiseconds == 0);

  // 后续运动员共用第一名运动员的时间偏移量。
  assert(controller.defineEpc(true, 0x22222222UL, 2, 11500, info) ==
         DefineResult::AthleteDefined);
  assert(info.id == 2);
  assert(info.lapCount == 0);
  assert(info.totalCentiseconds == 100);

  // 运动员的8秒记录独立于普通EPC记录。
  assert(controller.evaluateEpc(0x11111111UL, 18499).type ==
         EpcEventType::Ignored);
  EpcEvent secondLap = controller.evaluateEpc(0x11111111UL, 18500);
  assert(secondLap.type == EpcEventType::Athlete);
  assert(secondLap.athlete.lapCount == 2);
  assert(secondLap.athlete.totalCentiseconds == 800);

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

  // 结束后清空名单、黑名单、去重记录和时间偏移量。
  assert(controller.stop() == DetectResult::Accepted);
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
  assert(info.totalCentiseconds == 0);

  return 0;
}
