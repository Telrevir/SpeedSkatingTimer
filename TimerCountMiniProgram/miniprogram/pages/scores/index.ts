import { scoreRepository } from '../../services/app-services'
import type { RaceRecord } from '../../services/score-repository'
import {
  buildRaceHistoryTree,
  type ExpandableRaceHistoryViewModel,
} from './view-model'

let unsubscribe: (() => void) | null = null
let latestRecords: RaceRecord[] = []
const expandedRaceIds = new Set<string>()
const expandedLapKeys = new Set<string>()

Page({
  data: {
    races: [] as ExpandableRaceHistoryViewModel[],
  },
  onLoad() {
    expandedRaceIds.clear()
    expandedLapKeys.clear()
    unsubscribe = scoreRepository.subscribe((records) => {
      latestRecords = records
      this.renderRaces()
    })
  },
  onUnload() {
    unsubscribe?.()
    unsubscribe = null
    latestRecords = []
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
    this.setData({
      races: buildRaceHistoryTree(latestRecords, expandedRaceIds, expandedLapKeys),
    })
  },
})

function toggleSetValue(values: Set<string>, value: string): void {
  if (values.has(value)) values.delete(value)
  else values.add(value)
}
