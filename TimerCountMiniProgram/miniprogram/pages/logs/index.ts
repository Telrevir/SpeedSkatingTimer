import { protocolLog } from '../../services/app-services'
import { ProtocolLogPageSubscription } from '../../services/protocol-log-page-subscription'
import {
  PROTOCOL_LOG_CAPACITY,
  type ProtocolLogEntry,
} from '../../stores/protocol-log-store'

const subscription = new ProtocolLogPageSubscription(protocolLog)

Page({
  data: {
    logs: [] as ProtocolLogEntry[],
    capacity: PROTOCOL_LOG_CAPACITY,
  },

  onShow() {
    subscription.show((logs) => this.setData({ logs }))
  },

  onHide() { subscription.hide() },
  onUnload() { subscription.hide() },

  clearLogs() {
    if (this.data.logs.length === 0) return
    wx.showModal({
      title: '清空日志',
      content: '确认清空本次运行期间收到的全部协议包？',
      success: (result) => {
        if (result.confirm) protocolLog.clear()
      },
    })
  },
})
