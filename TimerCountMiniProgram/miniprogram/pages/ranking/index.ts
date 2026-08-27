import { formatCentiseconds } from '../../domain/time-format'
import { formatRelativeTotalTime } from '../../domain/relative-total-time'
import { raceController } from '../../services/app-services'

let unsubscribe: (() => void) | null = null
let unsubscribeRace: (() => void) | null = null

Page({
  data: {
    rows: [] as Array<{
      id: number
      rank: number
      name: string
      lap: string
      lapTime: string
      totalTime: string
      change: string
      finished: boolean
    }>,
  },

  onLoad() {
    unsubscribe = raceController.subscribeAthletes((athletes) => {
      const leader = athletes.find(({ id }) => id === raceController.snapshot.leaderAthleteId)
      const rows = athletes
        .filter(({ currentRank, hasRaceScore }) => currentRank > 0 && hasRaceScore)
        .sort((left, right) => left.currentRank - right.currentRank)
        .map((athlete) => ({
          id: athlete.id,
          rank: athlete.currentRank,
          name: athlete.name,
          lap: athlete.lapCount < 0 ? '—' : String(athlete.lapCount),
          lapTime: formatCentiseconds(athlete.lapCentiseconds),
          totalTime: formatRelativeTotalTime(athlete, leader),
          change: rankChange(athlete.previousRank, athlete.currentRank),
          finished: athlete.finished,
        }))
      this.setData({ rows })
    })
    unsubscribeRace = raceController.subscribe(() => {
      const athletes = raceController.athletesSnapshot
      const leader = athletes.find(({ id }) => id === raceController.snapshot.leaderAthleteId)
      this.setData({
        rows: athletes
          .filter(({ currentRank, hasRaceScore }) => currentRank > 0 && hasRaceScore)
          .sort((left, right) => left.currentRank - right.currentRank)
          .map((athlete) => ({
            id: athlete.id,
            rank: athlete.currentRank,
            name: athlete.name,
            lap: athlete.lapCount < 0 ? '—' : String(athlete.lapCount),
            lapTime: formatCentiseconds(athlete.lapCentiseconds),
            totalTime: formatRelativeTotalTime(athlete, leader),
            change: rankChange(athlete.previousRank, athlete.currentRank),
            finished: athlete.finished,
          })),
      })
    })
  },

  onUnload() {
    unsubscribe?.()
    unsubscribeRace?.()
    unsubscribe = null
    unsubscribeRace = null
  },
})

function rankChange(previousRank: number, currentRank: number): string {
  if (previousRank <= 0 || previousRank === currentRank) return '--'
  const difference = previousRank - currentRank
  return difference > 0 ? `↑${difference}` : `↓${Math.abs(difference)}`
}
