# DetectOnly 固件设计

DetectOnly固件负责比赛启停、比赛时钟、临时运动员名单、EPC黑名单、8秒去重和LoRa协议响应。运动员数据只存在于内存，不访问TF卡或数据库。

完整设计规格见：

`docs/superpowers/specs/2026-08-14-temporary-athlete-list-design.md`

APP协议以`LORAProtocol-byte.md`为唯一依据。
