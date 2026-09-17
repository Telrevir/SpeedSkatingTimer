import type { LocalRacePhase } from './local-race-scoring'

export function isGroupCompact(phase: LocalRacePhase, testOverride: boolean): boolean {
  return testOverride || phase === 'running' || phase === 'finishing' || phase === 'finished'
}

export function getRaceNavigationTitle(groupName: string): string {
  return '比赛（当前分组：' + (groupName.trim() || '全部运动员') + '）'
}

export function createEmptyRankingSlots(): number[] {
  return [1, 2, 3, 4, 5]
}

