export type AthleteStatus = 'active' | 'archived'
export type AthleteIdReusePolicy = 'never'

export interface AthleteProfile {
  id: number
  name: string
  epc: string
  status: AthleteStatus
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface AthleteCatalog {
  schemaVersion: 1
  revision: number
  nextId: number
  idReusePolicy: AthleteIdReusePolicy
  athletes: AthleteProfile[]
  activeEpcIndex: Record<string, number>
}

export interface AthleteCatalogStorage {
  read(): unknown
  write(value: AthleteCatalog): void
}

export interface AthleteCatalogSyncAdapter {
  pull(): Promise<AthleteCatalog | null>
  push(catalog: AthleteCatalog): Promise<void>
}

export function emptyAthleteCatalog(): AthleteCatalog {
  return {
    schemaVersion: 1,
    revision: 0,
    nextId: 1,
    idReusePolicy: 'never',
    athletes: [],
    activeEpcIndex: {},
  }
}
