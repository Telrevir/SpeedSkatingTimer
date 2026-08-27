import { formatCentiseconds } from '../../domain/time-format'
import { scoreRepository } from '../../services/app-services'
import type { RaceRecord } from '../../services/score-repository'

let unsubscribe: (() => void) | null = null

Page({
  data: {
    races: [] as Array<{
      id: string
      startedAt: string
      status: string
      scoreCount: number
      scores: Array<{ key: string; name: string; lap: number; lapTime: string; totalTime: string; rank: number }>
    }>,
  },
  onLoad() {
    unsubscribe = scoreRepository.subscribe((records) => {
      this.setData({ races: records.map(toViewModel) })
    })
  },
  onUnload() {
    unsubscribe?.()
    unsubscribe = null
  },
})

function toViewModel(record: RaceRecord) {
  return {
    id: record.id,
    startedAt: formatDate(record.startedAt),
    status: record.finishedAt === null ? '进行中' : '已结束',
    scoreCount: record.scores.length,
    scores: record.scores.map((score, index) => ({
      key: `${score.athleteId}-${score.lap}-${index}`,
      name: score.name,
      lap: score.lap,
      lapTime: formatCentiseconds(score.lapCentiseconds),
      totalTime: formatCentiseconds(score.totalCentiseconds),
      rank: score.rank,
    })),
  }
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
