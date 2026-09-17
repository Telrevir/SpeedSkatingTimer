#include <assert.h>
#include <stdint.h>

#include "../../RfidTagEvent.h"
#include "../../RssiScoringController.h"

int main() {
  RssiScoringController scorer(300);
  RssiScoreSelection selection{};

  // 同一EPC窗口内信号最强的样本决定计分时间。
  assert(scorer.accept({0x11111111UL, -70, 1000}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.accept({0x11111111UL, -42, 1120}, selection) ==
         RssiAcceptResult::Stored);
  assert(!scorer.takeExpired(1299, selection));
  assert(scorer.takeExpired(1300, selection));
  assert(selection.epc == 0x11111111UL);
  assert(selection.rssiDbm == -42);
  assert(selection.detectedMs == 1120);

  // 信号相同保留先到样本，保证同一输入序列结果稳定。
  assert(scorer.accept({0x22222222UL, -40, 2000}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.accept({0x22222222UL, -40, 2100}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.takeExpired(2300, selection));
  assert(selection.epc == 0x22222222UL);
  assert(selection.detectedMs == 2000);

  // 不同EPC分别聚合，不能用一个标签的强信号覆盖另一个标签。
  assert(scorer.accept({0x33333333UL, -55, 3000}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.accept({0x44444444UL, -45, 3050}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.takeExpired(3300, selection));
  assert(selection.epc == 0x33333333UL);
  assert(scorer.takeExpired(3350, selection));
  assert(selection.epc == 0x44444444UL);

  // 新样本恰好跨过窗口边界时，先结算旧窗口并开启新窗口。
  assert(scorer.accept({0x55555555UL, -60, 4000}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.accept({0x55555555UL, -50, 4300}, selection) ==
         RssiAcceptResult::ExpiredSelection);
  assert(selection.detectedMs == 4000);
  assert(!scorer.takeExpired(4599, selection));
  assert(scorer.takeExpired(4600, selection));
  assert(selection.detectedMs == 4300);

  // millis()回绕后，300ms窗口仍要正确到期。
  assert(scorer.accept({0x66666666UL, -50, 0xFFFFFF00UL}, selection) ==
         RssiAcceptResult::Stored);
  assert(!scorer.takeExpired(0x0000002BUL, selection));
  assert(scorer.takeExpired(0x0000002CUL, selection));
  assert(selection.epc == 0x66666666UL);

  // 清空后，停止检测前遗留的窗口不能产生延迟成绩。
  assert(scorer.accept({0x77777777UL, -50, 5000}, selection) ==
         RssiAcceptResult::Stored);
  scorer.clear();
  assert(!scorer.takeExpired(5300, selection));

  // 只为最多50名运动员保留候选窗口，满表不能覆盖已有数据。
  for (uint32_t i = 0; i < 50; ++i) {
    assert(scorer.accept({0x80000000UL + i, -70, 6000}, selection) ==
           RssiAcceptResult::Stored);
  }
  assert(scorer.accept({0x90000000UL, -70, 6000}, selection) ==
         RssiAcceptResult::TableFull);

  return 0;
}
