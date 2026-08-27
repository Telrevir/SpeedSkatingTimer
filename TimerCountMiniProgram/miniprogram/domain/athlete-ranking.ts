import type { Athlete } from './athlete'

export function updateAthleteRank(
  athletes: Map<number, Athlete>,
  athleteId: number,
  newRank: number,
): void {
  const target = athletes.get(athleteId)
  if (!target) {
    throw new Error(`athlete ${athleteId} does not exist`)
  }

  const oldRank = target.currentRank
  if (newRank <= 0) {
    athletes.forEach((other) => {
      if (other.id !== athleteId && other.currentRank > oldRank) {
        other.currentRank -= 1
      }
    })
  } else if (oldRank <= 0) {
    athletes.forEach((other) => {
      if (other.id !== athleteId && other.currentRank >= newRank) {
        other.currentRank += 1
      }
    })
  } else if (newRank < oldRank) {
    athletes.forEach((other) => {
      if (other.id !== athleteId
          && other.currentRank >= newRank
          && other.currentRank < oldRank) {
        other.currentRank += 1
      }
    })
  } else if (newRank > oldRank) {
    athletes.forEach((other) => {
      if (other.id !== athleteId
          && other.currentRank > oldRank
          && other.currentRank <= newRank) {
        other.currentRank -= 1
      }
    })
  }

  target.currentRank = newRank
  // Rank movement is reported relative to the last score received for this
  // athlete. Once the athlete is detected again, its current rank becomes the
  // new baseline and any accumulated movement is cleared.
  target.previousRank = newRank
}
