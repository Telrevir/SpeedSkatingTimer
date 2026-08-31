import type { ProtocolLogEntry } from '../stores/protocol-log-store'

export interface ProtocolLogSource {
  subscribe(listener: (entries: ProtocolLogEntry[]) => void): () => void
}

export class ProtocolLogPageSubscription {
  private unsubscribe: (() => void) | null = null

  constructor(private readonly source: ProtocolLogSource) {}

  show(listener: (entries: ProtocolLogEntry[]) => void): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.source.subscribe(listener)
  }

  hide(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }
}
