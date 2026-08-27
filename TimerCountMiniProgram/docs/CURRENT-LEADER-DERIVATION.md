# 实时领滑推断规则

小程序不再依赖周期性 `0x05` 查询和 `0x06` 领滑成绩来驱动实时领滑。设备扫描到有效 EPC 后立即发送 `0x02`，并且发送的圈数已经完成递增；因此小程序可以根据实时 `0x02` 成绩包的圈数推断领滑。

规则：

```text
CurrentMaxLoop 初始为 -1

收到实时 AthleteScore：
  如果 lapCount > CurrentMaxLoop：
    当前运动员成为领滑
    CurrentMaxLoop = lapCount
    使用当前领滑总用时更新领滑单圈基准
  如果 lapCount <= CurrentMaxLoop：
    不改变当前领滑
```

设备按过线顺序发送成绩，因此相同圈数的后续成绩不能抢占先到达的领滑成绩。全量历史成绩恢复期间的 `0x02` 只用于恢复运动员成绩，不参与实时领滑推断。比赛重置时清空 `CurrentMaxLoop`、当前领滑和领滑单圈基准。
