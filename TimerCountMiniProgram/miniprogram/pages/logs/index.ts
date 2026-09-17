import {
  bleProfileRepository,
  protocolLog,
  raceController,
} from '../../services/app-services'
import { ConnectionState } from '../../domain/race-state'
import { ProtocolLogPageSubscription } from '../../services/protocol-log-page-subscription'
import {
  PROTOCOL_LOG_CAPACITY,
  type ProtocolLogEntry,
} from '../../stores/protocol-log-store'
import type { BleProfileListItem } from '../../services/ble-profile-repository'

interface ProfileForm {
  name: string
  serviceUuid: string
  commandRxUuid: string
  notificationTxUuid: string
}

const subscription = new ProtocolLogPageSubscription(protocolLog)
let unsubscribeRace: (() => void) | null = null

const emptyForm = (): ProfileForm => ({
  name: '',
  serviceUuid: '',
  commandRxUuid: '',
  notificationTxUuid: '',
})

Page({
  data: {
    logs: [] as ProtocolLogEntry[],
    capacity: PROTOCOL_LOG_CAPACITY,
    logsExpanded: false,
    bluetoothExpanded: false,
    profiles: [] as BleProfileListItem[],
    editingId: '',
    formVisible: false,
    form: emptyForm(),
    connecting: false,
    isConnected: false,
    bluetoothStatus: '',
  },

  onShow() {
    subscription.show((logs) => this.setData({ logs }))
    unsubscribeRace = raceController.subscribe(() => this.refreshBluetooth())
    this.refreshBluetooth()
  },

  onHide() {
    subscription.hide()
    unsubscribeRace?.()
    unsubscribeRace = null
  },

  onUnload() {
    this.onHide()
  },

  toggleLogs() {
    this.setData({ logsExpanded: !this.data.logsExpanded })
  },

  toggleBluetooth() {
    this.setData({ bluetoothExpanded: !this.data.bluetoothExpanded })
  },

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

  async connectDevice() {
    if (this.data.connecting || this.data.isConnected) return
    this.setData({ connecting: true })
    try {
      await raceController.connect()
      wx.showToast({ title: '蓝牙连接成功', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '蓝牙连接失败', icon: 'none' })
    } finally {
      this.setData({ connecting: false })
      this.refreshBluetooth()
    }
  },

  openAdd() {
    this.setData({ editingId: '', formVisible: true, form: emptyForm() })
  },

  editProfile(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '')
    const profile = this.data.profiles.find((item) => item.id === id)
    if (!profile) return
    this.setData({
      editingId: profile.id,
      formVisible: true,
      form: {
        name: profile.name,
        serviceUuid: profile.serviceUuid,
        commandRxUuid: profile.commandRxUuid,
        notificationTxUuid: profile.notificationTxUuid,
      },
    })
  },

  cancelEdit() {
    this.setData({ editingId: '', formVisible: false, form: emptyForm() })
  },

  updateField(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field ?? '') as keyof ProfileForm
    if (!['name', 'serviceUuid', 'commandRxUuid', 'notificationTxUuid'].includes(field)) return
    this.setData({ ['form.' + field]: event.detail.value })
  },

  saveProfile() {
    try {
      const saved = bleProfileRepository.save({
        id: this.data.editingId || undefined,
        ...this.data.form,
      })
      const active = bleProfileRepository.active()
      this.refreshBluetooth()
      this.setData({ editingId: '', formVisible: false, form: emptyForm() })
      wx.showToast({
        title: saved.id === active.id ? '已保存，断开后重连生效' : '蓝牙配置已保存',
        icon: 'none',
      })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '保存失败', icon: 'none' })
    }
  },

  activateProfile(event: WechatMiniprogram.TouchEvent) {
    try {
      bleProfileRepository.activate(String(event.currentTarget.dataset.id ?? ''))
      this.refreshBluetooth()
      wx.showToast({ title: '已启用，断开后重连生效', icon: 'none' })
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '启用失败', icon: 'none' })
    }
  },

  deleteProfile(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '')
    const profile = this.data.profiles.find((item) => item.id === id)
    if (!profile) return
    wx.showModal({
      title: '删除蓝牙配置',
      content: '确定删除“' + profile.name + '”吗？',
      success: (result) => {
        if (!result.confirm) return
        try {
          bleProfileRepository.remove(id)
          this.refreshBluetooth()
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: error instanceof Error ? error.message : '删除失败', icon: 'none' })
        }
      },
    })
  },

  refreshBluetooth() {
    const active = bleProfileRepository.active()
    const isConnected = raceController.snapshot.connectionState === ConnectionState.Connected
    this.setData({
      profiles: bleProfileRepository.list(),
      isConnected,
      bluetoothStatus: (isConnected ? '已连接 ' : '未连接 ') + active.name,
    })
  },
})
