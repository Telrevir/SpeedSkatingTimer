import type { Athlete } from './athlete'
import { formatCentiseconds } from './time-format'

/**
 * Formats a live athlete total relative to the current leader, matching the
 * Android app: a lap deficit is shown as -N, while same-lap athletes show the
 * positive time gap to the leader.
 */
export function formatRelativeTotalTime(
  athlete: Athlete,
  leader: Athlete | null | undefined,
): string {
  if (!leader
      || athlete.id === leader.id
      || athlete.lapCount < 0
      || leader.lapCount < 0) {
    return formatCentiseconds(athlete.totalCentiseconds)
  }

  const lapGap = leader.lapCount - athlete.lapCount
  if (lapGap > 0) return `-${lapGap}`

  if (lapGap === 0
      && athlete.totalCentiseconds >= 0
      && leader.totalCentiseconds >= 0) {
    const timeGap = Math.max(0, athlete.totalCentiseconds - leader.totalCentiseconds)
    return `+${formatGapCentiseconds(timeGap)}`
  }

  return formatCentiseconds(athlete.totalCentiseconds)
}

function formatGapCentiseconds(value: number): string {
  const seconds = Math.floor(value / 100)
  const hundredths = value % 100
  return `${seconds}.${String(hundredths).padStart(2, '0')}`
}
