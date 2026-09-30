#include <assert.h>
#include <stdint.h>

#include "../../RfidPollingState.h"

int main() {
  RfidPollingState active(false, 300, 20);
  active.start(1000);

  // 主动模式启动后立即允许发出第一条单次盘点命令。
  assert(active.takeAction(1000) == RfidPollingAction::SendSingleInventory);
  assert(active.takeAction(1299) == RfidPollingAction::None);

  // 无任何数据时，300ms超时后才允许下一次盘点。
  assert(active.takeAction(1300) == RfidPollingAction::SendSingleInventory);

  // 标签通知到达后保留20ms帧间等待，以收集同轮的后续标签。
  active.noteByteReceived(1310);
  assert(active.takeAction(1329) == RfidPollingAction::None);
  assert(active.takeAction(1330) == RfidPollingAction::SendSingleInventory);

  // 完整空盘点错误帧代表本轮已结束，可以立即发起下一轮。
  active.finishRound();
  assert(active.takeAction(1330) == RfidPollingAction::SendSingleInventory);

  // 被动模式只接收连续通知，永远不发送单次盘点命令。
  RfidPollingState passive(true, 300, 20);
  passive.start(2000);
  assert(passive.takeAction(2000) == RfidPollingAction::None);
  passive.noteByteReceived(2010);
  assert(passive.takeAction(2500) == RfidPollingAction::None);

  // 使用无符号差值，millis()回绕后仍能正确处理超时。
  RfidPollingState wrapAround(false, 300, 20);
  wrapAround.start(0xFFFFFF00UL);
  assert(wrapAround.takeAction(0xFFFFFF00UL) ==
         RfidPollingAction::SendSingleInventory);
  assert(wrapAround.takeAction(0x0000002BUL) == RfidPollingAction::None);
  assert(wrapAround.takeAction(0x0000002CUL) ==
         RfidPollingAction::SendSingleInventory);

  return 0;
}
