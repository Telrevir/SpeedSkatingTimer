import {
  athleteCatalog,
  athleteManagement,
  catalogSync,
  groupManagement,
  groupStore,
  raceController,
} from '../../services/app-services'
import { createAthletePageDefinition } from './page-controller'

Page(createAthletePageDefinition({
  athleteCatalog,
  athleteManagement,
  catalogSync,
  groupManagement,
  groupStore,
  raceController,
}))
