import { BACKEND_CONFIG } from '../../services/backend-api/config'
import { backendClient } from '../../services/backend-api/request'
import { athleteCatalog, scoreRepository } from '../../services/app-services'
import { RaceHistoryQuery } from '../../services/race-history-query'
import { buildRaceHistoryTree, type ExpandableRaceHistoryViewModel } from './view-model'

const historyQuery = new RaceHistoryQuery({
  client: backendClient,
  clubId: BACKEND_CONFIG.clubId,
  scoreRepository,
  athleteCatalog,
})
const expandedRaceIds = new Set<string>()
const expandedLapKeys = new Set<string>()
let latestRecords: Parameters<typeof buildRaceHistoryTree>[0] = []
let visible = false

Page({
  data: {
    races: [] as ExpandableRaceHistoryViewModel[],
    page: 1,
    pageSize: 20,
    total: 0,
    hasPrevious: false,
    hasNext: false,
    loading: false,
    errorMessage: '',
  },

  onLoad() {
    expandedRaceIds.clear()
    expandedLapKeys.clear()
  },
  onShow() {
    visible = true
    void this.loadHistory()
  },
  onHide() {
    visible = false
    historyQuery.cancel()
  },
  onUnload() {
    visible = false
    historyQuery.cancel()
    latestRecords = []
  },

  async loadHistory() {
    if (this.data.loading) return
    this.setData({ loading: true, errorMessage: '' })
    try {
      const result = await historyQuery.loadPage({
        page: this.data.page,
        pageSize: 20,
        sortBy: 'RaceDate',
        sortOrder: 'desc',
      })
      if (!visible || !result) return
      latestRecords = result.records
      this.setData({
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        hasPrevious: result.hasPrevious,
        hasNext: result.hasNext,
        races: buildRaceHistoryTree(latestRecords, expandedRaceIds, expandedLapKeys),
      })
    } catch (error) {
      if (visible) this.setData({ errorMessage: error instanceof Error ? error.message : '比赛记录暂时无法加载' })
    } finally {
      if (visible) this.setData({ loading: false })
    }
  },

  retry() { void this.loadHistory() },
  previousPage() {
    if (this.data.loading || !this.data.hasPrevious) return
    this.setData({ page: this.data.page - 1 }, () => void this.loadHistory())
  },
  nextPage() {
    if (this.data.loading || !this.data.hasNext) return
    this.setData({ page: this.data.page + 1 }, () => void this.loadHistory())
  },
  toggleRace(event: WechatMiniprogram.TouchEvent) {
    const raceId = String(event.currentTarget.dataset.id ?? '')
    if (!raceId) return
    toggleSetValue(expandedRaceIds, raceId)
    this.renderRaces()
  },
  toggleLap(event: WechatMiniprogram.TouchEvent) {
    const lapKey = String(event.currentTarget.dataset.key ?? '')
    if (!lapKey) return
    toggleSetValue(expandedLapKeys, lapKey)
    this.renderRaces()
  },
  renderRaces() {
    this.setData({ races: buildRaceHistoryTree(latestRecords, expandedRaceIds, expandedLapKeys) })
  },
})

function toggleSetValue(values: Set<string>, value: string): void {
  if (values.has(value)) values.delete(value)
  else values.add(value)
}
