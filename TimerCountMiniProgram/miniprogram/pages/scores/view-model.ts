import type { RaceRecord } from '../../services/score-repository'
import { formatCentiseconds } from '../../domain/time-format'

export interface ScoreHistoryRowViewModel {
  key: string
  name: string
  lapTime: string
  totalTime: string
  rank: number
}

export interface LapHistoryViewModel {
  key: string
  lap: number
  leaderName: string
  leaderLapTime: string
  scores: ScoreHistoryRowViewModel[]
}

export interface RaceHistoryViewModel {
  id: string
  startedAt: string
  status: string
  totalLaps: number
  averageLapTime: string
  laps: LapHistoryViewModel[]
}

export interface ExpandableLapHistoryViewModel extends LapHistoryViewModel {
  expandKey: string
  expanded: boolean
}

export interface ExpandableRaceHistoryViewModel extends Omit<RaceHistoryViewModel, 'laps'> {
  expanded: boolean
  laps: ExpandableLapHistoryViewModel[]
}

export function buildRaceHistoryTree(
  records: RaceRecord[],
  expandedRaceIds: ReadonlySet<string>,
  expandedLapKeys: ReadonlySet<string>,
): ExpandableRaceHistoryViewModel[] {
  return records.map((record) => {
    const race = buildRaceHistoryViewModel(record)
    return {
      ...race,
      expanded: expandedRaceIds.has(race.id),
      laps: race.laps.map((lap) => {
        const expandKey = `${race.id}-lap-${lap.lap}`
        return {
          ...lap,
          expandKey,
          expanded: expandedLapKeys.has(expandKey),
        }
      }),
    }
  })
}

export function buildRaceHistoryViewModel(record: RaceRecord): RaceHistoryViewModel {
  const laps = new Map<number, LapHistoryViewModel>()
  const previousCorrectionOffsets = new Map<number, number>()
  const validLapTimes: number[] = []

  record.scores.forEach((score, index) => {
    const lap = score.correctedLap ?? score.lap
    const correctionOffset = score.correctionOffset ?? 0
    const previousOffset = previousCorrectionOffsets.get(score.athleteId) ?? 0
    const hasNewCorrection = correctionOffset > previousOffset
    previousCorrectionOffsets.set(score.athleteId, correctionOffset)

    if (lap > 0 && score.lapCentiseconds >= 800 && !hasNewCorrection) {
      validLapTimes.push(score.lapCentiseconds)
    }
    // 固件定义运动员时可能上报第 0 圈初始化状态，它不是实际完成圈。
    if (lap <= 0) return

    let lapViewModel = laps.get(lap)
    if (!lapViewModel) {
      lapViewModel = {
        key: `lap-${lap}`,
        lap,
        leaderName: '暂无',
        leaderLapTime: '—',
        scores: [],
      }
      laps.set(lap, lapViewModel)
    }

    lapViewModel.scores.push({
      key: `${score.athleteId}-${lap}-${index}`,
      name: score.name,
      lapTime: formatCentiseconds(score.lapCentiseconds),
      totalTime: formatCentiseconds(score.totalCentiseconds),
      rank: score.rank,
    })
    if (score.rank === 1 && lapViewModel.leaderName === '暂无') {
      lapViewModel.leaderName = score.name
      lapViewModel.leaderLapTime = formatCentiseconds(score.lapCentiseconds)
    }
  })

  const orderedLaps = [...laps.values()].sort((left, right) => left.lap - right.lap)
  const averageCentiseconds = validLapTimes.length === 0
    ? null
    : Math.round(validLapTimes.reduce((sum, value) => sum + value, 0) / validLapTimes.length)

  return {
    id: record.id,
    startedAt: formatDate(record.startedAt),
    status: record.finishedAt === null ? '进行中' : '已结束',
    totalLaps: orderedLaps.length === 0 ? 0 : orderedLaps[orderedLaps.length - 1]!.lap,
    averageLapTime: averageCentiseconds === null ? '—' : formatCentiseconds(averageCentiseconds),
    laps: orderedLaps,
  }
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
