import type { AthleteProfile } from '../../domain/athlete-profile'
import type { AthleteDto } from '../backend-api/athletes'
import type { RaceBundleDto } from '../backend-api/race-bundles'
import type { RaceRecord } from '../score-repository'
import { formatRaceDate } from './race-mapping'

export function athleteDto(profile: AthleteProfile, clubId: number): AthleteDto {
  return { AthleteID: profile.id, ClubID: clubId, AthleteName: profile.name,
    AthleteEPC: Number.parseInt(profile.epc, 16), Enabled: profile.status === 'active' }
}

export function sameAthlete(local: AthleteProfile, remote: AthleteDto, clubId: number): boolean {
  const dto = athleteDto(local, clubId)
  return dto.AthleteID === remote.AthleteID && dto.ClubID === remote.ClubID && dto.AthleteName === remote.AthleteName
    && dto.AthleteEPC === remote.AthleteEPC && dto.Enabled === remote.Enabled
}

export function sameIds(left: number[], right: number[]): boolean {
  return JSON.stringify([...left].sort((a, b) => a - b)) === JSON.stringify([...right].sort((a, b) => a - b))
}

export function sameRace(local: RaceRecord, remote: RaceBundleDto): boolean {
  if (!remote.RaceInfo.Enabled || remote.AthleteRaceJoins.some((row) => !row.Enabled) || remote.Scores.some((row) => !row.Enabled)) return false
  if (formatRaceDate(local.startedAt) !== remote.RaceInfo.RaceDate) return false
  const participants = [...new Set([...(local.participantIds ?? []), ...local.scores.map((score) => score.athleteId)])]
  if (!sameIds(participants, remote.AthleteRaceJoins.map((row) => row.AthleteID))) return false
  const left = local.scores.map((row) => [row.athleteId, row.correctedLap ?? row.lap,
    row.lapCentiseconds, row.totalCentiseconds, row.rank])
  const right = [...remote.Scores].sort((a, b) => a.ScoreID - b.ScoreID).map((row) => [row.AthleteID, row.LapCount,
    row.SingleLapTime, row.TotalTime, row.Rank])
  return JSON.stringify(left) === JSON.stringify(right)
}
