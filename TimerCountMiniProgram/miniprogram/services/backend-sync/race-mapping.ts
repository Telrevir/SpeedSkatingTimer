import type { RaceRecord } from '../score-repository'
import type { RaceBundleDto } from '../backend-api/race-bundles'
import type { AthleteDto } from '../backend-api/athletes'
import type { SyncIdMapping } from './id-mapping'
import { parseRaceDate } from './validation'

export const joinKey = (raceId: string, athleteId: number) => JSON.stringify([raceId, athleteId])
export const scoreKey = (raceId: string, index: number) => JSON.stringify([raceId, index])

export function toRaceBundle(record: RaceRecord, clubId: number, ids: SyncIdMapping): RaceBundleDto {
  // RaceID 仅当本地比赛已绑定云端 ID（此前添加成功过）时携带；
  // 首次上传不带 RaceID，由后端生成并在响应中返回，随后由 StartupSync 绑定回本地记录。
  const raceId = ids.get('race', record.id)
  const participants = [...new Set([...(record.participantIds ?? []), ...record.scores.map((score) => score.athleteId)])].sort((a, b) => a - b)
  const raceFields = raceId === undefined ? {} : { RaceID: raceId }
  return {
    RaceInfo: { ...raceFields, ClubID: clubId, RaceDate: formatRaceDate(record.startedAt), Enabled: true },
    AthleteRaceJoins: participants.map((athleteId) => ({
      id: ids.assign('join', joinKey(record.id, athleteId)), ...raceFields, AthleteID: athleteId, Enabled: true,
    })),
    Scores: record.scores.map((score, index) => ({
      ScoreID: ids.assign('score', scoreKey(record.id, index)), ...raceFields, AthleteID: score.athleteId,
      LapCount: score.correctedLap ?? score.lap,
      SingleLapTime: score.lapCentiseconds,
      TotalTime: score.totalCentiseconds, Rank: score.rank, Enabled: true,
    })),
  }
}

export function fromRaceBundle(bundle: RaceBundleDto, athletes: AthleteDto[], localId: string): RaceRecord {
  const byId = new Map(athletes.map((athlete) => [athlete.AthleteID, athlete]))
  return {
    id: localId, startedAt: parseRaceDate(bundle.RaceInfo.RaceDate), finishedAt: null,
    participantIds: bundle.AthleteRaceJoins.map((join) => join.AthleteID),
    // 后端没有结束时间、姓名/EPC 历史快照；不虚构结束时间，用已校验的当前运动员资料关联。
    scores: [...bundle.Scores].sort((a, b) => a.ScoreID - b.ScoreID).map((score) => {
      const athlete = byId.get(score.AthleteID)
      if (!athlete) throw new Error('成绩缺少运动员关联')
      return { athleteId: score.AthleteID, name: athlete.AthleteName, epc: athlete.AthleteEPC.toString(16).toUpperCase().padStart(8, '0'),
        lap: score.LapCount, correctedLap: score.LapCount,
        lapCentiseconds: score.SingleLapTime, totalCentiseconds: score.TotalTime, rank: score.Rank }
    }),
  }
}

export function formatRaceDate(timestamp: number): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) throw new Error('比赛时间无效')
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
