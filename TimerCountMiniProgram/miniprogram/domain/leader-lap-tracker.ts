export class LeaderLapTracker {
  private previousTotalCentiseconds: number | null = null
  private currentLapCentiseconds: number | null = null

  update(_lapCount: number, totalCentiseconds: number): number | null {
    if (totalCentiseconds < 0) {
      return this.currentLapCentiseconds
    }
    if (this.previousTotalCentiseconds === null) {
      this.previousTotalCentiseconds = totalCentiseconds
      return null
    }

    // Keep the previous leader total as the sole baseline. The original
    // Android app updated this baseline on every valid 0x06 response, so a
    // leader change is reflected immediately instead of waiting for another
    // lap packet from the new leader.
    this.currentLapCentiseconds = totalCentiseconds - this.previousTotalCentiseconds
    this.previousTotalCentiseconds = totalCentiseconds
    return this.currentLapCentiseconds
  }

  reset(): void {
    this.previousTotalCentiseconds = null
    this.currentLapCentiseconds = null
  }
}
