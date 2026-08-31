import type { AthleteProfile } from '../domain/athlete-profile'
import type { Athlete } from '../domain/athlete'
import type { LocalAthleteScore } from '../domain/local-race-scoring'

export class AthleteStore {
  private readonly listeners = new Set<(athletes: Athlete[]) => void>()
  private profiles: AthleteProfile[] = []
  private scores = new Map<number, LocalAthleteScore>()

  get snapshot(): Athlete[] {
    return this.profiles
      .sort((left, right) => left.id - right.id)
      .map((profile) => {
        const score = this.scores.get(profile.id)
        return {
          id: profile.id,
          name: profile.name,
          epc: profile.epc,
          lapCount: score?.lapCount ?? -1,
          rawLapCount: score?.rawLapCount ?? -1,
          correctionOffset: score?.correctionOffset ?? 0,
          correctedLapCount: score?.correctedLapCount ?? -1,
          lapCentiseconds: score?.lapCentiseconds ?? -1,
          totalCentiseconds: score?.totalCentiseconds ?? -1,
          previousRank: score?.previousRank ?? 0,
          currentRank: score?.currentRank ?? 0,
          hasRaceScore: score !== undefined,
          finished: score?.finished ?? false,
        }
      })
  }

  replaceProfiles(profiles: AthleteProfile[]): void {
    this.profiles = profiles.map((profile) => ({ ...profile }))
    this.notify()
  }

  replaceScores(scores: LocalAthleteScore[]): void {
    this.scores = new Map(scores.map((score) => [score.athleteId, { ...score }]))
    this.notify()
  }

  subscribe(listener: (athletes: Athlete[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    const snapshot = this.snapshot
    this.listeners.forEach((listener) => listener(snapshot))
  }
}
