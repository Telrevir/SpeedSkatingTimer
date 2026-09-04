import { raceController, startupSync } from './services/app-services'

App({
  onLaunch() {
    // 网络同步不阻塞启动；仅输出摘要，不输出运动员资料或接口正文。
    void startupSync.runOnce().then((status) => {
      try { console.info('[后端同步]', status) } catch { /* 日志失败不影响页面。 */ }
    })
  },
  onShow() {
    void raceController.autoConnect()
  },
})
