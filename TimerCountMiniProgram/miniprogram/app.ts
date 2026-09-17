import { raceController, raceSyncScheduler, startupSync } from './services/app-services'

function initializeCloud(): void {
  try {
    // 云托管请求在 BackendClient 中指定环境与服务；这里仅初始化微信云能力。
    wx.cloud.init()
  } catch (error) {
    // 云能力初始化异常不能阻塞本地计时与蓝牙自动连接。
    try { console.warn('[云托管] 初始化失败', error) } catch { /* 日志失败不影响页面。 */ }
  }
}

App({
  onLaunch() {
    initializeCloud()
    // 网络同步不阻塞启动；仅输出摘要，不输出运动员资料或接口正文。
    void startupSync.runOnce().then((status) => {
      try { console.info('[后端同步]', status) } catch { /* 日志失败不影响页面。 */ }
    })
  },
  onShow() {
    void raceController.autoConnect()
    raceSyncScheduler.wake()
  },
})
