import { athleteCatalog } from '../../services/app-services'
import { BACKEND_CONFIG } from '../../services/backend-api/config'
import { backendClient } from '../../services/backend-api/request'
import { listActiveRaces } from '../../services/backend-api/races/list-active-races'
import { listLatestScores } from '../../services/backend-api/races/list-latest-scores'
import type { RaceInfoDto, ScoreDto } from '../../services/backend-api/types'
import { parseRaceDate } from '../../services/backend-sync/validation'
import { buildLiveRaceViewModel, type LiveRaceViewModel } from './view-model'

const expanded = new Set<number>()
const latestScores = new Map<number, ScoreDto[]>()
const scoreTimers = new Map<number, ReturnType<typeof setTimeout>>()
const scoreRequests = new Set<number>()
let races: RaceInfoDto[] = []
let serverTime = ''
let receivedAt = 0
let visible = false
let listRequestRunning = false
let listTimer: ReturnType<typeof setTimeout> | null = null
let displayTimer: ReturnType<typeof setInterval> | null = null

Page({
  data: {
    races: [] as LiveRaceViewModel[],
    loading: false,
    errorMessage: '',
  },

  onShow() {
    if (visible) return
    visible = true
    displayTimer = setInterval(() => this.render(), 1000)
    void this.refreshList()
  },
  onHide() { this.stopPolling() },
  onUnload() { this.stopPolling() },

  stopPolling() {
    visible = false
    if (listTimer !== null) clearTimeout(listTimer)
    if (displayTimer !== null) clearInterval(displayTimer)
    listTimer = null
    displayTimer = null
    scoreTimers.forEach((timer) => clearTimeout(timer))
    scoreTimers.clear()
  },

  async refreshList() {
    if (!visible || listRequestRunning) return
    if (listTimer !== null) clearTimeout(listTimer)
    listTimer = null
    listRequestRunning = true
    if (!races.length) this.setData({ loading: true })
    try {
      const response = await listActiveRaces(backendClient, BACKEND_CONFIG.clubId)
      if (!visible) return
      if (!response.ok || !response.data || !Array.isArray(response.data.list)
          || typeof response.data.ServerTime !== 'string') throw new Error('当前比赛暂时无法加载')
      const nextRaces = response.data.list.filter((race) => Number.isInteger(race.RaceID) && race.RaceID! > 0
        && race.ClubID === BACKEND_CONFIG.clubId && race.Enabled && !race.IsFinished)
      parseRaceDate(response.data.ServerTime)
      nextRaces.forEach((race) => parseRaceDate(race.RaceDate))
      races = nextRaces
      serverTime = response.data.ServerTime
      receivedAt = Date.now()
      const activeIds = new Set(races.map((race) => race.RaceID!))
      ;[...expanded].forEach((raceId) => {
        if (!activeIds.has(raceId)) {
          expanded.delete(raceId)
          this.stopScorePolling(raceId)
          latestScores.delete(raceId)
        }
      })
      ;[...expanded].forEach((raceId) => {
        if (!scoreTimers.has(raceId) && !scoreRequests.has(raceId)) void this.refreshScores(raceId)
      })
      this.setData({ errorMessage: '' })
      this.render()
    } catch (error) {
      if (visible) this.setData({ errorMessage: error instanceof Error ? error.message : '当前比赛暂时无法加载' })
    } finally {
      listRequestRunning = false
      if (visible) {
        this.setData({ loading: false })
        listTimer = setTimeout(() => void this.refreshList(), 5000)
      }
    }
  },

  toggleRace(event: WechatMiniprogram.TouchEvent) {
    const raceId = Number(event.currentTarget.dataset.id)
    if (!Number.isInteger(raceId) || raceId < 1) return
    if (expanded.has(raceId)) {
      expanded.delete(raceId)
      this.stopScorePolling(raceId)
    } else {
      expanded.add(raceId)
      void this.refreshScores(raceId)
    }
    this.render()
  },

  async refreshScores(raceId: number) {
    if (!visible || !expanded.has(raceId) || scoreRequests.has(raceId)) return
    scoreRequests.add(raceId)
    try {
      const response = await listLatestScores(backendClient, raceId)
      if (!visible || !expanded.has(raceId)) return
      if (!response.ok || response.data?.RaceID !== raceId || !Array.isArray(response.data.Scores)) {
        throw new Error('实时成绩暂时无法更新')
      }
      latestScores.set(raceId, response.data.Scores)
      this.setData({ errorMessage: '' })
      this.render()
    } catch (error) {
      if (visible) this.setData({ errorMessage: error instanceof Error ? error.message : '实时成绩暂时无法更新' })
    } finally {
      scoreRequests.delete(raceId)
      if (visible && expanded.has(raceId)) {
        this.stopScorePolling(raceId)
        scoreTimers.set(raceId, setTimeout(() => void this.refreshScores(raceId), 1000))
      }
    }
  },

  retry() { void this.refreshList() },
  render() {
    if (!serverTime) return
    const athletes = [...athleteCatalog.activeSnapshot, ...athleteCatalog.archivedSnapshot]
    this.setData({
      races: races.map((race) => buildLiveRaceViewModel(
        race,
        latestScores.get(race.RaceID!) ?? [],
        athletes,
        serverTime,
        receivedAt,
        Date.now(),
        expanded.has(race.RaceID!),
      )),
    })
  },
  stopScorePolling(raceId: number) {
    const timer = scoreTimers.get(raceId)
    if (timer !== undefined) clearTimeout(timer)
    scoreTimers.delete(raceId)
  },
})
