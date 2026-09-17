import { match } from 'pinyin-pro'

export interface AthleteSearchEntry {
  id: number
  name: string
  epc: string
}

export function matchesAthleteSearch(athlete: AthleteSearchEntry, query: string): boolean {
  const search = query.trim()
  if (!search) return true

  const pattern = createSearchPattern(search)
  if ([athlete.name, String(athlete.id)].some((value) => pattern.test(value))) return true

  const positions = match(athlete.name, search, { continuous: true })
  return positions?.[0] === 0
}

function createSearchPattern(search: string): RegExp {
  try {
    return new RegExp(search, 'i')
  } catch {
    return new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  }
}
