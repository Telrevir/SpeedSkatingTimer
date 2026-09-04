import type { ClubDataDto } from '../backend-api/sync-data'
import { utf8Bytes } from '../../protocol/binary'

export function validateClubData(value: unknown, clubId: number, options: { raceIdOptional?: boolean } = {}): ClubDataDto {
  const { raceIdOptional = false } = options
  integer(clubId, 'ClubID', 1)
  const root = object(value, '俱乐部数据')
  sameId(root.ClubID, clubId, 'ClubID')
  const athleteIds = new Set<number>()
  const epcs = new Set<number>()
  const groupIds = new Set<number>()
  const formIds = new Set<number>()
  const raceIds = new Set<number>()
  const joinIds = new Set<number>()
  const scoreIds = new Set<number>()
  const Athletes = array(root.Athletes, 'Athletes').map((value) => {
    const item = object(value, 'Athlete')
    const AthleteID = uniqueId(item.AthleteID, athleteIds, 'AthleteID', 65535)
    sameId(item.ClubID, clubId, 'Athlete.ClubID')
    const AthleteEPC = integer(item.AthleteEPC, 'AthleteEPC', 0, 0xffffffff)
    unique(AthleteEPC, epcs, 'AthleteEPC')
    const AthleteName = name(item.AthleteName, 'AthleteName')
    if (utf8Bytes(AthleteName).length > 32) throw new Error('运动员姓名不能超过 32 个 UTF-8 字节')
    return { AthleteID, ClubID: clubId, AthleteName, AthleteEPC, Enabled: enabled(item.Enabled) }
  })
  const AthleteGroups = array(root.AthleteGroups, 'AthleteGroups').map((value) => {
    const item = object(value, 'AthleteGroup')
    const AthleteGroupID = uniqueId(item.AthleteGroupID, groupIds, 'AthleteGroupID')
    sameId(item.ClubID, clubId, 'AthleteGroup.ClubID')
    return { AthleteGroupID, ClubID: clubId, AthleteGroupName: name(item.AthleteGroupName, 'AthleteGroupName'), Enabled: enabled(item.Enabled) }
  })
  const AthleteGroupForms = array(root.AthleteGroupForms, 'AthleteGroupForms').map((value) => {
    const item = object(value, 'AthleteGroupForm')
    return {
      AthleteGroupFormID: uniqueId(item.AthleteGroupFormID, formIds, 'AthleteGroupFormID'),
      AthleteGroupID: reference(item.AthleteGroupID, groupIds, 'AthleteGroupForm.AthleteGroupID'),
      AthleteID: reference(item.AthleteID, athleteIds, 'AthleteGroupForm.AthleteID'),
      Enabled: enabled(item.Enabled),
    }
  })
  const RaceBundles = array(root.RaceBundles, 'RaceBundles').map((value) => {
    const bundle = object(value, 'RaceBundle')
    const info = object(bundle.RaceInfo, 'RaceInfo')
    sameId(info.ClubID, clubId, 'RaceInfo.ClubID')
    if (typeof info.RaceDate !== 'string') throw new Error('RaceDate 必须是字符串')
    parseRaceDate(info.RaceDate)
    // RaceID：远端快照必须存在；新增上传（raceIdOptional）可为空，由后端生成并在响应中返回。
    const raceID = optionalPositiveId(info.RaceID, 'RaceID')
    if (!raceIdOptional && raceID === null) throw new Error('RaceID 不能为空')
    if (raceID !== null) unique(raceID, raceIds, 'RaceID')
    const RaceInfo = { ...(raceID === null ? {} : { RaceID: raceID }), ClubID: clubId, RaceDate: info.RaceDate, Enabled: enabled(info.Enabled) }
    const participants = new Set<number>()
    const AthleteRaceJoins = array(bundle.AthleteRaceJoins, 'AthleteRaceJoins').map((value) => {
      const item = object(value, 'AthleteRaceJoin')
      const joinRaceID = optionalPositiveId(item.RaceID, 'AthleteRaceJoin.RaceID')
      if (joinRaceID !== null && (raceID === null || joinRaceID !== raceID)) throw new Error('AthleteRaceJoin.RaceID 必须与 RaceInfo.RaceID 一致')
      const AthleteID = reference(item.AthleteID, athleteIds, 'AthleteRaceJoin.AthleteID')
      unique(AthleteID, participants, '同比赛参赛运动员')
      return {
        id: uniqueId(item.id, joinIds, 'AthleteRaceJoin.id'),
        ...(joinRaceID === null ? {} : { RaceID: joinRaceID }),
        AthleteID, Enabled: enabled(item.Enabled),
      }
    })
    const Scores = array(bundle.Scores, 'Scores').map((value) => {
      const item = object(value, 'Score')
      const scoreRaceID = optionalPositiveId(item.RaceID, 'Score.RaceID')
      if (scoreRaceID !== null && (raceID === null || scoreRaceID !== raceID)) throw new Error('Score.RaceID 必须与 RaceInfo.RaceID 一致')
      const AthleteID = reference(item.AthleteID, athleteIds, 'Score.AthleteID')
      reference(AthleteID, participants, 'Score 参赛关系')
      // 正式接口的 int 字段使用非负 int32。
      return {
        ScoreID: uniqueId(item.ScoreID, scoreIds, 'ScoreID'),
        ...(scoreRaceID === null ? {} : { RaceID: scoreRaceID }),
        AthleteID,
        LapCount: nonnegativeInt(item.LapCount, 'LapCount'),
        SingleLapTime: nonnegativeInt(item.SingleLapTime, 'SingleLapTime'),
        TotalTime: nonnegativeInt(item.TotalTime, 'TotalTime'), Rank: nonnegativeInt(item.Rank, 'Rank'),
        Enabled: enabled(item.Enabled),
      }
    })
    return { RaceInfo, AthleteRaceJoins, Scores }
  })
  // 只重建契约字段，返回独立快照；扩展字段不会导致拒收，也不会进入本地仓库。
  return { ClubID: clubId, Athletes, AthleteGroups, AthleteGroupForms, RaceBundles }
}





export function parseRaceDate(value: string): number {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error('RaceDate 格式必须是 yyyy-MM-dd HH:mm:ss')
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number]
  const date = new Date(0)
  // setFullYear 避免 JS 将 00..99 年隐式转换为 1900..1999 年。
  date.setFullYear(year, month - 1, day)
  date.setHours(hour, minute, second, 0)
  if (year < 1 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
    || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) {
    throw new Error('RaceDate 不是有效的本地日期时间')
  }
  return date.getTime()
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} 必须是对象`)
  return value as Record<string, unknown>
}
function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} 必须是数组`)
  return Array.from(value)
}
function integer(value: unknown, field: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${field} 超出整数范围:Value=${value},min=${min},max=${max}`)
  return value
}
function nonnegativeInt(value: unknown, field: string): number { return integer(value, field, 0, 0x7fffffff) }
function name(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 不能为空`)
  return value.trim()
}
function enabled(value: unknown): boolean {
  if (value === undefined) return true
  if (typeof value !== 'boolean') throw new Error('Enabled 必须是布尔值')
  return value
}
function unique<T>(value: T, seen: Set<T>, field: string): void {
  if (seen.has(value)) throw new Error(`${field} 重复`)
  seen.add(value)
}
function uniqueId(value: unknown, seen: Set<number>, field: string, max = Number.MAX_SAFE_INTEGER): number {
  const id = integer(value, field, 1, max)
  unique(id, seen, field)
  return id
}
function sameId(value: unknown, expected: number, field: string): void {
  if (integer(value, field, 1) !== expected) throw new Error(`${field} 不匹配`)
}
function optionalPositiveId(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null
  return integer(value, field, 1)
}
function reference(value: unknown, ids: Set<number>, field: string): number {
  const id = integer(value, field, 1)
  if (!ids.has(id)) throw new Error(`${field} 指向不存在的记录`)
  return id
}
