#include <assert.h>
#include <stdint.h>
#include "../../DetectionController.h"

int main() {
  DetectionController controller;
  const uint32_t epc = 0x3333F337UL;

  assert(!controller.isRunning());
  assert(controller.start(1000) == DetectResult::Accepted);
  assert(controller.start(2000) == DetectResult::StateNotAllowed);
  assert(controller.elapsedCentiseconds(2500) == 150);

  assert(controller.evaluateEpc(epc, 1000) == DetectResult::Accepted);
  assert(controller.evaluateEpc(epc, 8999) == DetectResult::DuplicateIgnored);
  assert(controller.evaluateEpc(epc, 9000) == DetectResult::Accepted);

  assert(controller.stop() == DetectResult::Accepted);
  assert(controller.stop() == DetectResult::StateNotAllowed);
  assert(controller.evaluateEpc(epc, 10000) == DetectResult::StateNotAllowed);

  assert(controller.start(0) == DetectResult::Accepted);
  for (uint32_t i = 0; i < 100; ++i) {
    assert(controller.evaluateEpc(i + 1, 0) == DetectResult::Accepted);
  }
  assert(controller.evaluateEpc(101, 7999) == DetectResult::TableFull);
  assert(controller.evaluateEpc(101, 8000) == DetectResult::Accepted);

  assert(controller.elapsedCentiseconds(0xFFFFFFFFUL) == 0xFFFFFFUL);
  // 一旦达到协议上限，millis() 回绕后也不能把总时长降回零。
  assert(controller.elapsedCentiseconds(0) == 0xFFFFFFUL);
  return 0;
}
