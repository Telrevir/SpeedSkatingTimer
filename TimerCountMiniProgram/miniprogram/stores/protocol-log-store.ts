export interface ProtocolLogEntry {
  id: number
  receivedAt: number
  timestamp: string
  packetHex: string
}

export const PROTOCOL_LOG_CAPACITY = 500

export class ProtocolLogStore {
  private entries: ProtocolLogEntry[] = []
  private nextId = 1
  private readonly listeners = new Set<(entries: ProtocolLogEntry[]) => void>()

  constructor(
    private readonly maxEntries = PROTOCOL_LOG_CAPACITY,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get snapshot(): ProtocolLogEntry[] {
    return this.entries.map((entry) => ({ ...entry }))
  }

  record(packet: Uint8Array): void {
    const receivedAt = this.now()
    const entry = {
      id: this.nextId,
      receivedAt,
      timestamp: formatTimestamp(receivedAt),
      packetHex: [...packet]
        .map((value) => value.toString(16).toUpperCase().padStart(2, '0'))
        .join(' '),
    }
    this.entries = [entry, ...this.entries].slice(0, this.maxEntries)
    this.nextId += 1
    this.notify()
  }

  clear(): void {
    this.entries = []
    this.notify()
  }

  subscribe(listener: (entries: ProtocolLogEntry[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    if (this.listeners.size === 0) return
    const snapshot = this.snapshot
    this.listeners.forEach((listener) => listener(snapshot))
  }
}

function formatTimestamp(value: number): string {
  const date = new Date(value)
  const pad = (part: number, width = 2) => String(part).padStart(width, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `.${pad(date.getMilliseconds(), 3)}`
}
