import { formatCentiseconds } from '../../domain/time-format'
import { parseRaceDate } from '../../services/backend-sync/validation'
import type { RaceInfoDto, ScoreDto } from '../../services/backend-api/types'
import type { AthleteProfile } from '../../domain/athlete-profile'

export interface LiveRaceViewModel {
  id: number
  startedAt: string
  elapsedTime: string
  maximumLap: number
  leaderName: string
  expanded: boolean
  rows: Array<{
    key: string
    rank: number
    name: string
    lap: number
    lapTime: string
    totalTime: string
  }>
}

export function buildLiveRaceViewModel(
  race: RaceInfoDto,
  scores: readonly ScoreDto[],
  athletes: readonly Pick<AthleteProfile, 'id' | 'name'>[],
  serverTime: string,
  receivedAt: number,
  now: number,
  expanded: boolean,
): LiveRaceViewModel {
  const raceId = race.RaceID ?? 0
  const serverNow = parseRaceDate(serverTime) + Math.max(0, now - receivedAt)
  const startedAt = parseRaceDate(race.RaceDate)
  const byId = new Map(athletes.map((athlete) => [athlete.id, athlete.name]))
  const latest = latestPerAthlete(scores.filter((score) => score.Enabled && score.RaceID === raceId))
    .sort(compareScore)
  return {
    id: raceId,
    startedAt: race.RaceDate,
    elapsedTime: formatDuration(Math.max(0, serverNow - startedAt)),
    maximumLap: latest.reduce((maximum, score) => Math.max(maximum, score.LapCount), 0),
    leaderName: latest.length ? (byId.get(latest[0]!.AthleteID) ?? `运动员 #${latest[0]!.AthleteID}`) : '暂无',
    expanded,
    rows: latest.map((score, index) => ({
      key: `${raceId}-${score.AthleteID}`,
      rank: index + 1,
      name: byId.get(score.AthleteID) ?? `运动员 #${score.AthleteID}`,
      lap: score.LapCount,
      lapTime: formatCentiseconds(score.SingleLapTime),
      totalTime: formatCentiseconds(score.TotalTime),
    })),
  }
}

function latestPerAthlete(scores: readonly ScoreDto[]): ScoreDto[] {
  const latest = new Map<number, ScoreDto>()
  scores.forEach((score) => {
    const current = latest.get(score.AthleteID)
    if (!current || score.EventSequence > current.EventSequence
        || (score.EventSequence === current.EventSequence && (score.ScoreID ?? 0) > (current.ScoreID ?? 0))) {
      latest.set(score.AthleteID, score)
    }
  })
  return [...latest.values()]
}

function compareScore(left: ScoreDto, right: ScoreDto): number {
  return (right.LapCount - left.LapCount) || (left.TotalTime - right.TotalTime) || (left.AthleteID - right.AthleteID)
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(remainder)}` : `${pad(minutes)}:${pad(remainder)}`
}
