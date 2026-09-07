import './types'

declare module './types' {
  interface AthleteListQuery {
    [key: string]: string | number | boolean
  }

  interface GroupMemberListQuery {
    [key: string]: string | number | boolean
  }

  interface RaceBundleListQuery {
    [key: string]: string | number | boolean
  }
}

export {}
