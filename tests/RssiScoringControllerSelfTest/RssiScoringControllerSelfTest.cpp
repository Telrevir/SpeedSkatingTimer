#include <assert.h>
#include <stdint.h>

#include "../../RfidTagEvent.h"
#include "../../RssiScoringController.h"

int main() {
  RssiScoringController scorer(100);
  RssiScoreSelection selection{};

  // 连续三次下降后立即结算整段最高峰；相同峰值取后一次。
  assert(scorer.accept({0x11111111UL, -40, 1000}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.accept({0x11111111UL, -40, 1010}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.accept({0x11111111UL, -50, 1020}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.accept({0x11111111UL, -60, 1030}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.accept({0x11111111UL, -70, 1040}, selection) ==
         RssiAcceptResult::ExpiredSelection);
  assert(selection.epc == 0x11111111UL);
  assert(selection.rssiDbm == -40);
  assert(selection.detectedMs == 1010);

  // 最后一个信号100ms内没有新信号时，结算当前最高峰。
  assert(scorer.accept({0x22222222UL, -40, 2000}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.accept({0x22222222UL, -35, 2030}, selection) ==
         RssiAcceptResult::Stored);
  assert(!scorer.takeExpired(2129, selection));
  assert(scorer.takeExpired(2130, selection));
  assert(selection.epc == 0x22222222UL);
  assert(selection.rssiDbm == -35);
  assert(selection.detectedMs == 2030);

  // 中途回升会中断下降计数，但整段仍选择最高峰。
  assert(scorer.accept({0x33333333UL, -40, 3000}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.accept({0x33333333UL, -55, 3010}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.accept({0x33333333UL, -45, 3020}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.accept({0x33333333UL, -50, 3030}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.accept({0x33333333UL, -60, 3040}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.accept({0x33333333UL, -70, 3050}, selection) ==
         RssiAcceptResult::ExpiredSelection);
  assert(selection.epc == 0x33333333UL);
  assert(selection.rssiDbm == -40);
  assert(selection.detectedMs == 3000);

  // 新样本与上一条相隔100ms时，先结算旧段并开启新段。
  assert(scorer.accept({0x55555555UL, -60, 4000}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.accept({0x55555555UL, -50, 4100}, selection) ==
         RssiAcceptResult::ExpiredSelection);
  assert(selection.detectedMs == 4000);
  assert(!scorer.takeExpired(4199, selection));
  assert(scorer.takeExpired(4200, selection));
  assert(selection.detectedMs == 4100);

  // 不同EPC分别聚合，不能用一个标签的强信号覆盖另一个标签。
  assert(scorer.accept({0x44444444UL, -55, 5000}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.accept({0x55555556UL, -45, 5050}, selection) ==
         RssiAcceptResult::Stored);
  assert(scorer.takeExpired(5100, selection));
  assert(selection.epc == 0x44444444UL);
  assert(scorer.takeExpired(5150, selection));
  assert(selection.epc == 0x55555556UL);

  // millis()回绕后，100ms静默仍要正确到期。
  assert(scorer.accept({0x66666666UL, -50, 0xFFFFFF00UL}, selection) ==
         RssiAcceptResult::Stored);
  assert(!scorer.takeExpired(0xFFFFFF63UL, selection));
  assert(scorer.takeExpired(0xFFFFFF64UL, selection));
  assert(selection.epc == 0x66666666UL);

  // 清空后，停止检测前遗留的候选不能产生延迟成绩。
  assert(scorer.accept({0x77777777UL, -50, 6000}, selection) ==
         RssiAcceptResult::Stored);
  scorer.clear();
  assert(!scorer.takeExpired(6100, selection));

  // 只为最多50名运动员保留候选，满表不能覆盖已有数据。
  for (uint32_t i = 0; i < 50; ++i) {
    assert(scorer.accept({0x80000000UL + i, -70, 7000}, selection) ==
           RssiAcceptResult::Stored);
  }
  assert(scorer.accept({0x90000000UL, -70, 7000}, selection) ==
         RssiAcceptResult::TableFull);

  return 0;
}