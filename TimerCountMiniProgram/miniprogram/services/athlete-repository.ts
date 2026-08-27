import {
  emptyAthleteCatalog,
  type AthleteCatalog,
  type AthleteCatalogStorage,
} from '../domain/athlete-profile'

export class AthleteRepository {
  constructor(private readonly storage: AthleteCatalogStorage) {}

  load(): AthleteCatalog {
    const value = this.storage.read()
    if (value === null || value === undefined || value === '') {
      return emptyAthleteCatalog()
    }
    return cloneCatalog(value as AthleteCatalog)
  }

  save(catalog: AthleteCatalog): void {
    this.storage.write(cloneCatalog(catalog))
  }
}

function cloneCatalog(catalog: AthleteCatalog): AthleteCatalog {
  return {
    ...catalog,
    athletes: catalog.athletes.map((athlete) => ({ ...athlete })),
    activeEpcIndex: { ...catalog.activeEpcIndex },
  }
}
