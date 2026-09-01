import {
  ConnectionState,
  FirmwareDetectionState,
  getConnectionPresentation,
  getRaceControlsState,
} from '../../domain/race-state'
import type { Athlete } from '../../domain/athlete'
import { formatRelativeTotalTime } from '../../domain/relative-total-time'
import { formatCentiseconds } from '../../domain/time-format'
import { groupStore, raceController } from '../../services/app-services'
import type { RaceSnapshot } from '../../stores/race-store'

let unsubscribe: (() => void) | null = null
let unsubscribeAthletes: (() => void) | null = null
let unsubscribeGroups: (() => void) | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

Page({
  data: {
    connecting: false,
    autoConnecting: false,
    connectButtonText: '连接',
    connectionText: '未连接 ESP32-LORA-BRIDGE',
    showConnectButton: true,
    raceStateText: '未连接设备',
    raceStateClass: 'state-disconnected',
    finishLapText: '',
    primaryLabel: '开始',
    primaryEnabled: false,
    resetEnabled: false,
    groupName: '全部运动员',
    leaderName: '—',
    leaderRawLap: '—',
    leaderCorrectionOffset: 0,
    leaderLapTime: '—',
    topFive: [] as Array<{
      rank: number
      name: string
      rawLap: string
      correctionOffset: number
      time: string
      finished: boolean
    }>,
  },

  onLoad() {
    unsubscribe = raceController.subscribe((snapshot) => this.renderSnapshot(snapshot))
    unsubscribeGroups = groupStore.subscribe(() => {
      const active = groupStore.active
      this.setData({ groupName: active?.name ?? '全部运动员' })
    })
    unsubscribeAthletes = raceController.subscribeAthletes((athletes) => {
      const leader = athletes.find(({ id }) => id === raceController.snapshot.leaderAthleteId)
      this.setData({
        topFive: athletes
          .filter(({ currentRank, hasRaceScore }) => currentRank > 0 && hasRaceScore)
          .sort((left, right) => left.currentRank - right.currentRank)
          .slice(0, 5)
          .map((athlete) => {
            const lap = lapPresentation(athlete)
            return {
              rank: athlete.currentRank,
              name: athlete.name,
              rawLap: lap.rawLap,
              correctionOffset: lap.correctionOffset,
              time: formatRelativeTotalTime(athlete, leader),
              finished: athlete.finished,
            }
          }),
      })
      this.renderSnapshot(raceController.snapshot)
    })
    pollTimer = setInterval(() => {
      if (raceController.snapshot.connectionState === ConnectionState.Connected) {
        void raceController.requestLiveState().catch(() => undefined)
      }
    }, 1000)
  },

  onUnload() {
    unsubscribe?.()
    unsubscribeAthletes?.()
    unsubscribeGroups?.()
    unsubscribe = null
    unsubscribeAthletes = null
    unsubscribeGroups = null
    if (pollTimer !== null) clearInterval(pollTimer)
    pollTimer = null
  },

  onShow() {
    void raceController.autoConnect()
  },

  async connectDevice() {
    if (this.data.connecting) return
    this.setData({ connecting: true, connectionText: '正在连接 ESP32-LORA-BRIDGE' })
    try {
      await raceController.connect()
    } catch (error) {
      const message = error instanceof Error ? error.message : '蓝牙连接失败'
      this.setData({ connectionText: message })
      wx.showToast({ title: message, icon: 'none', duration: 3000 })
    } finally {
      this.setData({ connecting: false })
    }
  },

  async toggleRace() {
    try {
      if (raceController.snapshot.localPhase === 'idle') await raceController.startRace()
      else if (raceController.snapshot.localPhase === 'running') raceController.endRace()
    } catch (error) {
      this.showOperationError(error)
    }
  },

  async resetRace() {
    try {
      await raceController.resetRace()
    } catch (error) {
      this.showOperationError(error)
    }
  },

  chooseGroup() {
    if (!raceController.canManageAthletes) {
      wx.showToast({ title: '本场比赛重置前不能切换分组', icon: 'none' })
      return
    }
    const groups = groupStore.snapshot
    wx.showActionSheet({
      itemList: ['全部运动员', ...groups.map(({ name }) => name)],
      success: (result) => {
        const group = groups[result.tapIndex - 1]
        try {
          raceController.selectGroup(group?.id ?? null)
        } catch (error) {
          this.showOperationError(error)
        }
      },
    })
  },

  renderSnapshot(snapshot: RaceSnapshot) {
    const controls = getRaceControlsState(
      snapshot.connectionState,
      snapshot.firmwareState,
      snapshot.localPhase,
    )
    const connection = getConnectionPresentation(
      snapshot.connectionState,
      snapshot.autoConnectState,
    )
    const presentation = raceStatePresentation(snapshot)
    const leader = raceController.athletesSnapshot.find(({ id }) => id === snapshot.leaderAthleteId)
    const leaderLap = leader ? lapPresentation(leader) : null
    this.setData({
      ...connection,
      raceStateText: presentation.text,
      raceStateClass: presentation.className,
      finishLapText: snapshot.finishLap === null ? '' : `结束圈数：${snapshot.finishLap}`,
      leaderName: leader?.name ?? '—',
      leaderRawLap: leaderLap?.rawLap ?? '—',
      leaderCorrectionOffset: leaderLap?.correctionOffset ?? 0,
      leaderLapTime: snapshot.leaderLapCentiseconds === null
        ? '—'
        : formatCentiseconds(snapshot.leaderLapCentiseconds),
      ...controls,
    })
  },

  showOperationError(error: unknown) {
    wx.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
  },
})

function raceStatePresentation(snapshot: RaceSnapshot): { text: string; className: string } {
  if (snapshot.connectionState !== ConnectionState.Connected) {
    return { text: '未连接设备', className: 'state-disconnected' }
  }
  if (snapshot.localPhase === 'idle'
      && snapshot.firmwareState === FirmwareDetectionState.Detecting) {
    return { text: '设备仍在检测，请重置后重新开始', className: 'state-waiting' }
  }
  switch (snapshot.localPhase) {
    case 'running': return { text: '比赛进行中', className: 'state-running' }
    case 'finishing': return { text: '等待其他运动员完成', className: 'state-waiting' }
    case 'finished': return { text: '比赛已结束', className: 'state-finished' }
    default: return { text: '比赛未开始', className: 'state-idle' }
  }
}

function lapPresentation(athlete: Athlete): { rawLap: string; correctionOffset: number } {
  const rawLap = athlete.rawLapCount ?? athlete.lapCount
  const correctedLap = athlete.correctedLapCount ?? athlete.lapCount
  const displayedRawLap = Math.min(rawLap, correctedLap)
  return {
    rawLap: displayedRawLap < 0 ? '—' : String(displayedRawLap),
    correctionOffset: Math.max(0, correctedLap - displayedRawLap),
  }
}
